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
    main { padding-top: 50px; }
  </style></head>
  <body><div id="fixed-header">Fixed header</div>
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

  // --- boundary offset: -2 shows 2 more items in ext bar ---
  await page.setViewport({ width: 1280, height: 900 });
  await sleep(500);
  const baseFirst = await page.evaluate(() =>
    parseInt(document.getElementById("mrbb-host").shadowRoot.querySelector(".mrbb-item").dataset.bmIndex, 10)
  );
  const setOffset = (v) => sw.evaluate(async (val) => {
    const data = await chrome.storage.sync.get("mrbb-settings");
    const s = data["mrbb-settings"] || {};
    s.boundaryOffset = val;
    await chrome.storage.sync.set({ "mrbb-settings": s });
  }, v);
  await setOffset(-2);
  await sleep(800);
  const offsetFirst = await page.evaluate(() =>
    parseInt(document.getElementById("mrbb-host").shadowRoot.querySelector(".mrbb-item").dataset.bmIndex, 10)
  );
  check("boundaryOffset -2 starts 2 items earlier", offsetFirst === baseFirst - 2,
    `base=${baseFirst} offset=${offsetFirst}`);
  await setOffset(0);
  await sleep(500);

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
