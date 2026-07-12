// =========================================================
// 自動キャリブレーション
// getDisplayMedia でこの Chrome ウィンドウをキャプチャし、
// ネイティブブックマークバーの「最後に表示されているアイテムの右端」を
// 画像解析で実測 → 表示個数 k を逆算 → boundaryOffsetPx を自動設定する。
// このページは拡張ページなので chrome.bookmarks / tabGroups を直接呼べる。
// =========================================================
(function () {
  "use strict";

  const STORAGE_KEY = "mrbb-settings";
  // content.js の寸法モデルと同一の定数（変更時は両方更新すること）
  const NATIVE = {
    fontSize: 12, itemPad: 8, iconTextGap: 6, iconSize: 16,
    itemSpacing: 2, textMaxWidth: 150,
    leftMargin: 22, rightMargin: 8, chevron: 33,
  };
  const FONT_STACK = '"Segoe UI", "Yu Gothic UI", Meiryo, system-ui, -apple-system, sans-serif';

  const t = (key) => {
    try { const m = chrome.i18n.getMessage(key); if (m) return m; } catch (e) { /* ignore */ }
    return key;
  };
  const $ = (id) => document.getElementById(id);

  // ---- i18n ----
  document.addEventListener("DOMContentLoaded", () => {
    $("c-title").textContent = t("calibTitle");
    $("c-intro").textContent = t("calibIntro");
    $("c-step1").textContent = t("calibStep1");
    $("c-step3").textContent = t("calibStep3");
    $("c-step2").innerHTML = "";
    $("c-step2").textContent = t("calibStep2");
    $("start").textContent = t("calibStart");
    document.title = t("calibTitle");
  });

  function status(msg, cls) {
    const el = $("status");
    el.style.display = "block";
    el.className = cls || "";
    el.textContent = msg;
  }

  // ---- 寸法モデル（content.js と同じ計算） ----
  let canvasCtx = null;
  function textWidth(text) {
    if (!canvasCtx) canvasCtx = document.createElement("canvas").getContext("2d");
    canvasCtx.font = NATIVE.fontSize + "px " + FONT_STACK;
    return Math.min(canvasCtx.measureText(text).width, NATIVE.textMaxWidth);
  }
  function nativeItemWidth(node) {
    let w = NATIVE.itemPad * 2 + NATIVE.iconSize + NATIVE.itemSpacing;
    if (node.title) w += NATIVE.iconTextGap + textWidth(node.title);
    return Math.ceil(w);
  }
  function otherBookmarksWidth() {
    const lang = chrome.i18n.getUILanguage();
    const label = lang.indexOf("ja") === 0 ? "その他のブックマーク" : "All Bookmarks";
    return NATIVE.itemPad * 2 + NATIVE.iconSize + NATIVE.iconTextGap + NATIVE.itemSpacing + textWidth(label) + 8;
  }
  function chipsWidth(groups) {
    if (!groups.length) return 0;
    let w = 0;
    for (const g of groups) w += (g.title ? textWidth(g.title) : 12) + 32;
    return w + 8;
  }

  async function buildModel() {
    const win = await chrome.windows.getCurrent();
    const kids = await chrome.bookmarks.getChildren("1");
    const others = await chrome.bookmarks.getChildren("2").catch(() => []);
    const groups = chrome.tabGroups ? await chrome.tabGroups.query({ windowId: win.id }).catch(() => []) : [];
    const widths = kids.map(nativeItemWidth);
    const chips = chipsWidth(groups);
    const reserved0 = NATIVE.leftMargin + NATIVE.rightMargin + chips +
      (others.length > 0 ? otherBookmarksWidth() : 0);
    // cum[i] = 先頭から i 個ぶんの合計幅 / S[i] = i 番目(0-based)のアイテム右端の絶対位置
    const cum = [0];
    for (const w of widths) cum.push(cum[cum.length - 1] + w);
    const S = widths.map((_, i) => NATIVE.leftMargin + chips + cum[i + 1]);
    const ww = window.innerWidth; // 拡張ページはズーム 1
    const availZero = ww - reserved0 + NATIVE.rightMargin - NATIVE.chevron; // offset=0 での使用可能幅
    return { win, kids, widths, cum, S, ww, availZero };
  }

  // ---- 画像解析（純関数: テストから直接呼べるよう window に公開） ----
  // strip: {data: Uint8ClampedArray(RGBA), width, height} — バー中心付近の横1列ぶんの帯
  // 戻り値: {clusters: [{left,right}], lastItemRight, chevronLeft} すべて px（キャプチャ座標）
  function findLastItemRight(strip) {
    const { data, width, height } = strip;
    // 背景色 = 帯の最頻輝度（バーの地の色）
    const colGray = new Float32Array(width);
    const hist = new Map();
    for (let x = 0; x < width; x++) {
      let minDev = 255, grayAt = 255;
      for (let y = 0; y < height; y++) {
        const i = (y * width + x) * 4;
        const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (y === Math.floor(height / 2)) grayAt = g;
        colGray[x] = Math.min(colGray[x] || 255, g);
      }
      const bucket = Math.round(grayAt / 8) * 8;
      hist.set(bucket, (hist.get(bucket) || 0) + 1);
      void minDev;
    }
    let bg = 255, bgCount = -1;
    for (const [v, c] of hist) if (c > bgCount) { bgCount = c; bg = v; }
    // 列ごとの「インク」判定: 帯内のどこかに背景から大きく外れる画素がある
    const ink = new Array(width).fill(false);
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const i = (y * width + x) * 4;
        const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (Math.abs(g - bg) > 40) { ink[x] = true; break; }
      }
    }
    // クラスタ化（gap 6px まで同一クラスタ）
    const GAP = 6;
    const clusters = [];
    let start = -1, lastInk = -10;
    for (let x = 0; x < width; x++) {
      if (ink[x]) {
        if (start < 0) start = x;
        else if (x - lastInk > GAP) { clusters.push({ left: start, right: lastInk }); start = x; }
        lastInk = x;
      }
    }
    if (start >= 0) clusters.push({ left: start, right: lastInk });
    if (clusters.length < 2) return { clusters, lastItemRight: null, chevronLeft: null };
    const chevron = clusters[clusters.length - 1];
    const lastItem = clusters[clusters.length - 2];
    return { clusters, lastItemRight: lastItem.right, chevronLeft: chevron.left };
  }
  window.__mrbbFindLastItemRight = findLastItemRight; // E2E テスト用

  // ---- キャプチャ ----
  async function grabFrame() {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    try {
      const video = document.createElement("video");
      video.srcObject = stream;
      await video.play();
      await new Promise((r) => setTimeout(r, 350)); // 描画安定待ち
      const c = document.createElement("canvas");
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext("2d").drawImage(video, 0, 0);
      return c;
    } finally {
      stream.getTracks().forEach((tr) => tr.stop());
    }
  }

  async function calibrate() {
    status(t("calibAnalyzing"));
    const model = await buildModel();
    if (model.kids.length === 0) { status(t("calibNoOverflow"), "err"); return; }

    let frame;
    try {
      frame = await grabFrame();
    } catch (e) {
      status(t("calibFailCapture") + "\n" + e.message, "err");
      return;
    }

    // キャプチャ座標系の特定: フレーム寸法がスクリーン実寸(×dpr)と一致すれば
    // 画面全体キャプチャ、そうでなければウィンドウキャプチャとみなす
    // （縦横比での判定は 16:9 ウィンドウ×16:9 画面で誤判定するため使わない）
    const win = model.win;
    const dpr = window.devicePixelRatio;
    let scale, x0 = 0, y0 = 0;
    const isScreen =
      Math.abs(frame.width - screen.width * dpr) <= 2 &&
      Math.abs(frame.height - screen.height * dpr) <= 2;
    if (isScreen) {
      scale = frame.width / screen.width; // 画面全体 → ウィンドウ位置でオフセット
      x0 = win.left * scale;
      y0 = win.top * scale;
    } else {
      scale = frame.width / win.width; // ウィンドウ選択
    }

    // ブックマークバー帯の y 位置: このページ自身の chrome 高さから逆算
    const chromeTop = window.outerHeight - window.innerHeight; // タブ+ツールバー+バー
    const ctx = frame.getContext("2d");
    let best = null;
    const debugStrips = [];
    for (const dy of [14, 19, 24]) { // バー内の3ラインを試して最も右まで届いた結果を採用
      const y = Math.round(y0 + (chromeTop - dy) * scale);
      if (y < 3 || y >= frame.height - 3) continue;
      const stripH = Math.max(3, Math.round(4 * scale));
      const img = ctx.getImageData(Math.round(x0), y - Math.floor(stripH / 2), Math.round(win.width * scale), stripH);
      const r = findLastItemRight(img);
      debugStrips.push({ dy, y, clusters: r.clusters, lastItemRight: r.lastItemRight });
      if (r.lastItemRight !== null && (!best || r.lastItemRight > best.lastItemRight)) best = r;
    }
    // トラブルシュート用（E2E とサポートで参照）
    window.__mrbbCalibDebug = { chromeTop, scale, x0, y0, frameW: frame.width, frameH: frame.height, strips: debugStrips };
    window.__mrbbLastFrame = frame;
    if (!best || best.lastItemRight === null) { status(t("calibFailNoChevron"), "err"); return; }

    // 実測右端(DIP) → 表示個数 k: モデル上の各アイテム右端 S[i] と照合
    // 実測はテキスト/アイコンの右端なのでボタン右端との差 ~(pad+spacing) を加える
    const measuredRight = best.lastItemRight / scale + NATIVE.itemPad + 1;
    let k = 1, bestD = Infinity;
    model.S.forEach((s, i) => {
      const d = Math.abs(s - measuredRight);
      if (d < bestD) { bestD = d; k = i + 1; }
    });
    if (k >= model.kids.length) { status(t("calibNoOverflow"), "err"); return; }

    // k 個ちょうど収まる使用可能幅の中点を狙って offset を決める（最も余裕のある値）
    const target = (model.cum[k] + model.cum[k + 1]) / 2;
    const offsetPx = Math.max(-600, Math.min(600, Math.round(model.availZero - target)));

    const data = await chrome.storage.sync.get(STORAGE_KEY);
    const s = data[STORAGE_KEY] || {};
    s.boundaryOffsetPx = offsetPx;
    s.boundaryOffset = 0;
    await chrome.storage.sync.set({ [STORAGE_KEY]: s });

    const lastTitle = model.kids[k - 1].title || "(icon)";
    status(
      t("calibDone") + "\n" +
      `k = ${k} (${lastTitle})\n` +
      `boundaryOffsetPx = ${offsetPx}px` +
      (bestD > 45 ? "\n" + t("calibLowConfidence") : ""),
      "ok"
    );
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("start").addEventListener("click", () => {
      calibrate().catch((e) => status("Error: " + e.message, "err"));
    });
  });
})();
