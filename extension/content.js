(function () {
  "use strict";

  // ===== Constants =====
  var ROOT_ID = "mrbb-root";
  var HOST_ID = "mrbb-host";
  var STORAGE_KEY = "mrbb-settings";
  var FIXED_MARK = "data-mrbb-fixed-adjusted";
  // 拡張自身の新しいタブページ（newtab.html が content.js を直接読み込む）。
  // 自前ページなので押し下げが安全 → オートハイドせず常時表示にする
  var IS_EXT_NTP = location.protocol === "chrome-extension:" && /newtab\.html$/.test(location.pathname);
  var DEFAULT_SETTINGS = {
    enabled: true, maxRows: 0, displayMode: "both",
    folderOpenMode: "hover", showCondition: "always",
    fontSize: 12, barHeight: 36,
    barMode: "overflow", // "overflow": ネイティブバーの続きから / "independent": 全ブックマークを描画
    boundaryOffset: 0,    // (旧) アイテム数補正 — boundaryOffsetPx へ移行済み
    boundaryOffsetPx: 0,  // ネイティブバー使用可能幅の手動補正(px)。+ = 手前から表示。
                          // px 保存なので並べ替えでどのブックマークが境界に来ても補正が安定する
    hoverCloseMs: 400,    // ホバー展開したフォルダを、カーソルが離れてから閉じるまでの時間(ms)
    barColor: "",         // バー背景色 (#rrggbb)。空 = 標準色（ライト/ダーク自動追従）
    displayBehavior: "autohide", // "autohide": ページ無改変のオーバーレイ（上端ホバーで表示）
                                 // "push": ページを押し下げて常時表示（fixed要素補正あり）
    // --- autohide の詳細設定 ---
    revealEdgePx: 2,          // 画面上端から何 px 以内にカーソルが来たら表示するか
    revealDelayMs: 0,         // 上端に触れてから表示するまでの遅延（誤爆防止）
    autohideDelayMs: 400,     // エリアから外れてから隠すまでの時間
    hideOnClick: true,        // バー内のブックマークを開いたら即座に隠す
    hideOnOutsideClick: true, // バーの外をクリックしたら即座に隠す
    ntpMode: "custom",        // 新しいタブ: "custom"=多段バー付きページ / "default"=Chrome標準へ転送
    language: "auto"          // UI言語: "auto"=ブラウザに合わせる / "en" / "ja"
  };

  // Chrome ネイティブバーの寸法モデル
  // (Chromium 本家 bookmark_bar_view.cc / layout_constants.cc /
  //  bookmark_button_util.h の実装から転記。非タッチ UI の値)
  var NATIVE = {
    fontSize: 12,        // Chrome UI フォントサイズ（Windows 100% 時）
    inset: 6,            // ボタン左右 inset (INSETS_BOOKMARKS_BAR_BUTTON)
    iconSize: 16,        // ファビコン / フォルダアイコン
    imageLabelGap: 6,    // kBookmarkBarButtonImageLabelPadding
    buttonPadding: 4,    // kBookmarkBarButtonPadding（ボタン間。fit 判定にも含まれる）
    maxButtonWidth: 150, // kMaxButtonWidth（テキストでなくボタン全体の上限）
    leadingMargin: 6,    // GetLeadingMargin()
    trailingMargin: 8,   // kBookmarkBarTrailingMargin
    chevron: 28,         // >> ボタン = inset6 + icon16 + inset6（常に幅が予約される）
    separator: 18        // ButtonSeparatorView = 8 + 2 + 8
  };

  // 拡張バー側アイテムの寸法モデル（content.css の描画と一致させる）
  var EXT = {
    itemPad: 8,
    iconTextGap: 6,
    iconSize: 16,
    itemSpacing: 2,
    textMaxWidth: 150
  };

  // ブラウザ内蔵の favicon キャッシュ (_favicon API) を使う。
  // 外部サービスへの通信が一切発生せず、オフラインでも動作する
  var getFaviconUrl = function (url) {
    try { return chrome.runtime.getURL("/_favicon/?pageUrl=" + encodeURIComponent(url) + "&size=32"); }
    catch (e) { return ""; }
  };

  var FALLBACK_ICON = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#e8eaed" stroke="#9aa0a6" stroke-width="1"/><path fill="#5f6368" d="M5 8a3 3 0 0 1 3-3h1v1.5H8a1.5 1.5 0 0 0 0 3h1V11H8a3 3 0 0 1-3-3zm2-.25h2v.5H7v-.5zM8 5h1a3 3 0 0 1 0 6H8V9.5h1a1.5 1.5 0 0 0 0-3H8V5z"/></svg>');

  // ===== State =====
  var settings = Object.assign({}, DEFAULT_SETTINGS);
  var hostEl = null;
  var shadowRoot = null;
  var rootEl = null;
  var cssLoaded = false;
  var canvasEl = null;
  var barHeightPx = 0;
  var hasOtherBookmarks = false;
  var tabGroupTitles = [];
  var lastOverflowInfo = null; // {k, widths, n}: ギアパネルの◀▶が境界アイテムの実幅を知るため
  var originalBodyMarginTop = null;
  var fixedAdjusted = [];   // [{el, original}]
  var fixedObserver = null;
  var fixedObserverTimer = null;

  // Drag state
  var dragId = null;
  var dropIndicatorEl = null;
  var dropTarget = null;
  var folderDropTarget = null;
  var dragClone = null;

  // Dropdown state
  var activeDropdown = null;
  var activeDropdownAnchor = null;
  var dropdownCleanup = null;
  var dropdownOutsideHandler = null;

  // Context menu state
  var activeContextMenu = null;
  var contextMenuBound = false;
  var dragDocBound = false;

  // Auto-hide state
  var autohideBound = false;
  var autohideTimer = null;
  var revealTimer = null;
  var barShown = false;

  // ===== Helpers =====
  function getTextWidth(text, fontSize, maxWidth) {
    if (!canvasEl) canvasEl = document.createElement("canvas");
    var ctx = canvasEl.getContext("2d");
    // Yu Gothic UI: Chrome UI が日本語で使うフォールバック。ネイティブバーの実描画と揃える
    ctx.font = fontSize + 'px "Segoe UI", "Yu Gothic UI", Meiryo, system-ui, -apple-system, sans-serif';
    return maxWidth ? Math.min(ctx.measureText(text).width, maxWidth) : ctx.measureText(text).width;
  }

  // 「すべてのブックマーク」ボタンの幅（フォルダアイコン付き LabelButton）
  function allBookmarksButtonWidth() {
    var lang = (chrome.i18n && chrome.i18n.getUILanguage) ? chrome.i18n.getUILanguage() : "en";
    var label = lang.indexOf("ja") === 0 ? "すべてのブックマーク" : "All Bookmarks";
    return Math.ceil(NATIVE.inset * 2 + NATIVE.iconSize + NATIVE.imageLabelGap +
      getTextWidth(label, NATIVE.fontSize));
  }

  // 保存済みタブグループのチップがネイティブバー左側に表示され、幅を消費する
  function tabGroupChipsWidth() {
    if (!tabGroupTitles.length) return 0;
    var w = 0;
    for (var i = 0; i < tabGroupTitles.length; i++) {
      // チップ = テキスト + 左右パディング + チップ間隔（タイトル空でも色ドットが出る）
      var t = tabGroupTitles[i];
      w += (t ? getTextWidth(t, NATIVE.fontSize) : 12) + 32;
    }
    return w + 8; // チップ群とブックマークの間のセパレータ余白
  }

  // ===== Chrome Zoom Detection =====
  function getChromeZoom() {
    var dpr = window.devicePixelRatio;
    // outerWidth はズームの影響を受けない（ウィンドウ幅）ので outer/inner ≈ ズーム倍率。
    // 縮小(<100%)でも成り立つため outer>=inner の条件は付けない
    if (window.outerWidth > 0 && window.innerWidth > 0) {
      var rawZoom = window.outerWidth / window.innerWidth;
      var levels = [0.25,0.33,0.5,0.67,0.75,0.8,0.9,1.0,1.1,1.25,1.5,1.75,2.0,2.5,3.0];
      var best = -1, minDiff = 0.05;
      for (var i = 0; i < levels.length; i++) {
        var d = Math.abs(rawZoom - levels[i]);
        if (d < minDiff) { minDiff = d; best = levels[i]; }
      }
      if (best > 0) return best;
      // どのズームレベルにも一致しない場合は DPR 方式にフォールバック
    }
    var physW = window.innerWidth * dpr;
    var ratio = physW / screen.width;
    var baseDPR = -1;
    if (Math.abs(ratio - 1.0) < 0.08) baseDPR = 1.0;
    else if (Math.abs(ratio - 1.25) < 0.08) baseDPR = 1.25;
    else if (Math.abs(ratio - 1.5) < 0.08) baseDPR = 1.5;
    else if (Math.abs(ratio - 2.0) < 0.12) baseDPR = 2.0;
    if (baseDPR < 0) return 1.0;
    var zoom = dpr / baseDPR;
    if (zoom < 0.5 || zoom > 3.0) return 1.0;
    return Math.abs(zoom - 1.0) < 0.03 ? 1.0 : zoom;
  }

  // host には zoom: 1/currentZoom がかかっているため、shadow 内で position:fixed
  // する要素の座標はページ座標（clientX/getBoundingClientRect）に currentZoom を
  // 掛けて指定しないと実描画位置が 1/zoom 倍にズレる
  var currentZoom = 1;
  function fx(v) { return (v * currentZoom) + "px"; }

  // i18n: 設定 language が "auto" 以外なら該当ロケールの辞書を実行時ロードして
  // 優先使用（chrome.i18n はブラウザ UI 言語固定で切替できないため）
  var i18nDict = null;
  var i18nLoadedLang = "auto";
  function t(key) {
    if (i18nDict && i18nDict[key] && i18nDict[key].message) return i18nDict[key].message;
    try { var m = chrome.i18n.getMessage(key); if (m) return m; } catch (e) { /* ignore */ }
    return key;
  }
  async function loadI18n(lang) {
    if (!lang || lang === "auto") { i18nDict = null; i18nLoadedLang = "auto"; return; }
    if (i18nLoadedLang === lang && i18nDict) return;
    try {
      var resp = await fetch(chrome.runtime.getURL("_locales/" + lang + "/messages.json"));
      i18nDict = await resp.json();
      i18nLoadedLang = lang;
    } catch (e) { i18nDict = null; i18nLoadedLang = "auto"; }
  }

  // ===== Native Bar Visibility Detection =====
  // ブラウザ chrome 部分の高さ（外寸 - 内寸）からネイティブバーの有無を検知する。
  // タブ+ツールバーのみ ≈ 88-96px、+ブックマークバー ≈ 124-133px。
  //   visible: ネイティブバー表示中 → overflow モードで続きを描画
  //   hidden:  Ctrl+Shift+B で非表示 → 全ブックマークをこちらで描画
  //   fullscreen: F11 等 → 拡張バー自体を出さない
  function nativeBarState() {
    if (navigator.webdriver) return "visible"; // 自動テスト環境は検知不能のため固定
    var zoom = getChromeZoom();
    var chromeTop = window.outerHeight - window.innerHeight * zoom;
    if (chromeTop <= 40) return "fullscreen";
    if (chromeTop < 105) return "hidden";
    return "visible";
  }

  // ===== Layout Calculation =====
  // ネイティブバー上のボタン幅（Chromium LabelButton の算出を再現:
  // inset + icon + (gap + text) + inset、ボタン全体を kMaxButtonWidth でクリップ）
  function calcNativeItemWidth(item) {
    var w = NATIVE.inset * 2 + NATIVE.iconSize;
    if (item.title) w += NATIVE.imageLabelGap + getTextWidth(item.title, NATIVE.fontSize);
    return Math.min(Math.ceil(w), NATIVE.maxButtonWidth);
  }

  // 拡張バー上のアイテム幅（content.css と同じ寸法モデル）
  function calcItemWidth(item, displayMode, fontSize) {
    var w = EXT.itemPad * 2 + EXT.itemSpacing;
    if (displayMode !== "text_only") w += EXT.iconSize;
    if (displayMode !== "icon_only" && item.title) {
      if (displayMode !== "text_only") w += EXT.iconTextGap;
      w += getTextWidth(item.title, fontSize, EXT.textMaxWidth);
    }
    return Math.ceil(w);
  }

  // overflow モード: row 0 = Chrome ネイティブバー（描画しない）、row 1+ = 拡張バー
  // 2パス: まずシェブロン無しで全アイテムが収まるか確認 → 収まればバー不要
  function calcOverflowLayout(bookmarks, windowWidth, sett) {
    var fs = sett.fontSize || 12;
    var gearW = 24, searchW = 24;
    var extAvail = windowWidth - 16; // BAR_MARGIN_X * 2

    // Chromium bookmark_bar_view.cc の Layout() を再現する:
    //   x     = leadingMargin + タブグループチップ
    //   max_x = 窓幅 - trailingMargin - チェブロン - セパレータ
    //           - (「すべてのブックマーク」表示中はそのボタン幅 + buttonPadding)
    //   各ボタン: next_x = x + 幅 + buttonPadding が max_x 未満なら表示
    //   ※チェブロン幅はオーバーフローの有無に関わらず常に予約される
    var nativeWidths = bookmarks.map(calcNativeItemWidth);
    var startX = NATIVE.leadingMargin + tabGroupChipsWidth();
    var maxXBase = windowWidth - NATIVE.trailingMargin - NATIVE.chevron - NATIVE.separator;
    if (hasOtherBookmarks) maxXBase -= allBookmarksButtonWidth() + NATIVE.buttonPadding;

    // max_x までに収まる row 0（ネイティブバー）の個数 k と使用幅を返す
    function fitK(maxX) {
      var kk = 0, xx = startX;
      while (kk < bookmarks.length) {
        var nx = xx + nativeWidths[kk] + NATIVE.buttonPadding;
        if (nx >= maxX) break; // Chromium は next_x < max_x (strict) で判定
        xx = nx;
        kk++;
      }
      return { k: kk, used: xx - startX };
    }

    // boundaryOffsetPx は環境差（Chrome UIフォント設定・OS スケール等）の手動補正。
    // 誤差はアイテムごとのテキスト幅計測のズレの蓄積が主因なので、
    // キャリブレーション時のバー使用幅(boundaryCalibUsed)との比で自動スケール
    // させ、ブックマークの並べ替え・増減後も補正が追従するようにする
    var base = fitK(maxXBase);
    var offset = sett.boundaryOffsetPx || 0;
    if (offset && sett.boundaryCalibUsed > 0 && base.used > 0) {
      var ratio = Math.max(0.25, Math.min(4, base.used / sett.boundaryCalibUsed));
      offset = Math.round(offset * ratio);
    }
    var fit = fitK(maxXBase - offset);
    var k = fit.k;
    lastOverflowInfo = { k: k, widths: nativeWidths, n: bookmarks.length, usedNoOffset: base.used, effectiveOffset: offset };
    if (k >= bookmarks.length) return []; // オーバーフロー無し → 拡張バー不要

    var result = [];
    for (var i = 0; i < k; i++) {
      result.push({ bookmark: bookmarks[i], width: nativeWidths[i], row: 0 });
    }
    var currentRow = 1, rowUsed = 0;
    for (var j = k; j < bookmarks.length; j++) {
      var itemW = calcItemWidth(bookmarks[j], sett.displayMode, fs);
      var effective = currentRow === 1 ? extAvail - gearW - searchW : extAvail;
      if (rowUsed + itemW > effective && rowUsed > 0) {
        currentRow++;
        rowUsed = 0;
        if (sett.maxRows > 0 && currentRow > sett.maxRows) break;
      }
      result.push({ bookmark: bookmarks[j], width: itemW, row: currentRow });
      rowUsed += itemW;
    }
    return result;
  }

  // independent モード: 全ブックマークを拡張バーで描画（v1.5.1 方式）
  function calcIndependentLayout(bookmarks, windowWidth, sett) {
    var result = [];
    if (bookmarks.length === 0) return result;
    var fs = sett.fontSize || 12;
    var gearW = 24, searchW = 24;
    var availW = windowWidth - 16;
    var currentRow = 0, rowUsed = 0;
    for (var i = 0; i < bookmarks.length; i++) {
      var bm = bookmarks[i];
      var itemW = calcItemWidth(bm, sett.displayMode, fs);
      var effective = currentRow === 0 ? availW - gearW - searchW : availW;
      if (rowUsed + itemW > effective && rowUsed > 0) {
        currentRow++;
        rowUsed = 0;
        if (sett.maxRows > 0 && currentRow >= sett.maxRows) break;
      }
      result.push({ bookmark: bm, width: itemW, row: currentRow });
      rowUsed += itemW;
    }
    return result;
  }

  // ===== DOM Creation =====
  function createFolderIcon(className) {
    var span = document.createElement("span");
    span.className = className;
    return span;
  }

  function createBookmarkElement(item, displayMode) {
    var el = document.createElement("a");
    el.className = "mrbb-item";
    el.dataset.bmId = item.id;
    el.draggable = true;

    if (item.isFolder) {
      el.classList.add("mrbb-folder");
      el.href = "#";
      el.addEventListener("click", function (e) { e.preventDefault(); });
    } else {
      el.classList.add("mrbb-link");
      el.href = item.url || "#";
    }

    if (displayMode !== "text_only") {
      if (item.isFolder) {
        el.appendChild(createFolderIcon("mrbb-folder-icon"));
      } else {
        var img = document.createElement("img");
        img.className = "mrbb-favicon";
        img.width = 16; img.height = 16;
        if (item.url) { img.src = getFaviconUrl(item.url); img.onerror = function () { img.src = FALLBACK_ICON; }; }
        else { img.src = FALLBACK_ICON; }
        el.appendChild(img);
      }
    }
    if (displayMode !== "icon_only") {
      var span = document.createElement("span");
      span.className = "mrbb-title";
      span.textContent = item.title || (item.isFolder ? t("folderDefault") : "");
      el.appendChild(span);
    }
    return el;
  }

  // ===== Drag & Drop =====
  function isDragging() { return dragId !== null; }
  function setExternalDragId(id) { dragId = id; }

  // ドラッグ開始をバックグラウンドに通知（ネイティブバーへのドロップで
  // Chrome が複製を作った時に、元を消して「移動」にするため）
  function notifyDragStart(id, url, folderTitle) {
    try { chrome.runtime.sendMessage({ type: "MRBB_DRAG_START", id: id, url: url || null, folderTitle: folderTitle || null }); } catch (e) { /* ignore */ }
  }
  function notifyDragEnd() {
    try { chrome.runtime.sendMessage({ type: "MRBB_DRAG_END" }); } catch (e) { /* ignore */ }
  }

  // 外部ドラッグ（ネイティブバー / ページ上のリンク）のドロップ処理。
  // URL を伴うドロップのみ受け付ける。ネイティブバーのフォルダは Chrome が
  // dataTransfer を空（types が 0 件）で渡してくるため識別できない: フォルダは
  // URL を持たず、Chrome 内部の chromium/x-bookmark-entries でしか運ばれず、
  // この形式はウェブページに公開されない。URL 以外のテキストで代用しようとすると
  // ページ上の任意の文字列をドラッグしただけで同名フォルダが移動してしまう。
  function executeExternalDrop(dt) {
    if (!dropTarget) { cleanupDrag(); return; }
    var uri = "";
    try { uri = dt.getData("text/uri-list") || dt.getData("text/plain") || ""; } catch (e) { /* ignore */ }
    var url = uri.split("\n")[0].trim();
    if (url && /^https?:|^ftp:|^file:|^chrome:|^edge:|^about:/i.test(url)) {
      var dest = { parentId: dropTarget.parentId };
      if (dropTarget.index !== undefined) dest.index = dropTarget.index;
      var title = "";
      try {
        var html = dt.getData("text/html");
        if (html) title = new DOMParser().parseFromString(html, "text/html").body.textContent.trim();
      } catch (e) { /* ignore */ }
      chrome.runtime.sendMessage({ type: "MRBB_EXTERNAL_DROP", url: url, title: title, destination: dest });
    }
    cleanupDrag();
  }

  function getDropIndicator() {
    if (!dropIndicatorEl) {
      dropIndicatorEl = document.createElement("div");
      dropIndicatorEl.className = "mrbb-drop-indicator";
    }
    return dropIndicatorEl;
  }

  function clearFolderHighlight() {
    if (folderDropTarget) { folderDropTarget.classList.remove("mrbb-folder-drop-target"); folderDropTarget = null; }
    if (shadowRoot) shadowRoot.querySelectorAll(".mrbb-folder-drop-target").forEach(function (e) { e.classList.remove("mrbb-folder-drop-target"); });
  }

  function removeIndicator() {
    if (dropIndicatorEl) { dropIndicatorEl.remove(); dropIndicatorEl = null; }
  }

  function cleanupDrag() {
    if (shadowRoot) shadowRoot.querySelectorAll(".mrbb-dragging").forEach(function (e) { e.classList.remove("mrbb-dragging"); });
    removeIndicator();
    clearFolderHighlight();
    if (dragClone) { dragClone.remove(); dragClone = null; }
    dragId = null;
    dropTarget = null;
  }

  function executeMove() {
    if (!dragId || !dropTarget) { cleanupDrag(); return; }
    try {
      var dest = { parentId: dropTarget.parentId };
      if (dropTarget.index !== undefined) dest.index = dropTarget.index;
      chrome.runtime.sendMessage({ type: "MRBB_MOVE_BOOKMARK", id: dragId, destination: dest });
    } catch (e) { console.warn("[MRBB] move failed:", e); }
    cleanupDrag();
  }

  // バー上の D&D: overflow モードでは拡張バーの先頭アイテムはブックマークバー全体の
  // 途中の index になるため、要素に持たせた data-bm-index（実 index）で移動先を決める
  function setupBarDragDrop(container) {
    container.addEventListener("dragstart", function (e) {
      var item = e.target.closest(".mrbb-item");
      if (!item || !item.dataset.bmId) return;
      dragId = item.dataset.bmId;
      item.classList.add("mrbb-dragging");
      // "move" のみだとネイティブバー側（copy/link で受ける）が
      // ドロップを拒否するため copy/move/link すべて許可する
      e.dataTransfer.effectAllowed = "all";
      // URL を載せておくと Chrome ネイティブバーへのドロップが可能になる
      var href = item.getAttribute("href");
      if (href && href !== "#") {
        e.dataTransfer.setData("text/uri-list", href);
        e.dataTransfer.setData("text/plain", href);
        notifyDragStart(dragId, href, null);
      } else {
        // フォルダ: タイトルを渡す（dragId を渡すと Chrome が壊れたブックマークを作る）
        var titleEl = item.querySelector(".mrbb-title");
        var folderTitle = titleEl ? titleEl.textContent : "";
        e.dataTransfer.setData("text/plain", folderTitle || dragId);
        notifyDragStart(dragId, null, folderTitle);
      }
      if (e.dataTransfer.setDragImage) {
        var clone = item.cloneNode(true);
        clone.style.opacity = "0.8";
        clone.style.position = "absolute";
        clone.style.top = "-1000px";
        clone.style.left = "-1000px";
        document.body.appendChild(clone);
        e.dataTransfer.setDragImage(clone, e.offsetX, e.offsetY);
        dragClone = clone;
      }
    });

    container.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      var rows = container.querySelectorAll(".mrbb-row");
      var targetRow = null;
      for (var r = 0; r < rows.length; r++) {
        var rect = rows[r].getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) { targetRow = rows[r]; break; }
      }
      if (!targetRow) { removeIndicator(); clearFolderHighlight(); return; }

      var items = Array.from(targetRow.querySelectorAll(".mrbb-item:not(.mrbb-dragging)"));
      var beforeItem = null, insertX = 0;
      for (var i = 0; i < items.length; i++) {
        var ir = items[i].getBoundingClientRect();
        if (items[i].classList.contains("mrbb-folder") && items[i].dataset.bmId !== dragId && e.clientX >= ir.left + ir.width * 0.25 && e.clientX <= ir.left + ir.width * 0.75) {
          clearFolderHighlight();
          items[i].classList.add("mrbb-folder-drop-target");
          folderDropTarget = items[i];
          var fid = items[i].dataset.bmId;
          if (fid) dropTarget = { parentId: fid };
          removeIndicator();
          e.stopPropagation();
          return;
        }
        var mid = ir.left + ir.width / 2;
        if (e.clientX < mid) { beforeItem = items[i]; insertX = ir.left; break; }
      }
      clearFolderHighlight();
      if (!beforeItem && items.length > 0) insertX = items[items.length - 1].getBoundingClientRect().right;

      var ind = getDropIndicator();
      var rowRect = targetRow.getBoundingClientRect();
      ind.style.position = "fixed";
      ind.style.top = fx(rowRect.top + 2);
      ind.style.left = fx(insertX - 1);
      ind.style.height = fx(rowRect.height - 4);
      ind.style.width = fx(2);
      ind.style.zIndex = "2147483647";
      if (!ind.parentElement && shadowRoot) shadowRoot.appendChild(ind);

      if (beforeItem) {
        var bIdx = parseInt(beforeItem.dataset.bmIndex, 10);
        dropTarget = { parentId: "1", index: isNaN(bIdx) ? 0 : bIdx };
      } else if (items.length > 0) {
        var lIdx = parseInt(items[items.length - 1].dataset.bmIndex, 10);
        dropTarget = { parentId: "1", index: isNaN(lIdx) ? 0 : lIdx + 1 };
      } else {
        dropTarget = { parentId: "1" };
      }
    });

    container.addEventListener("dragend", function () { cleanupDrag(); notifyDragEnd(); });
    container.addEventListener("drop", function (e) {
      e.preventDefault();
      if (dragId) { executeMove(); return; }
      executeExternalDrop(e.dataTransfer);
    });

    // カーソルがバーの外に出たら挿入線を消す。
    // ネイティブバー（ブラウザ chrome 領域）へ出た場合はページに drag イベントが
    // 一切来なくなるため、最後に表示した挿入線が残って紛らわしい
    if (!dragDocBound) {
      dragDocBound = true;
      document.addEventListener("dragover", function (e) {
        if (!dropIndicatorEl && !folderDropTarget) return;
        var path = e.composedPath ? e.composedPath() : [];
        if (hostEl && path.indexOf(hostEl) === -1) {
          removeIndicator();
          clearFolderHighlight();
          dropTarget = null;
        }
      }, true);
      document.addEventListener("dragleave", function (e) {
        // relatedTarget === null はウィンドウ外（ネイティブバー等）への離脱
        if (e.relatedTarget === null) {
          removeIndicator();
          clearFolderHighlight();
          dropTarget = null;
        }
      }, true);
    }
  }

  // カスタム背景色の適用。文字・アイコン・ホバー色は背景の輝度から自動導出する。
  // インラインスタイルなので content.css のライト/ダーク両方の :host 定義に勝つ。
  // 空文字なら削除して標準色（prefers-color-scheme 追従)に戻す
  function applyBarColor(host) {
    var c = settings.barColor;
    var derived = ["--mrbb-bg", "--mrbb-text", "--mrbb-icon", "--mrbb-hover", "--mrbb-active", "--mrbb-border"];
    if (!c || !/^#[0-9a-fA-F]{6}$/.test(c)) {
      derived.forEach(function (v) { host.style.removeProperty(v); });
      return;
    }
    var r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
    var light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 >= 0.5;
    host.style.setProperty("--mrbb-bg", c);
    host.style.setProperty("--mrbb-text", light ? "#474747" : "#e8e8e8");
    host.style.setProperty("--mrbb-icon", light ? "#474747" : "#e8e8e8");
    host.style.setProperty("--mrbb-hover", light ? "rgba(31,31,31,0.08)" : "rgba(232,232,232,0.14)");
    host.style.setProperty("--mrbb-active", light ? "rgba(31,31,31,0.12)" : "rgba(232,232,232,0.2)");
    host.style.setProperty("--mrbb-border", light ? "rgba(31,31,31,0.12)" : "rgba(255,255,255,0.14)");
  }

  function setupDropdownDragDrop(dropdown, parentId) {
    dropdown.addEventListener("dragover", function (e) {
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      var rows = Array.from(dropdown.querySelectorAll(".mrbb-dropdown-row:not(.mrbb-dragging)"));
      var ind = getDropIndicator();
      var before = null, insertY = 0;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i].getBoundingClientRect();
        var midY = r.top + r.height / 2;
        if (rows[i].classList.contains("mrbb-dropdown-folder") && rows[i].dataset.bmId !== dragId && e.clientY >= r.top + r.height * 0.25 && e.clientY <= r.top + r.height * 0.75) {
          clearFolderHighlight();
          rows[i].classList.add("mrbb-folder-drop-target");
          folderDropTarget = rows[i];
          var fid = rows[i].dataset.bmId;
          if (fid) dropTarget = { parentId: fid };
          removeIndicator();
          return;
        }
        if (e.clientY < midY) { before = rows[i]; insertY = r.top; break; }
      }
      clearFolderHighlight();
      if (!before && rows.length > 0) insertY = rows[rows.length - 1].getBoundingClientRect().bottom;
      var ddr = dropdown.getBoundingClientRect();
      ind.style.position = "fixed";
      ind.style.top = fx(insertY - 1);
      ind.style.left = fx(ddr.left + 8);
      ind.style.width = fx(ddr.width - 16);
      ind.style.height = fx(2);
      ind.style.zIndex = "2147483647";
      if (!ind.parentElement && shadowRoot) shadowRoot.appendChild(ind);
      if (before) {
        var idx = rows.indexOf(before);
        dropTarget = { parentId: parentId, index: idx >= 0 ? idx : 0 };
      } else {
        dropTarget = { parentId: parentId, index: rows.length };
      }
    });
    dropdown.addEventListener("drop", function (e) {
      e.preventDefault(); e.stopPropagation();
      if (dragId) { executeMove(); return; }
      executeExternalDrop(e.dataTransfer);
    });
  }

  // ===== Context Menu =====
  function closeContextMenu() { if (activeContextMenu) { activeContextMenu.remove(); activeContextMenu = null; } }

  function createMenuItem(label, handler) {
    var div = document.createElement("div");
    div.className = "mrbb-context-item";
    div.textContent = label;
    div.addEventListener("mousedown", function (e) { e.preventDefault(); e.stopPropagation(); closeContextMenu(); handler(); });
    return div;
  }
  function createMenuSeparator() {
    var div = document.createElement("div");
    div.className = "mrbb-context-separator";
    return div;
  }

  // ショートカットスロット選択メニュー（ブックマーク右クリック → 割り当て）
  function openShortcutSlotMenu(x, y, bm) {
    chrome.runtime.sendMessage({ type: "MRBB_SHORTCUTS_INFO" }, function (resp) {
      if (!resp) return;
      var slots = resp.slots || {}, keys = resp.keys || {};
      var assignedSlot = null;
      for (var i = 1; i <= 9; i++) {
        if (slots[String(i)] && slots[String(i)].id === bm.id) assignedSlot = i;
      }
      var menu = document.createElement("div");
      menu.className = "mrbb-context-menu";
      var makeSlotItem = function (n) {
        var key = keys["open-bookmark-" + n] || t("scNoKey");
        var cur = slots[String(n)];
        var occupant = cur ? (cur.title || cur.url || "").slice(0, 24) : t("scEmpty");
        var label = (assignedSlot === n ? "✓ " : "") + key + " — " + occupant;
        return createMenuItem(label, function () {
          // ✓ 済みスロットをもう一度選ぶと解除
          chrome.runtime.sendMessage({
            type: "MRBB_SHORTCUT_SET",
            slot: n,
            bookmark: assignedSlot === n ? null : { id: bm.id, title: bm.title, url: bm.url },
          });
        });
      };
      for (var n = 1; n <= 9; n++) menu.appendChild(makeSlotItem(n));
      menu.appendChild(createMenuSeparator());
      menu.appendChild(createMenuItem(t("scOpenSettings"), function () {
        chrome.runtime.sendMessage({ type: "MRBB_OPEN_SHORTCUTS_PAGE" });
      }));
      showContextMenu(x, y, menu);
    });
  }

  function addItemActions(menu, id, isFolder, title, url, parentId) {
    if (!isFolder && url && url !== "#") {
      menu.appendChild(createMenuItem(t("openInNewTab"), function () { chrome.runtime.sendMessage({ type: "MRBB_OPEN_TAB", url: url }); }));
      // ショートカット割当はサブメニューを開くため、親メニューを閉じる document の
      // click(capture) が処理された後に開く必要がある → mousedown ではなく click で処理
      var sc = document.createElement("div");
      sc.className = "mrbb-context-item";
      sc.textContent = t("assignShortcut");
      sc.addEventListener("mousedown", function (e) { e.preventDefault(); e.stopPropagation(); });
      sc.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        closeContextMenu();
        openShortcutSlotMenu(e.clientX, e.clientY, { id: id, title: title, url: url });
      });
      menu.appendChild(sc);
      menu.appendChild(createMenuSeparator());
    }
    if (isFolder) {
      menu.appendChild(createMenuItem(t("openAllInTabs"), function () { chrome.runtime.sendMessage({ type: "MRBB_OPEN_ALL_IN_TABS", folderId: id }); }));
      menu.appendChild(createMenuSeparator());
    }
    menu.appendChild(createMenuItem(t("rename"), function () {
      var n = prompt(t("promptNewName"), title);
      if (n !== null && n !== title) chrome.runtime.sendMessage({ type: "MRBB_UPDATE_BOOKMARK", id: id, changes: { title: n } });
    }));
    if (!isFolder) {
      menu.appendChild(createMenuItem(t("editUrl"), function () {
        var u = prompt(t("promptNewUrl"), url);
        if (u !== null && u !== url) chrome.runtime.sendMessage({ type: "MRBB_UPDATE_BOOKMARK", id: id, changes: { url: u } });
      }));
    }
    if (parentId !== "1") {
      menu.appendChild(createMenuItem(t("moveToBookmarkBar"), function () { chrome.runtime.sendMessage({ type: "MRBB_MOVE_BOOKMARK", id: id, destination: { parentId: "1" } }); }));
    }
    menu.appendChild(createMenuSeparator());
    menu.appendChild(createMenuItem(t("deleteItem"), function () { chrome.runtime.sendMessage({ type: "MRBB_DELETE_BOOKMARK", id: id, isFolder: isFolder }); }));
    menu.appendChild(createMenuSeparator());
  }

  function addCommonActions(menu, parentId) {
    menu.appendChild(createMenuItem(t("addPage"), function () {
      var name = prompt(t("promptBookmarkName"), document.title);
      if (name === null) return;
      var u = prompt(t("promptUrl"), window.location.href);
      if (u !== null) chrome.runtime.sendMessage({ type: "MRBB_CREATE_BOOKMARK", parentId: parentId, title: name, url: u });
    }));
    menu.appendChild(createMenuItem(t("addFolder"), function () {
      var name = prompt(t("promptFolderName"));
      if (name !== null && name.trim() !== "") chrome.runtime.sendMessage({ type: "MRBB_CREATE_FOLDER", parentId: parentId, title: name.trim() });
    }));
    menu.appendChild(createMenuSeparator());
    menu.appendChild(createMenuItem(t("sortByName"), function () { chrome.runtime.sendMessage({ type: "MRBB_SORT_BOOKMARKS", parentId: parentId, sortBy: "title" }); }));
    menu.appendChild(createMenuItem(t("sortByUrl"), function () { chrome.runtime.sendMessage({ type: "MRBB_SORT_BOOKMARKS", parentId: parentId, sortBy: "url" }); }));
    menu.appendChild(createMenuItem(t("sortByDateAdded"), function () { chrome.runtime.sendMessage({ type: "MRBB_SORT_BOOKMARKS", parentId: parentId, sortBy: "dateAdded" }); }));
  }

  function showContextMenu(x, y, menu) {
    menu.style.position = "fixed";
    menu.style.zIndex = "2147483647";
    menu.style.left = "-9999px";
    menu.style.top = "-9999px";
    if (shadowRoot) shadowRoot.appendChild(menu);
    var rect = menu.getBoundingClientRect();
    var left = x, top = y;
    if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width - 4;
    if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 4;
    menu.style.left = fx(left);
    menu.style.top = fx(top);
    activeContextMenu = menu;
    menu.addEventListener("contextmenu", function (e) { e.preventDefault(); e.stopPropagation(); });
  }

  function setupContextMenuOnBar(container) {
    container.addEventListener("contextmenu", function (e) {
      e.preventDefault(); e.stopPropagation();
      closeDropdown(true); closeContextMenu();
      var item = e.target.closest(".mrbb-item");
      var menu = document.createElement("div");
      menu.className = "mrbb-context-menu";
      if (item && item.dataset.bmId) {
        var titleEl = item.querySelector(".mrbb-title");
        addItemActions(menu, item.dataset.bmId, item.classList.contains("mrbb-folder"), titleEl ? titleEl.textContent : "", item.getAttribute("href") || "", "1");
      }
      addCommonActions(menu, "1");
      showContextMenu(e.clientX, e.clientY, menu);
    });
    if (!contextMenuBound) {
      document.addEventListener("click", function () { closeContextMenu(); }, true);
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeContextMenu(); });
      contextMenuBound = true;
    }
  }

  function setupContextMenuOnDropdownItem(el, id, isFolder, title, url, parentId) {
    el.addEventListener("contextmenu", function (e) {
      e.preventDefault(); e.stopPropagation();
      closeContextMenu();
      var menu = document.createElement("div");
      menu.className = "mrbb-context-menu";
      addItemActions(menu, id, isFolder, title, url, parentId);
      addCommonActions(menu, parentId);
      showContextMenu(e.clientX, e.clientY, menu);
    });
  }

  // ===== Folder Dropdown =====
  function closeDropdown(force) {
    if (!force && isDragging()) return;
    if (dropdownOutsideHandler) { document.removeEventListener("mousedown", dropdownOutsideHandler, true); dropdownOutsideHandler = null; }
    if (dropdownCleanup) { dropdownCleanup(); dropdownCleanup = null; }
    if (activeDropdown) { activeDropdown.remove(); activeDropdown = null; }
    activeDropdownAnchor = null;
    if (shadowRoot) shadowRoot.querySelectorAll(".mrbb-sub-dropdown").forEach(function (e) { e.remove(); });
  }

  function setupHoverTracking(anchor, dropdown, timeout) {
    var timer = null;
    var isInside = function (mx, my) {
      var ar = anchor.getBoundingClientRect();
      if (mx >= ar.left - 8 && mx <= ar.right + 8 && my >= ar.top - 4 && my <= ar.bottom + 4) return true;
      var dr = dropdown.getBoundingClientRect();
      if (mx >= dr.left - 4 && mx <= dr.right + 4 && my >= dr.top - 12 && my <= dr.bottom + 4) return true;
      if (my >= ar.bottom - 4 && my <= dr.top + 8) {
        var l = Math.min(ar.left, dr.left) - 8, r = Math.max(ar.right, dr.right) + 8;
        if (mx >= l && mx <= r) return true;
      }
      if (shadowRoot) {
        var subs = shadowRoot.querySelectorAll(".mrbb-sub-dropdown");
        for (var i = 0; i < subs.length; i++) {
          var sr = subs[i].getBoundingClientRect();
          if (mx >= sr.left - 4 && mx <= sr.right + 4 && my >= sr.top - 4 && my <= sr.bottom + 4) return true;
        }
      }
      return false;
    };
    var onMove = function (e) {
      if (isDragging()) { if (timer) { clearTimeout(timer); timer = null; } return; }
      if (isInside(e.clientX, e.clientY)) { if (timer) { clearTimeout(timer); timer = null; } }
      else if (!timer) { timer = setTimeout(function () { closeDropdown(false); }, timeout); }
    };
    document.addEventListener("mousemove", onMove, true);
    var cancel = function () { if (timer) { clearTimeout(timer); timer = null; } };
    dropdown.addEventListener("dragenter", cancel);
    dropdown.addEventListener("dragover", cancel);
    return function () {
      document.removeEventListener("mousemove", onMove, true);
      dropdown.removeEventListener("dragenter", cancel);
      dropdown.removeEventListener("dragover", cancel);
      if (timer) { clearTimeout(timer); timer = null; }
    };
  }

  function openDropdown(folder, anchor, mode) {
    if (mode === "click" && activeDropdownAnchor === anchor && activeDropdown) { closeDropdown(true); return; }
    closeDropdown(true);
    var dd = document.createElement("div");
    dd.className = "mrbb-dropdown";
    dd.id = "mrbb-dropdown-" + folder.id;
    if (!folder.children || folder.children.length === 0) {
      var empty = document.createElement("div");
      empty.className = "mrbb-dropdown-empty";
      empty.textContent = t("empty");
      dd.appendChild(empty);
    } else {
      for (var i = 0; i < folder.children.length; i++) {
        dd.appendChild(createDropdownItem(folder.children[i], folder.id));
      }
    }
    setupDropdownDragDrop(dd, folder.id);
    var ar = anchor.getBoundingClientRect();
    dd.style.position = "fixed";
    dd.style.top = fx(ar.bottom - 4);
    dd.style.left = fx(ar.left);
    dd.style.zIndex = "2147483647";
    dd.style.paddingTop = "4px";
    // 画面下端まで自然に伸ばし、入り切らない時だけスクロール
    dd.style.maxHeight = fx(Math.max(120, window.innerHeight - (ar.bottom - 4) - 8));
    if (shadowRoot) shadowRoot.appendChild(dd);
    activeDropdown = dd;
    activeDropdownAnchor = anchor;

    var ddr = dd.getBoundingClientRect();
    if (ddr.right > window.innerWidth) dd.style.left = fx(window.innerWidth - ddr.width - 4);
    if (ddr.bottom > window.innerHeight) dd.style.top = fx(Math.max(4, window.innerHeight - ddr.height - 4));

    if (mode === "hover") {
      dropdownCleanup = setupHoverTracking(anchor, dd, settings.hoverCloseMs !== undefined ? settings.hoverCloseMs : 400);
    }
    if (mode === "click") {
      var handler = function (e) {
        var path = e.composedPath ? e.composedPath() : [e.target];
        if (path.indexOf(dd) !== -1 || path.indexOf(anchor) !== -1) return;
        if (shadowRoot) { var subs = shadowRoot.querySelectorAll(".mrbb-sub-dropdown"); for (var i = 0; i < subs.length; i++) if (path.indexOf(subs[i]) !== -1) return; }
        closeDropdown(true);
      };
      setTimeout(function () { document.addEventListener("mousedown", handler, true); dropdownOutsideHandler = handler; }, 0);
    }
  }

  function createDropdownItem(item, parentId) {
    var el = document.createElement("a");
    el.className = "mrbb-dropdown-row";
    el.dataset.bmId = item.id;
    el.draggable = true;
    el.addEventListener("dragstart", function (e) {
      e.stopPropagation();
      setExternalDragId(item.id);
      el.classList.add("mrbb-dragging");
      e.dataTransfer.effectAllowed = "all";
      if (item.url) {
        e.dataTransfer.setData("text/uri-list", item.url);
        e.dataTransfer.setData("text/plain", item.url);
        notifyDragStart(item.id, item.url, null);
      } else {
        e.dataTransfer.setData("text/plain", item.title || "");
        notifyDragStart(item.id, null, item.title || "");
      }
    });
    el.addEventListener("dragend", function () { cleanupDrag(); notifyDragEnd(); });

    if (item.isFolder) {
      el.classList.add("mrbb-dropdown-folder");
      el.href = "#";
      el.addEventListener("click", function (e) { e.preventDefault(); });
      var subCleanup = null;
      el.addEventListener("mouseenter", function () {
        if (isDragging()) return;
        if (shadowRoot) shadowRoot.querySelectorAll(".mrbb-sub-dropdown").forEach(function (s) { s.remove(); });
        if (subCleanup) { subCleanup(); subCleanup = null; }
        var sub = document.createElement("div");
        sub.className = "mrbb-dropdown mrbb-sub-dropdown";
        if (!item.children || item.children.length === 0) {
          var emp = document.createElement("div"); emp.className = "mrbb-dropdown-empty"; emp.textContent = t("empty"); sub.appendChild(emp);
        } else {
          for (var i = 0; i < item.children.length; i++) sub.appendChild(createDropdownItem(item.children[i], item.id));
        }
        setupDropdownDragDrop(sub, item.id);
        var er = el.getBoundingClientRect();
        sub.style.position = "fixed";
        sub.style.top = fx(er.top);
        sub.style.left = fx(er.right - 4);
        sub.style.paddingLeft = "4px";
        sub.style.zIndex = "2147483647";
        sub.style.maxHeight = fx(Math.max(120, window.innerHeight - er.top - 8));
        if (shadowRoot) shadowRoot.appendChild(sub);
        var sr = sub.getBoundingClientRect();
        if (sr.right > window.innerWidth) { sub.style.left = fx(er.left - sr.width + 4); sub.style.paddingLeft = "0"; sub.style.paddingRight = "4px"; }
        if (sr.bottom > window.innerHeight) sub.style.top = fx(Math.max(4, window.innerHeight - sr.height - 4));

        var subTimer = null;
        var onSubMove = function (ev) {
          if (isDragging()) { if (subTimer) { clearTimeout(subTimer); subTimer = null; } return; }
          var elR = el.getBoundingClientRect(), subR = sub.getBoundingClientRect();
          var inEl = ev.clientX >= elR.left - 4 && ev.clientX <= elR.right + 4 && ev.clientY >= elR.top - 4 && ev.clientY <= elR.bottom + 4;
          var inSub = ev.clientX >= subR.left - 8 && ev.clientX <= subR.right + 4 && ev.clientY >= subR.top - 4 && ev.clientY <= subR.bottom + 4;
          var inBridge = ev.clientY >= Math.min(elR.top, subR.top) - 4 && ev.clientY <= Math.max(elR.bottom, subR.bottom) + 4 && ev.clientX >= elR.right - 8 && ev.clientX <= subR.left + 8;
          if (inEl || inSub || inBridge) { if (subTimer) { clearTimeout(subTimer); subTimer = null; } }
          else if (!subTimer) { subTimer = setTimeout(function () { sub.remove(); document.removeEventListener("mousemove", onSubMove, true); }, settings.hoverCloseMs !== undefined ? settings.hoverCloseMs : 400); }
        };
        document.addEventListener("mousemove", onSubMove, true);
        subCleanup = function () { document.removeEventListener("mousemove", onSubMove, true); if (subTimer) { clearTimeout(subTimer); subTimer = null; } };
      });
    } else {
      el.href = item.url || "#";
    }

    setupContextMenuOnDropdownItem(el, item.id, item.isFolder, item.title || "", item.url || "", parentId);

    if (item.isFolder) {
      el.appendChild(createFolderIcon("mrbb-folder-icon mrbb-dropdown-icon"));
    } else {
      var icon = document.createElement("img");
      icon.className = "mrbb-dropdown-icon";
      icon.width = 16; icon.height = 16;
      icon.src = item.url ? getFaviconUrl(item.url) : "";
      icon.onerror = function () { icon.src = FALLBACK_ICON; };
      el.appendChild(icon);
    }

    var text = document.createElement("span");
    text.className = "mrbb-dropdown-text";
    text.textContent = item.title || (item.url || "");
    el.appendChild(text);

    if (item.isFolder) {
      var arrow = document.createElement("span");
      arrow.className = "mrbb-dropdown-arrow";
      arrow.textContent = "▶";
      el.appendChild(arrow);
    }
    return el;
  }

  // ===== Settings Panel =====
  function createGearButton() {
    var btn = document.createElement("div");
    btn.className = "mrbb-gear-btn";
    btn.title = t("settingsTooltip");
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M8.58 2.06A1 1 0 0 1 9.56 1h.88a1 1 0 0 1 .98.84l.18 1.28a6.02 6.02 0 0 1 1.56.64l1.08-.72a1 1 0 0 1 1.28.14l.62.62a1 1 0 0 1 .14 1.28l-.72 1.08c.28.48.48 1 .64 1.56l1.28.18a1 1 0 0 1 .84.98v.88a1 1 0 0 1-.84.98l-1.28.18a6.02 6.02 0 0 1-.64 1.56l.72 1.08a1 1 0 0 1-.14 1.28l-.62.62a1 1 0 0 1-1.28.14l-1.08-.72c-.48.28-1 .48-1.56.64l-.18 1.28a1 1 0 0 1-.98.84h-.88a1 1 0 0 1-.98-.84l-.18-1.28a6.02 6.02 0 0 1-1.56-.64l-1.08.72a1 1 0 0 1-1.28-.14l-.62-.62a1 1 0 0 1-.14-1.28l.72-1.08a6.02 6.02 0 0 1-.64-1.56l-1.28-.18A1 1 0 0 1 1 10.44v-.88a1 1 0 0 1 .84-.98l1.28-.18a6.02 6.02 0 0 1 .64-1.56l-.72-1.08a1 1 0 0 1 .14-1.28l.62-.62a1 1 0 0 1 1.28-.14l1.08.72c.48-.28 1-.48 1.56-.64l.18-1.28zM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/></svg>';
    btn.addEventListener("click", function (e) { e.stopPropagation(); toggleSettingsPanel(btn); });
    return btn;
  }

  function toggleSettingsPanel(gearBtn) {
    var existing = shadowRoot ? shadowRoot.querySelector(".mrbb-settings-panel") : null;
    if (existing) { existing.remove(); return; }
    var panel = document.createElement("div");
    panel.className = "mrbb-settings-panel";
    var fs = settings.fontSize || 12;
    var bh = settings.barHeight || 36;
    panel.innerHTML = '<div class="mrbb-settings-title">Multi-Row Bookmark Bar</div>' +
      '<div class="mrbb-settings-row"><span>' + t("fontSize") + ' <span class="mrbb-info" data-info="fontSizeInfo" title="' + t("fontSizeInfo").replace(/"/g, "&quot;") + '">&#9432;</span></span><div class="mrbb-settings-fontsize"><button data-action="fs-dec">-</button><span id="mrbb-fs-val">' + fs + 'px</span><button data-action="fs-inc">+</button></div></div>' +
      '<div class="mrbb-settings-row"><span>' + t("rowHeight") + ' <span class="mrbb-info" data-info="rowHeightInfo" title="' + t("rowHeightInfo").replace(/"/g, "&quot;") + '">&#9432;</span></span><div class="mrbb-settings-fontsize"><button data-action="bh-dec">-</button><span id="mrbb-bh-val">' + bh + 'px</span><button data-action="bh-inc">+</button></div></div>' +
      '<div class="mrbb-settings-row"><span>' + t("maxRows") + ' <span class="mrbb-info" data-info="maxRowsInfo" title="' + t("maxRowsInfo").replace(/"/g, "&quot;") + '">&#9432;</span></span><input type="number" id="mrbb-mr-inp" value="' + settings.maxRows + '" min="0" max="20" style="width:48px;text-align:center;border:1px solid #dadce0;border-radius:3px;padding:2px 4px;font-size:12px;"></div>' +
      '<div class="mrbb-settings-row"><span>' + t("folderOpen") + ' <span class="mrbb-info" data-info="folderOpenInfo" title="' + t("folderOpenInfo").replace(/"/g, "&quot;") + '">&#9432;</span></span><select id="mrbb-fo-sel" style="border:1px solid #dadce0;border-radius:3px;padding:2px 4px;font-size:12px;"><option value="hover"' + (settings.folderOpenMode === "hover" ? " selected" : "") + '>' + t("hover") + '</option><option value="click"' + (settings.folderOpenMode === "click" ? " selected" : "") + '>' + t("click") + '</option></select></div>' +
      '<div class="mrbb-settings-row"><span>' + t("barMode") + ' <span class="mrbb-info" data-info="barModeInfo" title="' + t("barModeInfo").replace(/"/g, "&quot;") + '">&#9432;</span></span><select id="mrbb-bm-sel" style="border:1px solid #dadce0;border-radius:3px;padding:2px 4px;font-size:12px;"><option value="overflow"' + (settings.barMode === "overflow" ? " selected" : "") + '>' + t("overflowOnly") + '</option><option value="independent"' + (settings.barMode === "independent" ? " selected" : "") + '>' + t("allBookmarks") + '</option></select></div>' +
      '<div class="mrbb-settings-row"><span>' + t("displayBehavior") + ' <span class="mrbb-info" data-info="displayBehaviorDesc" title="' + t("displayBehaviorDesc").replace(/"/g, "&quot;") + '">&#9432;</span></span><select id="mrbb-db-sel" title="' + t("pushWarning") + '" style="border:1px solid #dadce0;border-radius:3px;padding:2px 4px;font-size:12px;"><option value="autohide"' + (settings.displayBehavior !== "push" ? " selected" : "") + '>' + t("autohideOption") + '</option><option value="push"' + (settings.displayBehavior === "push" ? " selected" : "") + ' title="' + t("pushWarning") + '">' + t("pushOption") + '</option></select></div>' +
      '<div class="mrbb-settings-row"><span>' + t("boundaryAdjust") + ' <span class="mrbb-info" data-info="boundaryInfo" title="' + t("boundaryInfo").replace(/"/g, "&quot;") + '">&#9432;</span></span><div class="mrbb-settings-fontsize"><button data-action="bo-dec" title="' + t("boundaryEarlier") + '">◀</button><span id="mrbb-bo-val">' + (settings.boundaryOffsetPx || 0) + 'px</span><button data-action="bo-inc" title="' + t("boundaryLater") + '">▶</button></div></div>' +
      '<div class="mrbb-settings-row"><span>' + t("hoverCloseDelay") + ' <span class="mrbb-info" data-info="hoverCloseDelayDesc" title="' + t("hoverCloseDelayDesc").replace(/"/g, "&quot;") + '">&#9432;</span></span><div class="mrbb-settings-fontsize"><button data-action="hc-dec">-</button><span id="mrbb-hc-val">' + (settings.hoverCloseMs !== undefined ? settings.hoverCloseMs : 400) + 'ms</span><button data-action="hc-inc">+</button></div></div>' +
      '<div class="mrbb-settings-row"><span>' + t("revealEdge") + ' <span class="mrbb-info" data-info="revealEdgeDesc" title="' + t("revealEdgeDesc").replace(/"/g, "&quot;") + '">&#9432;</span></span><div class="mrbb-settings-fontsize"><button data-action="re-dec">-</button><span id="mrbb-re-val">' + (settings.revealEdgePx || 2) + 'px</span><button data-action="re-inc">+</button></div></div>' +
      '<div class="mrbb-settings-row"><span>' + t("revealDelay") + ' <span class="mrbb-info" data-info="revealDelayInfo" title="' + t("revealDelayInfo").replace(/"/g, "&quot;") + '">&#9432;</span></span><div class="mrbb-settings-fontsize"><button data-action="rd-dec">-</button><span id="mrbb-rd-val">' + (settings.revealDelayMs || 0) + 'ms</span><button data-action="rd-inc">+</button></div></div>' +
      '<div class="mrbb-settings-row"><span>' + t("autohideDelay") + ' <span class="mrbb-info" data-info="autohideDelayDesc" title="' + t("autohideDelayDesc").replace(/"/g, "&quot;") + '">&#9432;</span></span><div class="mrbb-settings-fontsize"><button data-action="ad-dec">-</button><span id="mrbb-ad-val">' + (settings.autohideDelayMs !== undefined ? settings.autohideDelayMs : 400) + 'ms</span><button data-action="ad-inc">+</button></div></div>' +
      '<div class="mrbb-settings-row"><span>' + t("barColor") + ' <span class="mrbb-info" data-info="barColorDesc" title="' + t("barColorDesc").replace(/"/g, "&quot;") + '">&#9432;</span></span><div class="mrbb-settings-fontsize"><input type="color" id="mrbb-bc-input" value="' + (settings.barColor || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "#282828" : "#ffffff")) + '"><button data-action="bc-reset" title="' + t("barColorReset").replace(/"/g, "&quot;") + '">&#8634;</button></div></div>' +
      '<div class="mrbb-settings-row"><span>' + t("hideOnClick") + ' <span class="mrbb-info" data-info="hideOnClickInfo" title="' + t("hideOnClickInfo").replace(/"/g, "&quot;") + '">&#9432;</span></span><input type="checkbox" id="mrbb-hoc-chk"' + (settings.hideOnClick ? " checked" : "") + '></div>' +
      '<div class="mrbb-settings-row"><span>' + t("hideOnOutsideClick") + ' <span class="mrbb-info" data-info="hideOnOutsideClickInfo" title="' + t("hideOnOutsideClickInfo").replace(/"/g, "&quot;") + '">&#9432;</span></span><input type="checkbox" id="mrbb-hooc-chk"' + (settings.hideOnOutsideClick ? " checked" : "") + '></div>' +
      '<div class="mrbb-settings-row"><span>' + t("language") + ' <span class="mrbb-info" data-info="languageInfo" title="' + t("languageInfo").replace(/"/g, "&quot;") + '">&#9432;</span></span><select id="mrbb-lang-sel" style="border:1px solid #dadce0;border-radius:3px;padding:2px 4px;font-size:12px;"><option value="auto"' + ((settings.language || "auto") === "auto" ? " selected" : "") + '>' + t("langAuto") + '</option><option value="en"' + (settings.language === "en" ? " selected" : "") + '>English</option><option value="ja"' + (settings.language === "ja" ? " selected" : "") + '>日本語</option></select></div>';

    // 表示方式が「押し下げ」の時は注意書きを常時表示
    var dbRow = panel.querySelector("#mrbb-db-sel").closest(".mrbb-settings-row");
    var pushWarn = document.createElement("div");
    pushWarn.className = "mrbb-info-text";
    pushWarn.id = "mrbb-push-warn";
    pushWarn.textContent = t("pushWarning");
    if (settings.displayBehavior !== "push") pushWarn.style.display = "none";
    dbRow.parentNode.insertBefore(pushWarn, dbRow.nextSibling);

    // ⓘ クリックで説明文を行の下に展開/格納（ホバーでもツールチップ表示）
    panel.querySelectorAll(".mrbb-info").forEach(function (ic) {
      ic.addEventListener("click", function (e) {
        e.stopPropagation();
        var key = ic.dataset.info;
        var existing = panel.querySelector('.mrbb-info-text[data-for="' + key + '"]');
        if (existing) { existing.remove(); return; }
        var div = document.createElement("div");
        div.className = "mrbb-info-text";
        div.dataset.for = key;
        div.textContent = t(key);
        var row = ic.closest(".mrbb-settings-row");
        row.parentNode.insertBefore(div, row.nextSibling);
      });
    });

    var gr = gearBtn.getBoundingClientRect();
    panel.style.top = fx(gr.bottom + 4);
    panel.style.left = fx(gr.left);
    if (shadowRoot) shadowRoot.appendChild(panel);

    var fsValEl = panel.querySelector("#mrbb-fs-val");
    var bhValEl = panel.querySelector("#mrbb-bh-val");
    panel.querySelector('[data-action="fs-dec"]').addEventListener("click", function () {
      var v = Math.max(8, (settings.fontSize || 12) - 1); settings.fontSize = v; saveSettings(); if (fsValEl) fsValEl.textContent = v + "px";
    });
    panel.querySelector('[data-action="fs-inc"]').addEventListener("click", function () {
      var v = Math.min(20, (settings.fontSize || 12) + 1); settings.fontSize = v; saveSettings(); if (fsValEl) fsValEl.textContent = v + "px";
    });
    panel.querySelector('[data-action="bh-dec"]').addEventListener("click", function () {
      var v = Math.max(20, (settings.barHeight || 36) - 2); settings.barHeight = v; saveSettings(); if (bhValEl) bhValEl.textContent = v + "px";
    });
    panel.querySelector('[data-action="bh-inc"]').addEventListener("click", function () {
      var v = Math.min(60, (settings.barHeight || 36) + 2); settings.barHeight = v; saveSettings(); if (bhValEl) bhValEl.textContent = v + "px";
    });
    // ◀▶ は境界に今いるアイテムの実幅ぶんだけ px を増減する。
    // 「1クリック = 1ブックマーク」の操作感。調整時は描画に使われた実効補正値
    // (effectiveOffset) を起点にし、その時点のバー使用幅をキャリブレーション
    // 基準として保存 → 以後の並べ替え・増減には比率スケールで自動追従する
    var boValEl = panel.querySelector("#mrbb-bo-val");
    var updateBoLabel = function () { if (boValEl) boValEl.textContent = (settings.boundaryOffsetPx || 0) + "px"; };
    var applyBoundaryStep = function (step) {
      var info = lastOverflowInfo;
      var current = (info && info.effectiveOffset !== undefined) ? info.effectiveOffset : (settings.boundaryOffsetPx || 0);
      settings.boundaryOffsetPx = Math.max(-600, Math.min(600, current + step));
      settings.boundaryCalibUsed = (info && info.usedNoOffset > 0) ? info.usedNoOffset : 0;
      saveSettings(); updateBoLabel();
    };
    panel.querySelector('[data-action="bo-dec"]').addEventListener("click", function () {
      var info = lastOverflowInfo;
      applyBoundaryStep((info && info.k > 0) ? info.widths[info.k - 1] : 80);
    });
    panel.querySelector('[data-action="bo-inc"]').addEventListener("click", function () {
      var info = lastOverflowInfo;
      applyBoundaryStep((info && info.k < info.n) ? -info.widths[info.k] : -80);
    });
    // ms系ステッパー: 200ms 以下は 50ms 刻み、それ以上は 100ms 刻み。0 まで下げられる
    var bindMsStepper = function (decSel, incSel, valId, key, def, max) {
      var valEl = panel.querySelector(valId);
      var cur = function () { return settings[key] !== undefined ? settings[key] : def; };
      var apply = function (v) { settings[key] = v; saveSettings(); if (valEl) valEl.textContent = v + "ms"; };
      panel.querySelector(decSel).addEventListener("click", function () {
        var v = cur(); apply(v <= 200 ? Math.max(0, v - 50) : v - 100);
      });
      panel.querySelector(incSel).addEventListener("click", function () {
        var v = cur(); apply(v < 200 ? v + 50 : Math.min(max, v + 100));
      });
    };
    bindMsStepper('[data-action="hc-dec"]', '[data-action="hc-inc"]', "#mrbb-hc-val", "hoverCloseMs", 400, 2000);
    var bindStepper = function (decSel, incSel, valId, key, def, min, max, step, unit) {
      var valEl = panel.querySelector(valId);
      panel.querySelector(decSel).addEventListener("click", function () {
        var v = Math.max(min, (settings[key] !== undefined ? settings[key] : def) - step);
        settings[key] = v; saveSettings(); if (valEl) valEl.textContent = v + unit;
      });
      panel.querySelector(incSel).addEventListener("click", function () {
        var v = Math.min(max, (settings[key] !== undefined ? settings[key] : def) + step);
        settings[key] = v; saveSettings(); if (valEl) valEl.textContent = v + unit;
      });
    };
    bindStepper('[data-action="re-dec"]', '[data-action="re-inc"]', "#mrbb-re-val", "revealEdgePx", 2, 1, 50, 2, "px");
    bindStepper('[data-action="rd-dec"]', '[data-action="rd-inc"]', "#mrbb-rd-val", "revealDelayMs", 0, 0, 1000, 50, "ms");
    bindMsStepper('[data-action="ad-dec"]', '[data-action="ad-inc"]', "#mrbb-ad-val", "autohideDelayMs", 400, 5000);
    // 背景色: "change"（ピッカーを閉じた時）のみ保存。"input" はドラッグ中に連続発火し
    // storage.sync の書き込みクォータを食い潰すため使わない
    var bcInput = panel.querySelector("#mrbb-bc-input");
    bcInput.addEventListener("change", function (e) { settings.barColor = e.target.value; saveSettings(); });
    panel.querySelector('[data-action="bc-reset"]').addEventListener("click", function () {
      settings.barColor = ""; saveSettings();
      bcInput.value = window.matchMedia("(prefers-color-scheme: dark)").matches ? "#282828" : "#ffffff";
    });
    panel.querySelector("#mrbb-hoc-chk").addEventListener("change", function (e) { settings.hideOnClick = e.target.checked; saveSettings(); });
    panel.querySelector("#mrbb-hooc-chk").addEventListener("change", function (e) { settings.hideOnOutsideClick = e.target.checked; saveSettings(); });
    panel.querySelector("#mrbb-lang-sel").addEventListener("change", function (e) {
      settings.language = e.target.value;
      saveSettings();
      // 新しい言語でパネルを開き直す
      loadI18n(settings.language).then(function () {
        panel.remove();
        toggleSettingsPanel(gearBtn);
      });
    });
    panel.querySelector("#mrbb-mr-inp").addEventListener("change", function (e) { settings.maxRows = parseInt(e.target.value, 10) || 0; saveSettings(); });
    panel.querySelector("#mrbb-fo-sel").addEventListener("change", function (e) { settings.folderOpenMode = e.target.value; saveSettings(); });
    panel.querySelector("#mrbb-bm-sel").addEventListener("change", function (e) { settings.barMode = e.target.value; saveSettings(); });
    panel.querySelector("#mrbb-db-sel").addEventListener("change", function (e) {
      settings.displayBehavior = e.target.value;
      saveSettings();
      var warn = panel.querySelector("#mrbb-push-warn");
      if (warn) warn.style.display = e.target.value === "push" ? "block" : "none";
    });

    // NOTE: document レベルでは shadow 内のイベントは target がホスト要素に
    // リターゲットされるため、composedPath() で実際のクリック先を判定する
    var dismiss = function (e) {
      var path = e.composedPath ? e.composedPath() : [e.target];
      if (path.indexOf(panel) === -1 && path.indexOf(gearBtn) === -1) {
        panel.remove();
        document.removeEventListener("mousedown", dismiss, true);
      }
    };
    setTimeout(function () { document.addEventListener("mousedown", dismiss, true); }, 0);
    panel.addEventListener("contextmenu", function (e) { e.stopPropagation(); });
  }

  // ===== Search =====
  function createSearchWidget() {
    var container = document.createElement("div");
    container.className = "mrbb-search-container";
    var btn = document.createElement("div");
    btn.className = "mrbb-search-btn";
    btn.title = t("searchTooltip");
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M8.5 3a5.5 5.5 0 0 1 4.38 8.82l4.15 4.15a.75.75 0 0 1-1.06 1.06l-4.15-4.15A5.5 5.5 0 1 1 8.5 3zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg>';
    var input = document.createElement("input");
    input.type = "text"; input.className = "mrbb-search-input"; input.placeholder = t("searchPlaceholder");
    var debounce, resultPanel = null;
    var closeResults = function () { if (resultPanel) { resultPanel.remove(); resultPanel = null; } };
    var closeSearch = function () { input.classList.remove("mrbb-search-open"); input.value = ""; closeResults(); };

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (input.classList.contains("mrbb-search-open")) closeSearch();
      else { input.classList.add("mrbb-search-open"); input.focus(); }
    });
    input.addEventListener("input", function () {
      clearTimeout(debounce);
      var q = input.value.trim();
      if (q.length < 2) { closeResults(); return; }
      debounce = setTimeout(function () {
        chrome.runtime.sendMessage({ type: "MRBB_SEARCH_BOOKMARKS", query: q }, function (resp) {
          if (chrome.runtime.lastError || !resp) return;
          showSearchResults(resp.results || [], input);
        });
      }, 200);
    });
    input.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSearch(); });

    function showSearchResults(results, inputEl) {
      closeResults();
      resultPanel = document.createElement("div");
      resultPanel.className = "mrbb-search-results";
      if (results.length === 0) {
        var emp = document.createElement("div"); emp.className = "mrbb-search-empty"; emp.textContent = t("noResults"); resultPanel.appendChild(emp);
      } else {
        for (var i = 0; i < results.length; i++) {
          var r = results[i];
          var row = document.createElement("a"); row.className = "mrbb-search-result-row"; row.href = r.url;
          var ic = document.createElement("img"); ic.width = 16; ic.height = 16; ic.style.cssText = "flex-shrink:0;border-radius:2px;";
          ic.src = getFaviconUrl(r.url); ic.onerror = function () { this.src = FALLBACK_ICON; }; row.appendChild(ic);
          var info = document.createElement("div"); info.style.cssText = "flex:1;overflow:hidden;";
          var tt = document.createElement("div"); tt.className = "mrbb-search-result-text"; tt.textContent = r.title || r.url; info.appendChild(tt);
          var uu = document.createElement("div"); uu.className = "mrbb-search-result-url"; uu.textContent = r.url; info.appendChild(uu);
          row.appendChild(info);
          resultPanel.appendChild(row);
        }
      }
      var ir = inputEl.getBoundingClientRect();
      resultPanel.style.position = "fixed";
      resultPanel.style.top = fx(ir.bottom + 4);
      resultPanel.style.left = fx(Math.max(4, ir.right - 300));
      resultPanel.style.zIndex = "2147483647";
      if (shadowRoot) shadowRoot.appendChild(resultPanel);
    }

    document.addEventListener("mousedown", function (e) {
      var path = e.composedPath ? e.composedPath() : [e.target];
      if (path.indexOf(container) === -1 && resultPanel && path.indexOf(resultPanel) === -1) closeSearch();
    }, true);

    container.appendChild(input);
    container.appendChild(btn);
    return container;
  }

  // ===== Auto-hide overlay =====
  // ページのレイアウトには一切触れず、バーは普段画面外(上)に隠しておき、
  // カーソルが画面最上部に来たら表示する。どのサイトも壊れない根本対策
  function isAutohide() { return !IS_EXT_NTP && settings.displayBehavior !== "push"; }

  function showBar() {
    if (!hostEl || barShown) return;
    barShown = true;
    hostEl.classList.add("mrbb-shown");
  }
  function hideBar() {
    if (!hostEl || !barShown) return;
    // 操作中は隠さない
    if (isDragging() || activeDropdown || activeContextMenu) return;
    if (shadowRoot && shadowRoot.querySelector(".mrbb-settings-panel")) return;
    barShown = false;
    hostEl.classList.remove("mrbb-shown");
    closeDropdown(true);
    closeContextMenu();
  }
  function scheduleHide() {
    clearTimeout(autohideTimer);
    var delay = settings.autohideDelayMs !== undefined ? settings.autohideDelayMs : 400;
    var attempt = function () {
      autohideTimer = null;
      hideBar();
      // ドロップダウン等の操作中で隠せなかった場合はリトライする。
      // タイマー ID を null に戻さず放置すると mousemove 側の !autohideTimer 判定が
      // 永遠に成立せず、二度と隠れなくなる。またカーソルがウィンドウ外に出ていると
      // mousemove での再スケジュール自体が起きないため、ここで自前で再試行する
      if (barShown) autohideTimer = setTimeout(attempt, Math.max(200, delay));
    };
    autohideTimer = setTimeout(attempt, delay);
  }
  function cancelHide() { clearTimeout(autohideTimer); autohideTimer = null; }
  function cancelReveal() { if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; } }

  // ブックマークを開いた時などの即時格納（ドロップダウン等が開いていても隠す）
  function forceHideBar() {
    cancelHide();
    cancelReveal();
    if (!hostEl || !barShown) return;
    barShown = false;
    hostEl.classList.remove("mrbb-shown");
    closeDropdown(true);
    closeContextMenu();
  }

  function bindAutohide() {
    if (autohideBound) return;
    autohideBound = true;
    document.addEventListener("mousemove", function (e) {
      if (!isAutohide() || !hostEl) return;
      var edge = Math.max(1, settings.revealEdgePx || 2);
      var barBottom = (barHeightPx / (currentZoom || 1)) + 24;
      if (e.clientY <= edge) {
        cancelHide();
        if (!barShown && !revealTimer) {
          var d = settings.revealDelayMs || 0;
          if (d <= 0) showBar();
          else revealTimer = setTimeout(function () { revealTimer = null; showBar(); }, d);
        }
      } else {
        cancelReveal();
        if (barShown && e.clientY > barBottom && !autohideTimer) scheduleHide();
        else if (barShown && e.clientY <= barBottom) cancelHide();
      }
    }, true);
    // カーソルがウィンドウ外（別モニタ・ブラウザUI等）へ出たら隠す判定を開始。
    // 横方向に出ると mousemove が発火しなくなり Y 座標判定だけでは検知できない
    document.addEventListener("mouseout", function (e) {
      if (!isAutohide() || !hostEl || !barShown) return;
      if (e.relatedTarget) return; // relatedTarget があればウィンドウ内の移動
      cancelReveal();
      scheduleHide();
    }, true);
    // ドラッグ中も上端で出す（バー間D&D用）。ページ側へ離れたら隠す
    document.addEventListener("dragover", function (e) {
      if (!isAutohide() || !hostEl) return;
      var barBottom = (barHeightPx / (currentZoom || 1)) + 24;
      if (e.clientY <= Math.max(40, barBottom)) { cancelHide(); showBar(); }
      else if (barShown) scheduleHide();
    }, true);
    // バー外クリックで即隠す
    document.addEventListener("mousedown", function (e) {
      if (!isAutohide() || !barShown || !settings.hideOnOutsideClick) return;
      var path = e.composedPath ? e.composedPath() : [e.target];
      if (hostEl && path.indexOf(hostEl) !== -1) return;
      // 先にドロップダウン/パネル側の外側クリック処理を済ませてから隠す
      setTimeout(hideBar, 0);
    }, true);
    // バー内のブックマーク（リンク）を開いたら即隠す
    document.addEventListener("click", function (e) {
      if (!isAutohide() || !barShown || !settings.hideOnClick) return;
      var path = e.composedPath ? e.composedPath() : [];
      for (var i = 0; i < path.length; i++) {
        var el = path[i];
        if (!el || !el.classList) continue;
        if (el.classList.contains("mrbb-link") ||
            el.classList.contains("mrbb-search-result-row") ||
            (el.classList.contains("mrbb-dropdown-row") && !el.classList.contains("mrbb-dropdown-folder"))) {
          forceHideBar();
          return;
        }
      }
    }, true);
  }

  // ===== Fixed/Sticky element push-down =====
  // バー挿入で position:fixed/sticky なページヘッダーが隠れないよう、動的にオフセットする
  var MAX_SCAN_ELEMENTS = 6000;

  function adjustFixedElements(barPx) {
    if (barPx <= 0 || !document.body) return;
    var els = document.body.getElementsByTagName("*");
    var n = Math.min(els.length, MAX_SCAN_ELEMENTS);
    for (var i = 0; i < n; i++) {
      var el = els[i];
      if (el.hasAttribute(FIXED_MARK)) continue;
      var cs = getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "sticky") continue;
      var top = parseFloat(cs.top);
      if (isNaN(top) || top < 0 || top >= barPx) continue;
      var rect = el.getBoundingClientRect();
      if (rect.height === 0 || rect.top >= barPx) continue; // 非表示 or 既にバーより下
      var rec = { el: el, original: el.style.top, originalMaxHeight: null };
      el.setAttribute(FIXED_MARK, "1");
      el.style.setProperty("top", (top + barPx) + "px", "important");
      // 100vh 等のフルハイト要素は押し下げると下端が画面外にはみ出し、
      // 最下部の UI（例: X の左ナビのアカウントボタン）が見えなくなる。
      // top 適用後に実測し、はみ出す場合だけ max-height で画面内に収める
      // （bottom 固定の要素は top 変更で自動的に縮むので実測ならキャップされない）
      var after = el.getBoundingClientRect();
      if (after.bottom > window.innerHeight + 2 && after.top < window.innerHeight) {
        rec.originalMaxHeight = el.style.maxHeight || "";
        el.style.setProperty("max-height", Math.max(100, window.innerHeight - after.top) + "px", "important");
      }
      fixedAdjusted.push(rec);
    }
  }

  function restoreFixedElements() {
    for (var i = 0; i < fixedAdjusted.length; i++) {
      var rec = fixedAdjusted[i];
      if (!rec.el.isConnected) continue;
      if (rec.original) rec.el.style.top = rec.original;
      else rec.el.style.removeProperty("top");
      if (rec.originalMaxHeight !== null) {
        if (rec.originalMaxHeight) rec.el.style.maxHeight = rec.originalMaxHeight;
        else rec.el.style.removeProperty("max-height");
      }
      rec.el.removeAttribute(FIXED_MARK);
    }
    fixedAdjusted = [];
  }

  function watchFixedElements() {
    if (fixedObserver || !document.body) return;
    fixedObserver = new MutationObserver(function () {
      if (barHeightPx <= 0) return;
      clearTimeout(fixedObserverTimer);
      fixedObserverTimer = setTimeout(function () {
        var zoom = getChromeZoom();
        adjustFixedElements(barHeightPx / zoom);
      }, 300);
    });
    fixedObserver.observe(document.body, { childList: true, subtree: true });
  }

  // ===== Shadow DOM & Rendering =====
  function saveSettings() { chrome.storage.sync.set({ [STORAGE_KEY]: settings }); }

  function fetchBookmarks() {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage({ type: "MRBB_GET_BOOKMARKS" }, function (resp) {
        if (chrome.runtime.lastError || !resp) { resolve([]); return; }
        hasOtherBookmarks = !!resp.hasOtherBookmarks;
        tabGroupTitles = resp.tabGroupTitles || [];
        resolve(resp.bookmarks || []);
      });
    });
  }

  async function loadCSS(shadow) {
    if (cssLoaded) return;
    try {
      var url = chrome.runtime.getURL("content.css");
      var resp = await fetch(url);
      var text = await resp.text();
      var style = document.createElement("style");
      style.textContent = text;
      shadow.insertBefore(style, shadow.firstChild);
      cssLoaded = true;
    } catch (e) { console.warn("[MRBB] CSS load failed:", e); }
  }

  async function ensureRoot() {
    if (rootEl && hostEl && shadowRoot) return rootEl;
    hostEl = document.createElement("div");
    hostEl.id = HOST_ID;
    // Insert on <html> BEFORE <body> — so body's transform won't affect our fixed positioning
    document.documentElement.insertBefore(hostEl, document.body);
    shadowRoot = hostEl.attachShadow({ mode: "open" });
    await loadCSS(shadowRoot);
    rootEl = document.createElement("div");
    rootEl.id = ROOT_ID;
    shadowRoot.appendChild(rootEl);
    setupBarDragDrop(rootEl);
    setupContextMenuOnBar(rootEl);
    return rootEl;
  }

  async function render() {
    if (!settings.enabled) { removeBar(); return; }
    if (settings.showCondition === "new_tab_only") {
      var href = location.href;
      if (!(IS_EXT_NTP || href === "chrome://newtab/" || href.startsWith("chrome-search://") || href === "about:blank" || href === "chrome://new-tab-page/")) { removeBar(); return; }
    }
    // ネイティブバーの状態で動作を切替（Ctrl+Shift+B や F11 に動的追従）
    var barState = nativeBarState();
    if (barState === "fullscreen") { removeBar(); return; }
    var bookmarks = await fetchBookmarks();
    if (bookmarks.length === 0) { removeBar(); return; }
    var fs = settings.fontSize || 12;
    var zoom = getChromeZoom();
    currentZoom = zoom;
    var ww = Math.round(window.innerWidth * zoom);

    // ネイティブバー非表示時は境界推定が不要になり、全描画なら常に完全一致
    var overflow = settings.barMode !== "independent" && barState === "visible";
    var layout = overflow
      ? calcOverflowLayout(bookmarks, ww, settings)
      : calcIndependentLayout(bookmarks, ww, settings);

    // overflow モードでは row 0 はネイティブバーが表示中 → row 1 以降のみ描画
    var firstRenderRow = overflow ? 1 : 0;
    var renderRows = layout.filter(function (l) { return l.row >= firstRenderRow; });
    if (renderRows.length === 0) { removeBar(); return; }
    var lastRow = Math.max.apply(null, layout.map(function (l) { return l.row; }));
    var extRows = lastRow - firstRenderRow + 1;

    rootEl = await ensureRoot();
    rootEl.innerHTML = "";
    closeDropdown(true);
    closeContextMenu();

    var bh = settings.barHeight || 36;
    var itemH = Math.max(bh - 8, 20);
    hostEl.style.zoom = (1 / zoom).toString();
    hostEl.style.setProperty("--mrbb-font-size", fs + "px");
    hostEl.style.setProperty("--mrbb-bar-height", bh + "px");
    hostEl.style.setProperty("--mrbb-item-height", itemH + "px");
    applyBarColor(hostEl);

    // ブックマークバー内での実 index（D&D の移動先計算に使う）
    var bmIndexMap = {};
    for (var bi = 0; bi < bookmarks.length; bi++) bmIndexMap[bookmarks[bi].id] = bi;

    for (var r = firstRenderRow; r <= lastRow; r++) {
      var row = document.createElement("div");
      row.className = "mrbb-row";
      if (r === firstRenderRow) row.appendChild(createGearButton());
      var items = layout.filter(function (l) { return l.row === r; });
      for (var i = 0; i < items.length; i++) {
        var el = createBookmarkElement(items[i].bookmark, settings.displayMode);
        el.dataset.bmIndex = bmIndexMap[items[i].bookmark.id];
        if (items[i].bookmark.isFolder) {
          (function (bm, anchor) {
            if (settings.folderOpenMode === "hover") {
              anchor.addEventListener("mouseenter", function () { if (!isDragging()) openDropdown(bm, anchor, "hover"); });
            } else {
              anchor.addEventListener("click", function (e) { e.preventDefault(); openDropdown(bm, anchor, "click"); });
            }
          })(items[i].bookmark, el);
        }
        row.appendChild(el);
      }
      if (r === firstRenderRow) row.appendChild(createSearchWidget());
      rootEl.appendChild(row);
    }

    var visibleHeight = extRows * bh;
    hostEl.style.height = visibleHeight + "px";
    barHeightPx = visibleHeight;

    if (isAutohide()) {
      // ページ無改変モード: レイアウトに一切触れない。バーは普段画面外に隠す
      hostEl.classList.add("mrbb-autohide");
      if (barShown) hostEl.classList.add("mrbb-shown");
      // push モードから切替えた場合の残骸を掃除
      document.body.style.removeProperty("margin-top");
      originalBodyMarginTop = null;
      restoreFixedElements();
      if (fixedObserver) { fixedObserver.disconnect(); fixedObserver = null; }
      bindAutohide();
    } else {
      // push モード: バーの高さ分だけページ全体を下へ押し下げる
      hostEl.classList.remove("mrbb-autohide");
      hostEl.classList.remove("mrbb-shown");
      barShown = false;
      var marginTop = visibleHeight / zoom;
      if (originalBodyMarginTop === null) {
        originalBodyMarginTop = parseFloat(getComputedStyle(document.body).marginTop) || 0;
      }
      document.body.style.setProperty("margin-top", (originalBodyMarginTop + marginTop) + "px", "important");
      // 固定ヘッダーも押し下げる（バー高さが変わった場合は付け直す）
      restoreFixedElements();
      adjustFixedElements(marginTop);
      watchFixedElements();
    }
  }

  function removeBar() {
    if (hostEl) { hostEl.remove(); hostEl = null; shadowRoot = null; rootEl = null; cssLoaded = false; }
    barHeightPx = 0;
    barShown = false;
    cancelHide();
    if (document.body) document.body.style.removeProperty("margin-top");
    originalBodyMarginTop = null;
    restoreFixedElements();
    if (fixedObserver) { fixedObserver.disconnect(); fixedObserver = null; }
  }

  function applySettings(newSettings) {
    settings = Object.assign({}, newSettings);
    loadI18n(settings.language).then(render);
  }

  async function loadSettings() {
    try {
      var data = await chrome.storage.sync.get(STORAGE_KEY);
      var raw = data[STORAGE_KEY] || {};
      var s = Object.assign({}, DEFAULT_SETTINGS, raw);
      // 旧アイテム数補正 → px 補正へ移行（平均アイテム幅 80px で換算）
      if (raw.boundaryOffset && raw.boundaryOffsetPx === undefined) {
        s.boundaryOffsetPx = -raw.boundaryOffset * 80;
        s.boundaryOffset = 0;
        chrome.storage.sync.set({ [STORAGE_KEY]: s });
      }
      // 境界計算を Chromium 実装準拠に刷新（layoutModelV2）。
      // 旧モデルの誤差を打ち消すための補正値は不要になるためリセット
      if (!raw.layoutModelV2) {
        s.boundaryOffsetPx = 0;
        s.boundaryCalibUsed = 0;
        s.layoutModelV2 = true;
        chrome.storage.sync.set({ [STORAGE_KEY]: s });
      }
      return s;
    } catch (e) { return Object.assign({}, DEFAULT_SETTINGS); }
  }

  // ===== Init =====
  async function init() {
    var sett = await loadSettings();
    applySettings(sett);

    var resizeTimer;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { render(); }, 150);
    });

    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg.type === "MRBB_REFRESH") render();
    });

    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === "sync" && changes[STORAGE_KEY]) {
        var newSett = Object.assign({}, DEFAULT_SETTINGS, changes[STORAGE_KEY].newValue || {});
        applySettings(newSett);
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
