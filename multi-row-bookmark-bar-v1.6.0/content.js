(function () {
  "use strict";

  // ===== Constants =====
  var ROOT_ID = "mrbb-root";
  var HOST_ID = "mrbb-host";
  var STORAGE_KEY = "mrbb-settings";
  var FIXED_MARK = "data-mrbb-fixed-adjusted";
  var DEFAULT_SETTINGS = {
    enabled: true, maxRows: 0, displayMode: "both",
    folderOpenMode: "hover", showCondition: "always",
    fontSize: 12, barHeight: 36,
    barMode: "overflow", // "overflow": ネイティブバーの続きから / "independent": 全ブックマークを描画
    boundaryOffset: 0   // ネイティブバー収容数の手動補正（-5〜+5 アイテム）
  };

  // Chrome ネイティブバーの寸法モデル
  // (Chrome 150 実測: 幅900/1100/1280px での表示個数と canvas 計測テキスト幅から逆算。
  //  アイテム幅 = テキスト幅 + itemPad*2 + iconSize + iconTextGap + itemSpacing = テキスト + 40)
  var NATIVE = {
    fontSize: 12,     // Chrome UI フォントサイズ（設定に依存しない固定値）
    itemPad: 8,       // アイテム左右パディング
    iconTextGap: 6,   // ファビコンとラベルの間隔
    iconSize: 16,
    itemSpacing: 2,   // アイテム間の間隔
    textMaxWidth: 150,
    leftMargin: 22,   // バー左端の余白
    rightMargin: 8,   // バー右端の余白（シェブロン非表示時）
    chevron: 33       // >> オーバーフローシェブロン + 右余白
  };

  var getFaviconUrl = function (url) {
    try { var u = new URL(url); return "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(u.hostname) + "&sz=32"; }
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

  // ===== Helpers =====
  function getTextWidth(text, fontSize, maxWidth) {
    if (!canvasEl) canvasEl = document.createElement("canvas");
    var ctx = canvasEl.getContext("2d");
    ctx.font = fontSize + 'px "Segoe UI", system-ui, -apple-system, sans-serif';
    return Math.min(ctx.measureText(text).width, maxWidth || NATIVE.textMaxWidth);
  }

  function otherBookmarksLabelWidth() {
    var lang = (chrome.i18n && chrome.i18n.getUILanguage) ? chrome.i18n.getUILanguage() : "en";
    var label = lang.indexOf("ja") === 0 ? "その他のブックマーク" : "All Bookmarks";
    return NATIVE.itemPad * 2 + NATIVE.iconSize + NATIVE.iconTextGap + NATIVE.itemSpacing +
      getTextWidth(label, NATIVE.fontSize) + 8; // +8: ボタン手前のセパレータ余白
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

  // i18n: _locales/{en,ja}/messages.json から Chrome の UI 言語で取得
  function t(key) {
    try { var m = chrome.i18n.getMessage(key); if (m) return m; } catch (e) { /* ignore */ }
    return key;
  }

  // ===== Layout Calculation =====
  // ネイティブバー上のアイテム幅（Chrome の実描画を模倣）
  function calcNativeItemWidth(item) {
    var w = NATIVE.itemPad * 2 + NATIVE.iconSize + NATIVE.itemSpacing;
    if (item.title) w += NATIVE.iconTextGap + getTextWidth(item.title, NATIVE.fontSize);
    return Math.ceil(w);
  }

  // 拡張バー上のアイテム幅（CSS と同じ寸法モデル: pad/gap/spacing はネイティブと同一）
  function calcItemWidth(item, displayMode, fontSize) {
    var w = NATIVE.itemPad * 2 + NATIVE.itemSpacing;
    if (displayMode !== "text_only") w += NATIVE.iconSize;
    if (displayMode !== "icon_only" && item.title) {
      if (displayMode !== "text_only") w += NATIVE.iconTextGap;
      w += getTextWidth(item.title, fontSize);
    }
    return Math.ceil(w);
  }

  // overflow モード: row 0 = Chrome ネイティブバー（描画しない）、row 1+ = 拡張バー
  // 2パス: まずシェブロン無しで全アイテムが収まるか確認 → 収まればバー不要
  function calcOverflowLayout(bookmarks, windowWidth, sett) {
    var fs = sett.fontSize || 12;
    var gearW = 24, searchW = 24;
    var extAvail = windowWidth - 16; // BAR_MARGIN_X * 2

    // ネイティブバーの幅を消費する要素をすべて差し引く
    var reserved = NATIVE.leftMargin + NATIVE.rightMargin +
      tabGroupChipsWidth() +
      (hasOtherBookmarks ? otherBookmarksLabelWidth() : 0);
    var nativeFull = windowWidth - reserved;
    var nativeWidths = bookmarks.map(calcNativeItemWidth);
    var total = nativeWidths.reduce(function (a, b) { return a + b; }, 0);

    // row 0（ネイティブバー）の収容数 k を決める
    var k;
    if (total <= nativeFull) {
      k = bookmarks.length; // 全部収まる（シェブロン非表示）
    } else {
      var nativeAvail = nativeFull + NATIVE.rightMargin - NATIVE.chevron;
      k = 0;
      var used = 0;
      while (k < bookmarks.length && (used === 0 || used + nativeWidths[k] <= nativeAvail)) {
        used += nativeWidths[k];
        k++;
      }
    }
    // 手動補正（環境差: Chrome UIフォント設定・アプリショートカット・未検出のチップ等）
    k = Math.max(0, Math.min(bookmarks.length, k + (sett.boundaryOffset || 0)));
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

  // ネイティブバーやページからのドラッグ（URL 付き）を受け入れるか
  function hasUriData(dt) {
    try {
      for (var i = 0; i < dt.types.length; i++) {
        if (dt.types[i] === "text/uri-list" || dt.types[i] === "text/plain") return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  // ドラッグ開始をバックグラウンドに通知（ネイティブバーへのドロップで
  // Chrome が複製を作った時に、元を消して「移動」にするため）
  function notifyDragStart(id, url) {
    try { chrome.runtime.sendMessage({ type: "MRBB_DRAG_START", id: id, url: url || null }); } catch (e) { /* ignore */ }
  }
  function notifyDragEnd() {
    try { chrome.runtime.sendMessage({ type: "MRBB_DRAG_END" }); } catch (e) { /* ignore */ }
  }

  // 外部ドラッグ（ネイティブバー / ページ上のリンク）のドロップ処理
  function executeExternalDrop(dt) {
    if (!dropTarget) { cleanupDrag(); return; }
    var uri = "";
    try { uri = dt.getData("text/uri-list") || dt.getData("text/plain") || ""; } catch (e) { /* ignore */ }
    var url = uri.split("\n")[0].trim();
    if (!url || !/^https?:|^ftp:|^file:|^chrome:|^edge:|^about:/i.test(url)) { cleanupDrag(); return; }
    var title = "";
    try {
      var html = dt.getData("text/html");
      if (html) title = new DOMParser().parseFromString(html, "text/html").body.textContent.trim();
    } catch (e) { /* ignore */ }
    var dest = { parentId: dropTarget.parentId };
    if (dropTarget.index !== undefined) dest.index = dropTarget.index;
    chrome.runtime.sendMessage({ type: "MRBB_EXTERNAL_DROP", url: url, title: title, destination: dest });
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
      } else {
        e.dataTransfer.setData("text/plain", dragId);
      }
      notifyDragStart(dragId, href && href !== "#" ? href : null);
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
      if (!dragId && !hasUriData(e.dataTransfer)) return;
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
        if (items[i].classList.contains("mrbb-folder") && e.clientX >= ir.left + ir.width * 0.25 && e.clientX <= ir.left + ir.width * 0.75) {
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
  }

  function setupDropdownDragDrop(dropdown, parentId) {
    dropdown.addEventListener("dragover", function (e) {
      e.preventDefault(); e.stopPropagation();
      if (!dragId && !hasUriData(e.dataTransfer)) return;
      e.dataTransfer.dropEffect = "move";
      var rows = Array.from(dropdown.querySelectorAll(".mrbb-dropdown-row"));
      var ind = getDropIndicator();
      var before = null, insertY = 0;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i].getBoundingClientRect();
        var midY = r.top + r.height / 2;
        if (rows[i].classList.contains("mrbb-dropdown-folder") && e.clientY >= r.top + r.height * 0.25 && e.clientY <= r.top + r.height * 0.75) {
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

  function addItemActions(menu, id, isFolder, title, url, parentId) {
    if (!isFolder && url && url !== "#") {
      menu.appendChild(createMenuItem(t("openInNewTab"), function () { chrome.runtime.sendMessage({ type: "MRBB_OPEN_TAB", url: url }); }));
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
      else if (!timer) { timer = setTimeout(function () { closeDropdown(true); }, timeout); }
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
      dropdownCleanup = setupHoverTracking(anchor, dd, 400);
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
      e.dataTransfer.effectAllowed = "all";
      if (item.url) {
        e.dataTransfer.setData("text/uri-list", item.url);
        e.dataTransfer.setData("text/plain", item.url);
      } else {
        e.dataTransfer.setData("text/plain", item.id);
      }
      notifyDragStart(item.id, item.url || null);
    });
    el.addEventListener("dragend", function () { notifyDragEnd(); });

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
          else if (!subTimer) { subTimer = setTimeout(function () { sub.remove(); document.removeEventListener("mousemove", onSubMove, true); }, 300); }
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
      '<div class="mrbb-settings-row"><span>' + t("fontSize") + '</span><div class="mrbb-settings-fontsize"><button data-action="fs-dec">-</button><span id="mrbb-fs-val">' + fs + 'px</span><button data-action="fs-inc">+</button></div></div>' +
      '<div class="mrbb-settings-row"><span>' + t("rowHeight") + '</span><div class="mrbb-settings-fontsize"><button data-action="bh-dec">-</button><span id="mrbb-bh-val">' + bh + 'px</span><button data-action="bh-inc">+</button></div></div>' +
      '<div class="mrbb-settings-row"><span>' + t("maxRows") + '</span><input type="number" id="mrbb-mr-inp" value="' + settings.maxRows + '" min="0" max="20" style="width:48px;text-align:center;border:1px solid #dadce0;border-radius:3px;padding:2px 4px;font-size:12px;"></div>' +
      '<div class="mrbb-settings-row"><span>' + t("folderOpen") + '</span><select id="mrbb-fo-sel" style="border:1px solid #dadce0;border-radius:3px;padding:2px 4px;font-size:12px;"><option value="hover"' + (settings.folderOpenMode === "hover" ? " selected" : "") + '>' + t("hover") + '</option><option value="click"' + (settings.folderOpenMode === "click" ? " selected" : "") + '>' + t("click") + '</option></select></div>' +
      '<div class="mrbb-settings-row"><span>' + t("barMode") + '</span><select id="mrbb-bm-sel" style="border:1px solid #dadce0;border-radius:3px;padding:2px 4px;font-size:12px;"><option value="overflow"' + (settings.barMode === "overflow" ? " selected" : "") + '>' + t("overflowOnly") + '</option><option value="independent"' + (settings.barMode === "independent" ? " selected" : "") + '>' + t("allBookmarks") + '</option></select></div>' +
      '<div class="mrbb-settings-row"><span>' + t("boundaryAdjust") + '</span><div class="mrbb-settings-fontsize"><button data-action="bo-dec" title="' + t("boundaryEarlier") + '">◀</button><span id="mrbb-bo-val">' + (settings.boundaryOffset || 0) + '</span><button data-action="bo-inc" title="' + t("boundaryLater") + '">▶</button></div></div>';

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
    var boValEl = panel.querySelector("#mrbb-bo-val");
    panel.querySelector('[data-action="bo-dec"]').addEventListener("click", function () {
      var v = Math.max(-5, (settings.boundaryOffset || 0) - 1); settings.boundaryOffset = v; saveSettings(); if (boValEl) boValEl.textContent = v;
    });
    panel.querySelector('[data-action="bo-inc"]').addEventListener("click", function () {
      var v = Math.min(5, (settings.boundaryOffset || 0) + 1); settings.boundaryOffset = v; saveSettings(); if (boValEl) boValEl.textContent = v;
    });
    panel.querySelector("#mrbb-mr-inp").addEventListener("change", function (e) { settings.maxRows = parseInt(e.target.value, 10) || 0; saveSettings(); });
    panel.querySelector("#mrbb-fo-sel").addEventListener("change", function (e) { settings.folderOpenMode = e.target.value; saveSettings(); });
    panel.querySelector("#mrbb-bm-sel").addEventListener("change", function (e) { settings.barMode = e.target.value; saveSettings(); });

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
      fixedAdjusted.push({ el: el, original: el.style.top });
      el.setAttribute(FIXED_MARK, "1");
      el.style.setProperty("top", (top + barPx) + "px", "important");
    }
  }

  function restoreFixedElements() {
    for (var i = 0; i < fixedAdjusted.length; i++) {
      var rec = fixedAdjusted[i];
      if (!rec.el.isConnected) continue;
      if (rec.original) rec.el.style.top = rec.original;
      else rec.el.style.removeProperty("top");
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
      if (!(href === "chrome://newtab/" || href.startsWith("chrome-search://") || href === "about:blank" || href === "chrome://new-tab-page/")) { removeBar(); return; }
    }
    var bookmarks = await fetchBookmarks();
    if (bookmarks.length === 0) { removeBar(); return; }
    var fs = settings.fontSize || 12;
    var zoom = getChromeZoom();
    currentZoom = zoom;
    var ww = Math.round(window.innerWidth * zoom);

    var overflow = settings.barMode !== "independent";
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
              anchor.addEventListener("mouseenter", function () { openDropdown(bm, anchor, "hover"); });
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

    // バーの高さ分だけページ全体を下へ押し下げる（コンテンツが隠れないように）
    var visibleHeight = extRows * bh;
    hostEl.style.height = visibleHeight + "px";
    barHeightPx = visibleHeight;
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

  function removeBar() {
    if (hostEl) { hostEl.remove(); hostEl = null; shadowRoot = null; rootEl = null; cssLoaded = false; }
    barHeightPx = 0;
    if (document.body) document.body.style.removeProperty("margin-top");
    originalBodyMarginTop = null;
    restoreFixedElements();
    if (fixedObserver) { fixedObserver.disconnect(); fixedObserver = null; }
  }

  function applySettings(newSettings) {
    settings = Object.assign({}, newSettings);
    render();
  }

  async function loadSettings() {
    try {
      var data = await chrome.storage.sync.get(STORAGE_KEY);
      return Object.assign({}, DEFAULT_SETTINGS, data[STORAGE_KEY] || {});
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
