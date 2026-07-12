import puppeteer from "puppeteer";
import { fileURLToPath } from "url";
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";

const EXT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "multi-row-bookmark-bar-v1.6.0");

// --- test page with a fixed header (push-down verification) ---
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><head><title>MRBB Test</title><style>
    body { margin: 0; }
    #fixed-header { position: fixed; top: 0; left: 0; right: 0; height: 50px;
      background: steelblue; color: #fff; z-index: 100; }
    #sticky-nav { position: sticky; top: 0; background: seagreen; color: #fff; height: 30px; }
    /* X の左ナビと同型: フルハイト固定カラム + 最下部に UI */
    #fixed-sidebar { position: fixed; top: 0; left: 0; width: 60px; height: 100vh;
      background: #333; z-index: 90; }
    #sidebar-account { position: absolute; bottom: 0; left: 0; width: 60px; height: 40px;
      background: gold; }
    main { padding: 50px 0 0 70px; }
  </style></head>
  <body><div id="fixed-header">Fixed header</div>
  <div id="fixed-sidebar"><div id="sidebar-account">acct</div></div>
  <main><h1 id="top">Page top content</h1><div id="sticky-nav">Sticky nav</div>
  <p>${"lorem ".repeat(800)}</p></main></body></html>`);
});
await new Promise(r => server.listen(18923, r));

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mrbb-profile-"));

const browser = await puppeteer.launch({
  headless: "new",
  userDataDir,
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    "--no-first-run",
    "--window-size=1280,900",
  ],
});

const results = [];
const check = (name, cond, extra = "") =>
  results.push({ name, pass: !!cond, extra });

const TOTAL = 26; // 25 links + 1 folder
const sleep = ms => new Promise(r => setTimeout(r, ms));

try {
  const swTarget = await browser.waitForTarget(
    t => t.type() === "service_worker" && t.url().includes("background.js"),
    { timeout: 15000 }
  );
  const sw = await swTarget.worker();
  check("service worker started", !!sw);

  await sw.evaluate(async () => {
    for (let i = 1; i <= 25; i++) {
      await chrome.bookmarks.create({
        parentId: "1",
        title: "Bookmark-" + String(i).padStart(2, "0") + " (some longer title)",
        url: "https://example.com/page" + i,
      });
    }
    const folder = await chrome.bookmarks.create({ parentId: "1", title: "MyFolder" });
    for (let i = 1; i <= 3; i++) {
      await chrome.bookmarks.create({
        parentId: folder.id,
        title: "Child-" + i,
        url: "https://example.org/child" + i,
      });
    }
  });
  check("bookmarks seeded", true);

  // 既存の押し下げ系テストは push モードで検証（デフォルトは autohide）
  await sw.evaluate(async () => {
    const data = await chrome.storage.sync.get("mrbb-settings");
    const s = data["mrbb-settings"] || {};
    s.displayBehavior = "push";
    await chrome.storage.sync.set({ "mrbb-settings": s });
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto("http://localhost:18923/", { waitUntil: "load" });

  await page.waitForFunction(
    () => document.getElementById("mrbb-host")?.shadowRoot?.querySelectorAll(".mrbb-row").length > 0,
    { timeout: 10000 }
  );

  const info = await page.evaluate(() => {
    const host = document.getElementById("mrbb-host");
    const sh = host.shadowRoot;
    const items = [...sh.querySelectorAll(".mrbb-item")];
    return {
      rowCount: sh.querySelectorAll(".mrbb-row").length,
      itemCount: items.length,
      firstItemTitle: items[0]?.querySelector(".mrbb-title")?.textContent ?? "",
      firstItemIndex: items[0]?.dataset.bmIndex ?? "",
      indexes: items.map(i => parseInt(i.dataset.bmIndex, 10)),
      folderIconCount: sh.querySelectorAll(".mrbb-folder-icon").length,
      bodyMarginTop: parseFloat(getComputedStyle(document.body).marginTop),
      hostHeight: host.getBoundingClientRect().height,
      fixedHeaderTop: document.getElementById("fixed-header").getBoundingClientRect().top,
      fixedHeaderInlineTop: document.getElementById("fixed-header").style.top,
      pageTopVisible: document.getElementById("top").getBoundingClientRect().top,
      itemFont: getComputedStyle(items[0]).fontFamily,
      itemPad: getComputedStyle(items[0]).paddingLeft,
      itemRadius: getComputedStyle(items[0]).borderRadius,
      hostBg: getComputedStyle(host).backgroundColor,
    };
  });

  // --- overflow-continuation checks ---
  check("bar rendered (overflow exists)", info.rowCount >= 1, `rows=${info.rowCount}`);
  check("renders only hidden bookmarks (subset)", info.itemCount > 0 && info.itemCount < TOTAL,
    `rendered=${info.itemCount}/${TOTAL}`);
  check("starts mid-list, not from Bookmark-01", info.firstItemTitle !== "" && !info.firstItemTitle.includes("Bookmark-01"),
    `first="${info.firstItemTitle}" (index ${info.firstItemIndex})`);
  const expectFirst = TOTAL - info.itemCount;
  check("contiguous tail: first index == total - rendered", parseInt(info.firstItemIndex, 10) === expectFirst,
    `firstIndex=${info.firstItemIndex} expected=${expectFirst}`);
  const contiguous = info.indexes.every((v, i, a) => i === 0 || v === a[i - 1] + 1);
  check("indexes contiguous to the end", contiguous && info.indexes[info.indexes.length - 1] === TOTAL - 1,
    JSON.stringify(info.indexes));

  // --- native-look checks ---
  check("Segoe UI font", /Segoe UI/.test(info.itemFont), info.itemFont);
  check("native item padding 8px", info.itemPad === "8px", info.itemPad);
  check("GM3 hover radius 8px", info.itemRadius === "8px", info.itemRadius);
  check("monochrome folder icon (mask)", info.folderIconCount >= 1, `count=${info.folderIconCount}`);
  check("native bg white (measured)", info.hostBg === "rgb(255, 255, 255)", info.hostBg);

  // --- push-down checks ---
  check("body pushed down by bar height", Math.abs(info.bodyMarginTop - info.hostHeight) < 1,
    `margin=${info.bodyMarginTop} bar=${info.hostHeight}`);
  check("fixed header pushed below bar", Math.abs(info.fixedHeaderTop - info.hostHeight) < 1,
    `headerTop=${info.fixedHeaderTop} bar=${info.hostHeight}`);
  check("page content not hidden", info.pageTopVisible >= info.hostHeight,
    `contentTop=${info.pageTopVisible}`);

  // --- full-height fixed sidebar: bottom UI stays inside the viewport ---
  const sidebar = await page.evaluate(() => {
    const sb = document.getElementById("fixed-sidebar").getBoundingClientRect();
    const acct = document.getElementById("sidebar-account").getBoundingClientRect();
    return { sbTop: sb.top, sbBottom: sb.bottom, acctBottom: acct.bottom, vh: window.innerHeight };
  });
  check("full-height sidebar pushed below bar", Math.abs(sidebar.sbTop - info.hostHeight) < 1,
    `top=${sidebar.sbTop} bar=${info.hostHeight}`);
  check("sidebar bottom UI visible (max-height capped)",
    sidebar.acctBottom <= sidebar.vh + 1 && sidebar.sbBottom <= sidebar.vh + 1,
    JSON.stringify(sidebar));

  // --- folder dropdown ---
  const folderBox = await page.evaluate(() => {
    const f = document.getElementById("mrbb-host").shadowRoot.querySelector(".mrbb-folder");
    if (!f) return null;
    const r = f.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (folderBox) {
    await page.mouse.move(folderBox.x, folderBox.y);
    await sleep(300);
    const dd = await page.evaluate(() => {
      const sh = document.getElementById("mrbb-host").shadowRoot;
      const d = sh.querySelector(".mrbb-dropdown");
      return d ? d.querySelectorAll(".mrbb-dropdown-row").length : 0;
    });
    check("folder dropdown opens with 3 children", dd === 3, `rows=${dd}`);
  } else {
    check("folder visible in extension bar", false, "folder landed in native row");
  }

  // --- realtime sync ---
  const before = info.itemCount;
  await sw.evaluate(() => chrome.bookmarks.create({ parentId: "1", title: "LiveAdded", url: "https://live.example/" }));
  await sleep(800);
  const after = await page.evaluate(() =>
    document.getElementById("mrbb-host").shadowRoot.querySelectorAll(".mrbb-item").length
  );
  check("realtime sync on bookmark add", after === before + 1, `before=${before} after=${after}`);

  // --- narrow window -> more overflow rows; fixed header follows ---
  await page.setViewport({ width: 700, height: 900 });
  await sleep(600);
  const narrow = await page.evaluate(() => {
    const host = document.getElementById("mrbb-host");
    return {
      rows: host.shadowRoot.querySelectorAll(".mrbb-row").length,
      items: host.shadowRoot.querySelectorAll(".mrbb-item").length,
      hostH: host.getBoundingClientRect().height,
      headerTop: document.getElementById("fixed-header").getBoundingClientRect().top,
    };
  });
  check("narrow window -> more rows & items in ext bar",
    narrow.rows >= info.rowCount && narrow.items > after - 1,
    `rows ${info.rowCount}->${narrow.rows}, items ${after}->${narrow.items}`);
  check("fixed header re-adjusted on resize", Math.abs(narrow.headerTop - narrow.hostH) < 1,
    `headerTop=${narrow.headerTop} bar=${narrow.hostH}`);

  // --- D&D indicator aligns with item boundary under cursor ---
  const dndCheck = await page.evaluate(() => {
    const sh = document.getElementById("mrbb-host").shadowRoot;
    const root = sh.getElementById("mrbb-root");
    const items = [...sh.querySelectorAll(".mrbb-item:not(.mrbb-folder)")];
    if (items.length < 3) return { error: "not enough items" };
    const src = items[0], target = items[2];
    const dt = new DataTransfer();
    const tr = target.getBoundingClientRect();
    src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, composed: true, dataTransfer: dt }));
    // カーソルを target の左40%位置に置く → | は target の左端に出るはず
    root.dispatchEvent(new DragEvent("dragover", {
      bubbles: true, composed: true, dataTransfer: dt,
      clientX: tr.left + tr.width * 0.4, clientY: tr.top + tr.height / 2,
    }));
    const ind = sh.querySelector(".mrbb-drop-indicator");
    const ir = ind ? ind.getBoundingClientRect() : null;
    root.dispatchEvent(new DragEvent("dragend", { bubbles: true, composed: true }));
    return ir ? { indLeft: ir.left, expected: tr.left - 1, diff: Math.abs(ir.left - (tr.left - 1)) } : { error: "no indicator" };
  });
  check("D&D indicator at item boundary (no offset)", dndCheck.diff !== undefined && dndCheck.diff < 2,
    JSON.stringify(dndCheck));

  // --- drag leaving the bar clears the stale drop indicator ---
  const staleInd = await page.evaluate(() => {
    const sh = document.getElementById("mrbb-host").shadowRoot;
    const root = sh.getElementById("mrbb-root");
    const items = [...sh.querySelectorAll(".mrbb-item:not(.mrbb-folder)")];
    const src = items[0], target = items[2];
    const dt = new DataTransfer();
    const tr = target.getBoundingClientRect();
    src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, composed: true, dataTransfer: dt }));
    root.dispatchEvent(new DragEvent("dragover", {
      bubbles: true, composed: true, dataTransfer: dt,
      clientX: tr.left + 2, clientY: tr.top + tr.height / 2,
    }));
    const shown = !!sh.querySelector(".mrbb-drop-indicator");
    // ページ本文（バー外）へドラッグ → 消えるべき
    document.body.dispatchEvent(new DragEvent("dragover", {
      bubbles: true, composed: true, dataTransfer: dt,
      clientX: 400, clientY: 500,
    }));
    const afterPage = !!sh.querySelector(".mrbb-drop-indicator");
    // 再度バー上 → 復活、そしてウィンドウ外（ネイティブバー相当）へ → 消える
    root.dispatchEvent(new DragEvent("dragover", {
      bubbles: true, composed: true, dataTransfer: dt,
      clientX: tr.left + 2, clientY: tr.top + tr.height / 2,
    }));
    const reshown = !!sh.querySelector(".mrbb-drop-indicator");
    document.dispatchEvent(new DragEvent("dragleave", { bubbles: true, composed: true, relatedTarget: null }));
    const afterLeave = !!sh.querySelector(".mrbb-drop-indicator");
    root.dispatchEvent(new DragEvent("dragend", { bubbles: true, composed: true }));
    return { shown, afterPage, reshown, afterLeave };
  });
  check("indicator cleared when drag leaves the bar",
    staleInd.shown && !staleInd.afterPage && staleInd.reshown && !staleInd.afterLeave,
    JSON.stringify(staleInd));

  // --- hoverCloseMs: configurable folder close delay ---
  const setHover = (v) => sw.evaluate(async (val) => {
    const data = await chrome.storage.sync.get("mrbb-settings");
    const s = data["mrbb-settings"] || {};
    s.hoverCloseMs = val;
    await chrome.storage.sync.set({ "mrbb-settings": s });
  }, v);
  await setHover(1200);
  await sleep(700);
  const hoverBox = await page.evaluate(() => {
    const sh = document.getElementById("mrbb-host").shadowRoot;
    const f = [...sh.querySelectorAll(".mrbb-folder")].find(x => x.querySelector(".mrbb-title")?.textContent === "MyFolder");
    const r = f.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(hoverBox.x, hoverBox.y);
  await sleep(250);
  await page.mouse.move(500, 600); // 遠くへ離す
  await sleep(500); // 1200ms 未満 → まだ開いているはず
  const stillOpen = await page.evaluate(() =>
    !!document.getElementById("mrbb-host").shadowRoot.querySelector(".mrbb-dropdown")
  );
  await sleep(1100); // 合計 1600ms > 1200ms → 閉じているはず
  const closedAfter = await page.evaluate(() =>
    !!document.getElementById("mrbb-host").shadowRoot.querySelector(".mrbb-dropdown")
  );
  check("hoverCloseMs=1200: open at 500ms, closed after delay",
    stillOpen && !closedAfter, JSON.stringify({ stillOpen, closedAfter }));
  await setHover(400);
  await sleep(500);

  // --- boundary offset (px): +400px reserve shows 2 more items (each ~190px) ---
  await page.setViewport({ width: 1280, height: 900 });
  await sleep(500);
  const baseFirst = await page.evaluate(() =>
    parseInt(document.getElementById("mrbb-host").shadowRoot.querySelector(".mrbb-item").dataset.bmIndex, 10)
  );
  const setOffsetPx = (v) => sw.evaluate(async (val) => {
    const data = await chrome.storage.sync.get("mrbb-settings");
    const s = data["mrbb-settings"] || {};
    s.boundaryOffsetPx = val;
    await chrome.storage.sync.set({ "mrbb-settings": s });
  }, v);
  await setOffsetPx(400);
  await sleep(800);
  const offsetFirst = await page.evaluate(() =>
    parseInt(document.getElementById("mrbb-host").shadowRoot.querySelector(".mrbb-item").dataset.bmIndex, 10)
  );
  check("boundaryOffsetPx 400 starts 2 items earlier", offsetFirst === baseFirst - 2,
    `base=${baseFirst} offset=${offsetFirst}`);
  await setOffsetPx(0);
  await sleep(500);

  // --- gear ◀: one click = one bookmark earlier (px stored = item width) ---
  const gearRect2 = await page.evaluate(() => {
    const sh = document.getElementById("mrbb-host").shadowRoot;
    const g = sh.querySelector(".mrbb-gear-btn").getBoundingClientRect();
    return { x: g.x + g.width / 2, y: g.y + g.height / 2 };
  });
  await page.mouse.click(gearRect2.x, gearRect2.y);
  await sleep(300);
  const boDecRect = await page.evaluate(() => {
    const b = document.getElementById("mrbb-host").shadowRoot.querySelector('[data-action="bo-dec"]');
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(boDecRect.x, boDecRect.y);
  await sleep(800);
  const afterDec = await page.evaluate(() => {
    const sh = document.getElementById("mrbb-host").shadowRoot;
    return {
      first: parseInt(sh.querySelector(".mrbb-item").dataset.bmIndex, 10),
      label: sh.querySelector("#mrbb-bo-val")?.textContent ?? null,
    };
  });
  check("gear ◀ click shifts boundary exactly 1 item earlier",
    afterDec.first === baseFirst - 1 && /px$/.test(afterDec.label || ""),
    JSON.stringify({ base: baseFirst, ...afterDec }));
  await setOffsetPx(0);
  await page.mouse.click(640, 600);
  await sleep(400);

  // --- dropdown height: extends to viewport bottom, scrolls only when needed ---
  await sw.evaluate(async () => {
    const big = await chrome.bookmarks.create({ parentId: "1", title: "BigFolder" });
    for (let i = 1; i <= 40; i++) {
      await chrome.bookmarks.create({ parentId: big.id, title: "Big-" + i, url: "https://big.example/" + i });
    }
  });
  await sleep(900);
  // 小さいフォルダ（3件）: スクロール無しで全表示
  const smallDd = await page.evaluate(async () => {
    const sh = document.getElementById("mrbb-host").shadowRoot;
    const folders = [...sh.querySelectorAll(".mrbb-folder")];
    const f = folders.find(x => x.querySelector(".mrbb-title")?.textContent === "MyFolder");
    f.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, composed: true }));
    await new Promise(r => setTimeout(r, 200));
    const dd = sh.querySelector(".mrbb-dropdown");
    const out = dd ? { scrolls: dd.scrollHeight > dd.clientHeight, rows: dd.querySelectorAll(".mrbb-dropdown-row").length } : null;
    return out;
  });
  check("small folder: no scroll", smallDd && !smallDd.scrolls && smallDd.rows === 3, JSON.stringify(smallDd));
  // 大きいフォルダ（40件）: 画面下端まで伸びてスクロール
  const bigDd = await page.evaluate(async () => {
    const sh = document.getElementById("mrbb-host").shadowRoot;
    const folders = [...sh.querySelectorAll(".mrbb-folder")];
    const f = folders.find(x => x.querySelector(".mrbb-title")?.textContent === "BigFolder");
    f.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, composed: true }));
    await new Promise(r => setTimeout(r, 200));
    const dds = sh.querySelectorAll(".mrbb-dropdown");
    const dd = dds[dds.length - 1];
    const r = dd.getBoundingClientRect();
    return {
      scrolls: dd.scrollHeight > dd.clientHeight,
      bottom: r.bottom,
      viewportH: window.innerHeight,
      reachesBottom: r.bottom > window.innerHeight - 60,
    };
  });
  check("big folder: extends to viewport bottom and scrolls",
    bigDd.scrolls && bigDd.reachesBottom, JSON.stringify(bigDd));
  await sw.evaluate(async () => {
    const kids = await chrome.bookmarks.getChildren("1");
    const big = kids.find(k => k.title === "BigFolder");
    if (big) await chrome.bookmarks.removeTree(big.id);
  });
  await sleep(700);

  // --- i18n: context menu strings come from _locales (browser UI language) ---
  const menuTexts = await page.evaluate(() => {
    const sh = document.getElementById("mrbb-host").shadowRoot;
    const item = sh.querySelector(".mrbb-item.mrbb-link");
    item.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, composed: true, clientX: 300, clientY: 60 }));
    const menu = sh.querySelector(".mrbb-context-menu");
    const texts = menu ? [...menu.querySelectorAll(".mrbb-context-item")].map(m => m.textContent) : [];
    if (menu) menu.remove();
    return texts;
  });
  const expectedI18n = await sw.evaluate(() => ({
    locale: chrome.i18n.getUILanguage(),
    rename: chrome.i18n.getMessage("rename"),
    openInNewTab: chrome.i18n.getMessage("openInNewTab"),
    sortByName: chrome.i18n.getMessage("sortByName"),
  }));
  check("i18n: context menu localized to browser UI language",
    menuTexts.includes(expectedI18n.rename) &&
    menuTexts.includes(expectedI18n.openInNewTab) &&
    menuTexts.includes(expectedI18n.sortByName),
    JSON.stringify({ locale: expectedI18n.locale, sample: menuTexts.slice(0, 3) }));

  // --- gear settings panel: real mouse clicks work through shadow DOM ---
  const gearRect = await page.evaluate(() => {
    const sh = document.getElementById("mrbb-host").shadowRoot;
    const g = sh.querySelector(".mrbb-gear-btn").getBoundingClientRect();
    return { x: g.x + g.width / 2, y: g.y + g.height / 2 };
  });
  await page.mouse.click(gearRect.x, gearRect.y);
  await sleep(300);
  const panelOpen = await page.evaluate(() =>
    !!document.getElementById("mrbb-host").shadowRoot.querySelector(".mrbb-settings-panel")
  );
  check("gear click opens settings panel", panelOpen);

  const fsBtnRect = await page.evaluate(() => {
    const sh = document.getElementById("mrbb-host").shadowRoot;
    const b = sh.querySelector('[data-action="fs-inc"]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(fsBtnRect.x, fsBtnRect.y);
  await sleep(600);
  const afterClick = await page.evaluate(async () => {
    const sh = document.getElementById("mrbb-host").shadowRoot;
    return {
      panelStillOpen: !!sh.querySelector(".mrbb-settings-panel"),
      fsLabel: sh.querySelector("#mrbb-fs-val")?.textContent ?? null,
    };
  });
  const storedFs = await sw.evaluate(async () => {
    const d = await chrome.storage.sync.get("mrbb-settings");
    return d["mrbb-settings"]?.fontSize;
  });
  check("settings button click works (panel stays, value saved)",
    afterClick.panelStillOpen && afterClick.fsLabel === "13px" && storedFs === 13,
    JSON.stringify({ ...afterClick, storedFs }));
  // 元に戻して panel を閉じる（パネル外をクリック）
  await sw.evaluate(async () => {
    const d = await chrome.storage.sync.get("mrbb-settings");
    const s = d["mrbb-settings"] || {};
    s.fontSize = 12;
    await chrome.storage.sync.set({ "mrbb-settings": s });
  });
  await page.mouse.click(640, 600);
  await sleep(400);
  const panelClosed = await page.evaluate(() =>
    !document.getElementById("mrbb-host").shadowRoot.querySelector(".mrbb-settings-panel")
  );
  check("panel closes on outside click", panelClosed);

  // --- dragstart puts URL payload on the drag (native bar drop needs it) ---
  // NOTE: effectAllowed は合成イベントでは Chrome が設定を無視して "none" を
  // 返すため検証できない（実ドラッグでは "all" が効く）。URI のみ検証する。
  const ea = await page.evaluate(() => {
    const sh = document.getElementById("mrbb-host").shadowRoot;
    const src = sh.querySelector(".mrbb-item.mrbb-link");
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, composed: true, dataTransfer: dt }));
    const out = { uri: dt.getData("text/uri-list"), plain: dt.getData("text/plain") };
    sh.getElementById("mrbb-root").dispatchEvent(new DragEvent("dragend", { bubbles: true, composed: true }));
    return out;
  });
  check("dragstart sets uri payload for native bar drop",
    ea.uri.startsWith("http") && ea.plain === ea.uri, JSON.stringify(ea));

  // --- folder icon is GM3 outline (native style) ---
  const iconCheck = await page.evaluate(() => {
    const sh = document.getElementById("mrbb-host").shadowRoot;
    const span = sh.querySelector(".mrbb-folder-icon");
    return span ? getComputedStyle(span).webkitMaskImage : null;
  });
  check("folder icon is GM3 outline (mask svg)", iconCheck && iconCheck.includes("M160-160"),
    iconCheck ? iconCheck.slice(0, 60) + "..." : "null");

  // --- native->ext: external URI drop moves an existing bookmark (no duplicate) ---
  const extDrop = await page.evaluate(() => {
    const sh = document.getElementById("mrbb-host").shadowRoot;
    const root = sh.getElementById("mrbb-root");
    const items = [...sh.querySelectorAll(".mrbb-item:not(.mrbb-folder)")];
    const target = items[1];
    const tr = target.getBoundingClientRect();
    const dt = new DataTransfer();
    dt.setData("text/uri-list", "https://example.com/page1"); // Bookmark-01: native row 0 side
    dt.setData("text/plain", "https://example.com/page1");
    const opts = { bubbles: true, composed: true, dataTransfer: dt, clientX: tr.left + 2, clientY: tr.top + tr.height / 2 };
    root.dispatchEvent(new DragEvent("dragover", opts));
    root.dispatchEvent(new DragEvent("drop", opts));
    return { targetIdx: parseInt(target.dataset.bmIndex, 10) };
  });
  await sleep(800);
  const movedCheck = await sw.evaluate(async () => {
    const res = await chrome.bookmarks.search({ url: "https://example.com/page1" });
    return { count: res.length, index: res[0]?.index, parentId: res[0]?.parentId };
  });
  check("native->ext drop moves bookmark (no duplicate)",
    movedCheck.count === 1 && movedCheck.parentId === "1" && movedCheck.index >= extDrop.targetIdx - 1,
    JSON.stringify({ movedCheck, targetIdx: extDrop.targetIdx }));

  // --- unknown URL drop creates a bookmark at position ---
  await page.evaluate(() => {
    const sh = document.getElementById("mrbb-host").shadowRoot;
    const root = sh.getElementById("mrbb-root");
    const items = [...sh.querySelectorAll(".mrbb-item:not(.mrbb-folder)")];
    const tr = items[2].getBoundingClientRect();
    const dt = new DataTransfer();
    dt.setData("text/uri-list", "https://newly-dropped.example/x");
    dt.setData("text/html", "<a href='https://newly-dropped.example/x'>Dropped Link</a>");
    const opts = { bubbles: true, composed: true, dataTransfer: dt, clientX: tr.left + 2, clientY: tr.top + tr.height / 2 };
    root.dispatchEvent(new DragEvent("dragover", opts));
    root.dispatchEvent(new DragEvent("drop", opts));
  });
  await sleep(800);
  const createdCheck = await sw.evaluate(async () => {
    const res = await chrome.bookmarks.search({ url: "https://newly-dropped.example/x" });
    return { count: res.length, parentId: res[0]?.parentId, title: res[0]?.title };
  });
  check("unknown URL drop creates bookmark with title",
    createdCheck.count === 1 && createdCheck.parentId === "1" && createdCheck.title === "Dropped Link",
    JSON.stringify(createdCheck));

  // --- ext->native: Chrome-created duplicate turns into a move (original removed) ---
  const dragMove = await page.evaluate(() => {
    const sh = document.getElementById("mrbb-host").shadowRoot;
    const items = [...sh.querySelectorAll(".mrbb-item.mrbb-link")];
    const src = items[items.length - 1];
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, composed: true, dataTransfer: dt }));
    return { url: src.getAttribute("href"), id: src.dataset.bmId };
  });
  await sleep(400); // MRBB_DRAG_START が SW に届くのを待つ
  await sw.evaluate(async (url) => {
    // ネイティブバーへのドロップで Chrome が複製を作る動きを再現
    await chrome.bookmarks.create({ parentId: "1", index: 0, title: "native-copy", url });
  }, dragMove.url);
  await page.evaluate(() => {
    const sh = document.getElementById("mrbb-host").shadowRoot;
    sh.getElementById("mrbb-root").dispatchEvent(new DragEvent("dragend", { bubbles: true, composed: true }));
  });
  await sleep(800);
  const afterMove = await sw.evaluate(async (url) => {
    const res = await chrome.bookmarks.search({ url });
    return res.filter((r) => r.url === url).map((r) => r.id);
  }, dragMove.url);
  check("ext->native drop becomes move (original removed)",
    afterMove.length === 1 && afterMove[0] !== dragMove.id,
    JSON.stringify({ remaining: afterMove, original: dragMove.id }));

  // --- tab group chips shrink the native bar estimate (boundary moves earlier) ---
  const beforeGroup = await page.evaluate(() =>
    parseInt(document.getElementById("mrbb-host").shadowRoot.querySelector(".mrbb-item").dataset.bmIndex, 10)
  );
  const groupIds = await sw.evaluate(async () => {
    const gids = [];
    for (const title of ["TestGroupWithVeryLongTitle-One", "TestGroupWithVeryLongTitle-Two"]) {
      const tab = await chrome.tabs.create({ url: "about:blank", active: false });
      const gid = await chrome.tabs.group({ tabIds: [tab.id] });
      await chrome.tabGroups.update(gid, { title });
      gids.push(gid);
    }
    return gids;
  });
  await sleep(1000);
  const afterGroup = await page.evaluate(() =>
    parseInt(document.getElementById("mrbb-host").shadowRoot.querySelector(".mrbb-item").dataset.bmIndex, 10)
  );
  await sw.evaluate(async (gids) => {
    for (const gid of gids) {
      const tabs = await chrome.tabs.query({ groupId: gid });
      for (const t of tabs) await chrome.tabs.remove(t.id);
    }
  }, groupIds);
  await sleep(800);
  const afterUngroup = await page.evaluate(() =>
    parseInt(document.getElementById("mrbb-host").shadowRoot.querySelector(".mrbb-item").dataset.bmIndex, 10)
  );
  check("tab group chip shifts boundary earlier & restores on close",
    afterGroup < beforeGroup && afterUngroup === beforeGroup,
    JSON.stringify({ beforeGroup, afterGroup, afterUngroup }));

  // --- autohide (default): page untouched, bar reveals at top edge ---
  await sw.evaluate(async () => {
    const data = await chrome.storage.sync.get("mrbb-settings");
    const s = data["mrbb-settings"] || {};
    s.displayBehavior = "autohide";
    await chrome.storage.sync.set({ "mrbb-settings": s });
  });
  await sleep(800);
  const ah = await page.evaluate(() => {
    const host = document.getElementById("mrbb-host");
    return {
      cls: host.className,
      hidden: host.getBoundingClientRect().bottom <= 0,
      bodyMargin: getComputedStyle(document.body).marginTop,
      headerTop: document.getElementById("fixed-header").getBoundingClientRect().top,
      sidebarTop: document.getElementById("fixed-sidebar").getBoundingClientRect().top,
    };
  });
  check("autohide: page layout untouched (margin/fixed restored)",
    parseFloat(ah.bodyMargin) === 0 && ah.headerTop === 0 && ah.sidebarTop === 0,
    JSON.stringify(ah));
  check("autohide: bar hidden above viewport", /mrbb-autohide/.test(ah.cls) && ah.hidden, ah.cls);

  await page.mouse.move(400, 300);
  await sleep(100);
  await page.mouse.move(400, 1); // 画面最上端 → 表示
  await sleep(400);
  const revealed = await page.evaluate(() => {
    const host = document.getElementById("mrbb-host");
    const r = host.getBoundingClientRect();
    return { top: r.top, shown: host.classList.contains("mrbb-shown") };
  });
  check("autohide: reveals at top edge", revealed.shown && Math.abs(revealed.top) < 1, JSON.stringify(revealed));

  await page.mouse.move(500, 600); // 離れる → 自動格納
  await sleep(900);
  const rehidden = await page.evaluate(() => {
    const host = document.getElementById("mrbb-host");
    return { shown: host.classList.contains("mrbb-shown"), bottom: host.getBoundingClientRect().bottom };
  });
  check("autohide: hides again after leaving", !rehidden.shown && rehidden.bottom <= 0, JSON.stringify(rehidden));

  // --- autohide configs ---
  const setAh = (patch) => sw.evaluate(async (p) => {
    const data = await chrome.storage.sync.get("mrbb-settings");
    const s = data["mrbb-settings"] || {};
    Object.assign(s, p);
    await chrome.storage.sync.set({ "mrbb-settings": s });
  }, patch);

  // revealEdgePx=30: y=25 で表示される / autohideDelayMs=1500: 800ms ではまだ表示
  await setAh({ revealEdgePx: 30, autohideDelayMs: 1500 });
  await sleep(600);
  await page.mouse.move(400, 300);
  await sleep(100);
  await page.mouse.move(400, 25);
  await sleep(300);
  const wideEdge = await page.evaluate(() =>
    document.getElementById("mrbb-host").classList.contains("mrbb-shown"));
  check("config: revealEdgePx=30 reveals at y=25", wideEdge, String(wideEdge));
  await page.mouse.move(500, 600);
  await sleep(800);
  const stillShown = await page.evaluate(() =>
    document.getElementById("mrbb-host").classList.contains("mrbb-shown"));
  await sleep(1100);
  const hiddenLater = await page.evaluate(() =>
    document.getElementById("mrbb-host").classList.contains("mrbb-shown"));
  check("config: autohideDelayMs=1500 (shown at 800ms, hidden after)",
    stillShown && !hiddenLater, JSON.stringify({ stillShown, hiddenLater }));

  // hideOnOutsideClick: バー外クリックで即隠す
  await setAh({ revealEdgePx: 2, autohideDelayMs: 5000, hideOnOutsideClick: true });
  await sleep(600);
  await page.mouse.move(400, 1);
  await sleep(300);
  await page.mouse.click(500, 500); // バー外クリック
  await sleep(300);
  const afterOutside = await page.evaluate(() =>
    document.getElementById("mrbb-host").classList.contains("mrbb-shown"));
  check("config: outside click hides instantly", !afterOutside, String(afterOutside));

  // hideOnClick: ブックマーククリックで即隠す（ナビゲーションは抑止して検証）
  await page.mouse.move(400, 1);
  await sleep(300);
  const afterLinkClick = await page.evaluate(async () => {
    const sh = document.getElementById("mrbb-host").shadowRoot;
    const link = sh.querySelector(".mrbb-item.mrbb-link");
    link.addEventListener("click", (e) => e.preventDefault(), { once: true });
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 200));
    return document.getElementById("mrbb-host").classList.contains("mrbb-shown");
  });
  check("config: bookmark click hides instantly", !afterLinkClick, String(afterLinkClick));
  await setAh({ autohideDelayMs: 400 });
  await sleep(400);

  // --- NTP override: custom mode shows search + bar, default mode redirects ---
  const ntpPage = await browser.newPage();
  await ntpPage.goto("chrome://newtab/", { waitUntil: "load" }).catch(() => {});
  await sleep(800);
  const ntpCustom = await ntpPage.evaluate(() => ({
    url: location.href,
    hasSearch: !!document.getElementById("q"),
    hasBar: !!document.getElementById("mrbb-host"),
    barItems: document.getElementById("mrbb-host")?.shadowRoot?.querySelectorAll(".mrbb-item").length ?? 0,
    autohide: document.getElementById("mrbb-host")?.classList.contains("mrbb-autohide") ?? null,
    bodyMargin: parseFloat(getComputedStyle(document.body).marginTop),
  })).catch(() => null);
  check("NTP custom: extension page with search box + bar (always visible)",
    ntpCustom && /chrome-extension:.*newtab\.html/.test(ntpCustom.url) && ntpCustom.hasSearch &&
    ntpCustom.hasBar && ntpCustom.barItems > 0 && ntpCustom.autohide === false && ntpCustom.bodyMargin > 0,
    JSON.stringify(ntpCustom));
  await ntpPage.close();

  await sw.evaluate(async () => {
    const data = await chrome.storage.sync.get("mrbb-settings");
    const s = data["mrbb-settings"] || {};
    s.ntpMode = "default";
    await chrome.storage.sync.set({ "mrbb-settings": s });
  });
  const ntpPage2 = await browser.newPage();
  await ntpPage2.goto("chrome://newtab/", { waitUntil: "load" }).catch(() => {});
  await sleep(1200);
  // chrome:// の URL は拡張権限からは見えないため puppeteer 側で確認する
  const pageUrls = (await browser.pages()).map((p) => p.url());
  check("NTP default: redirects to Chrome standard new tab",
    pageUrls.some((u) => u.startsWith("chrome://new-tab-page")) &&
    !pageUrls.some((u) => u.includes("newtab.html")),
    JSON.stringify(pageUrls));
  await ntpPage2.close().catch(() => {});
  await sw.evaluate(async () => {
    const data = await chrome.storage.sync.get("mrbb-settings");
    const s = data["mrbb-settings"] || {};
    s.ntpMode = "custom";
    await chrome.storage.sync.set({ "mrbb-settings": s });
  });

  // --- everything fits -> bar disappears & page restored ---
  await sw.evaluate(async () => {
    const kids = await chrome.bookmarks.getChildren("1");
    for (const k of kids.slice(3)) {
      if (k.url) await chrome.bookmarks.remove(k.id);
      else await chrome.bookmarks.removeTree(k.id);
    }
  });
  await sleep(1000);
  const gone = await page.evaluate(() => ({
    host: !!document.getElementById("mrbb-host"),
    margin: getComputedStyle(document.body).marginTop,
    headerTop: document.getElementById("fixed-header").getBoundingClientRect().top,
  }));
  check("bar removed when all fit natively", !gone.host, JSON.stringify(gone));
  check("body margin restored", parseFloat(gone.margin) === 0, gone.margin);
  check("fixed header restored to top:0", gone.headerTop === 0, `top=${gone.headerTop}`);

  // --- screenshot for the record (re-seed, wide) ---
  await sw.evaluate(async () => {
    for (let i = 1; i <= 25; i++) {
      await chrome.bookmarks.create({
        parentId: "1",
        title: "Bookmark-" + String(i).padStart(2, "0") + " (some longer title)",
        url: "https://example.com/page" + i,
      });
    }
  });
  await page.setViewport({ width: 1280, height: 900 });
  await sleep(800);
  await page.screenshot({ path: "mrbb-v160-screenshot.png" });

} catch (e) {
  check("UNEXPECTED ERROR", false, String(e.stack || e));
} finally {
  await browser.close();
  server.close();
}

let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.extra ? "  [" + r.extra + "]" : ""}`);
  if (!r.pass) failed++;
}
console.log(failed === 0 ? "\nALL TESTS PASSED" : `\n${failed} TEST(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
