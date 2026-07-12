import { BAR_HEIGHT, ROOT_ID, HOST_ID, STORAGE_KEY, faviconUrl, LINK_ICON_SVG } from "../shared/constants";
import type { BookmarkDisplayItem, Settings } from "../shared/types";
import { DEFAULT_SETTINGS } from "../shared/types";
import { calcLayout } from "./overflow-calc";
import { createBookmarkElement } from "./bookmark-item";
import { closeAllDropdowns, showFolderDropdown } from "./folder-dropdown";
import { initDragDrop } from "./drag-drop";
import { initContextMenu } from "./context-menu";

let currentSettings: Settings = { ...DEFAULT_SETTINGS };
let hostEl: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let rootEl: HTMLElement | null = null;
let marginObserver: MutationObserver | null = null;
let expectedPaddingTop: string = "";
let cssLoaded: boolean = false;

/** Shadow DOM 内のバーコンテナを返す（drag-drop.ts 等から利用） */
export function getBarContainer(): HTMLElement | null {
  return rootEl;
}

/** service worker 経由でブックマークを取得 */
async function fetchBookmarks(): Promise<BookmarkDisplayItem[]> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "MRBB_GET_BOOKMARKS" }, (response) => {
      if (chrome.runtime.lastError || !response) {
        console.warn("[MRBB] Failed to get bookmarks:", chrome.runtime.lastError);
        resolve([]);
        return;
      }
      resolve(response.bookmarks || []);
    });
  });
}

/** CSS をロードして Shadow DOM に注入 */
async function loadAndInjectCSS(shadow: ShadowRoot): Promise<void> {
  if (cssLoaded) return;
  try {
    const cssUrl = chrome.runtime.getURL("content.css");
    const resp = await fetch(cssUrl);
    const cssText = await resp.text();

    const style = document.createElement("style");
    style.textContent = cssText;
    shadow.insertBefore(style, shadow.firstChild);
    cssLoaded = true;
  } catch (err) {
    console.warn("[MRBB] Failed to load CSS:", err);
  }
}

/** ルートDOM要素を作成 or 取得（Shadow DOM） */
async function ensureRoot(): Promise<HTMLElement> {
  if (rootEl && hostEl && shadowRoot) return rootEl;

  // ホスト要素を作成
  hostEl = document.createElement("div");
  hostEl.id = HOST_ID;
  // <html> 直下に挿入（body の外 — transform の影響を受けない）
  document.documentElement.insertBefore(hostEl, document.body);

  // Shadow DOM を作成（open: DevTools で検査可能）
  shadowRoot = hostEl.attachShadow({ mode: "open" });

  // CSS を Shadow DOM に注入
  await loadAndInjectCSS(shadowRoot);

  // 内部コンテナ
  rootEl = document.createElement("div");
  rootEl.id = ROOT_ID;
  shadowRoot.appendChild(rootEl);

  // D&D とコンテキストメニューを初期化
  initDragDrop(rootEl);
  initContextMenu(rootEl);

  return rootEl;
}

/** ギアアイコン（設定ボタン）を生成 */
function createGearButton(): HTMLElement {
  const btn = document.createElement("div");
  btn.className = "mrbb-gear-btn";
  btn.title = "Settings";
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 20 20" fill="#5f6368">
    <path d="M8.58 2.06A1 1 0 0 1 9.56 1h.88a1 1 0 0 1 .98.84l.18 1.28a6.02 6.02 0 0 1 1.56.64l1.08-.72a1 1 0 0 1 1.28.14l.62.62a1 1 0 0 1 .14 1.28l-.72 1.08c.28.48.48 1 .64 1.56l1.28.18a1 1 0 0 1 .84.98v.88a1 1 0 0 1-.84.98l-1.28.18a6.02 6.02 0 0 1-.64 1.56l.72 1.08a1 1 0 0 1-.14 1.28l-.62.62a1 1 0 0 1-1.28.14l-1.08-.72c-.48.28-1 .48-1.56.64l-.18 1.28a1 1 0 0 1-.98.84h-.88a1 1 0 0 1-.98-.84l-.18-1.28a6.02 6.02 0 0 1-1.56-.64l-1.08.72a1 1 0 0 1-1.28-.14l-.62-.62a1 1 0 0 1-.14-1.28l.72-1.08a6.02 6.02 0 0 1-.64-1.56l-1.28-.18A1 1 0 0 1 1 10.44v-.88a1 1 0 0 1 .84-.98l1.28-.18a6.02 6.02 0 0 1 .64-1.56l-.72-1.08a1 1 0 0 1 .14-1.28l.62-.62a1 1 0 0 1 1.28-.14l1.08.72c.48-.28 1-.48 1.56-.64l.18-1.28zM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>
  </svg>`;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    showInlineSettings(btn);
  });
  return btn;
}

/** インライン設定パネル */
function showInlineSettings(anchor: HTMLElement): void {
  const existing = document.getElementById("mrbb-settings-panel");
  if (existing) { existing.remove(); return; }

  const panel = document.createElement("div");
  panel.id = "mrbb-settings-panel";
  panel.className = "mrbb-settings-panel";

  const fs = currentSettings.fontSize || 12;
  const bh = currentSettings.barHeight || 34;
  panel.innerHTML = `
    <div class="mrbb-settings-title">Multi-Row Bookmark Bar</div>
    <div class="mrbb-settings-row">
      <span>Font size</span>
      <div class="mrbb-settings-fontsize">
        <button data-action="fs-decrease">-</button>
        <span id="mrbb-fs-value">${fs}px</span>
        <button data-action="fs-increase">+</button>
      </div>
    </div>
    <div class="mrbb-settings-row">
      <span>Row height</span>
      <div class="mrbb-settings-fontsize">
        <button data-action="bh-decrease">-</button>
        <span id="mrbb-bh-value">${bh}px</span>
        <button data-action="bh-increase">+</button>
      </div>
    </div>
    <div class="mrbb-settings-row">
      <span>Max rows (0=unlimited)</span>
      <input type="number" id="mrbb-maxrows-input" value="${currentSettings.maxRows}" min="0" max="20" style="width:48px;text-align:center;border:1px solid #dadce0;border-radius:3px;padding:2px 4px;font-size:12px;">
    </div>
    <div class="mrbb-settings-row">
      <span>Folder open</span>
      <select id="mrbb-foldermode-select" style="border:1px solid #dadce0;border-radius:3px;padding:2px 4px;font-size:12px;">
        <option value="hover" ${currentSettings.folderOpenMode === "hover" ? "selected" : ""}>Hover</option>
        <option value="click" ${currentSettings.folderOpenMode === "click" ? "selected" : ""}>Click</option>
      </select>
    </div>
  `;

  const rect = anchor.getBoundingClientRect();
  panel.style.position = "fixed";
  panel.style.top = `${rect.bottom + 4}px`;
  panel.style.left = `${rect.left}px`;
  panel.style.zIndex = "2147483647";
  document.body.appendChild(panel);

  panel.querySelector('[data-action="fs-decrease"]')?.addEventListener("click", () => {
    const newFs = Math.max(8, (currentSettings.fontSize || 12) - 1);
    updateFontSize(newFs);
    const label = panel.querySelector("#mrbb-fs-value");
    if (label) label.textContent = `${newFs}px`;
  });
  panel.querySelector('[data-action="fs-increase"]')?.addEventListener("click", () => {
    const newFs = Math.min(20, (currentSettings.fontSize || 12) + 1);
    updateFontSize(newFs);
    const label = panel.querySelector("#mrbb-fs-value");
    if (label) label.textContent = `${newFs}px`;
  });
  panel.querySelector('[data-action="bh-decrease"]')?.addEventListener("click", () => {
    const newBh = Math.max(20, (currentSettings.barHeight || 34) - 2);
    currentSettings.barHeight = newBh;
    saveSettings();
    const label = panel.querySelector("#mrbb-bh-value");
    if (label) label.textContent = `${newBh}px`;
  });
  panel.querySelector('[data-action="bh-increase"]')?.addEventListener("click", () => {
    const newBh = Math.min(60, (currentSettings.barHeight || 34) + 2);
    currentSettings.barHeight = newBh;
    saveSettings();
    const label = panel.querySelector("#mrbb-bh-value");
    if (label) label.textContent = `${newBh}px`;
  });
  panel.querySelector("#mrbb-maxrows-input")?.addEventListener("change", (e) => {
    const val = parseInt((e.target as HTMLInputElement).value, 10) || 0;
    currentSettings.maxRows = val;
    saveSettings();
  });
  panel.querySelector("#mrbb-foldermode-select")?.addEventListener("change", (e) => {
    currentSettings.folderOpenMode = (e.target as HTMLSelectElement).value as "hover" | "click";
    saveSettings();
  });

  const closeHandler = (e: MouseEvent) => {
    if (!panel.contains(e.target as Node) && e.target !== anchor && !anchor.contains(e.target as Node)) {
      panel.remove();
      document.removeEventListener("mousedown", closeHandler, true);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", closeHandler, true), 0);
  panel.addEventListener("contextmenu", (e) => e.stopPropagation());
}

/** 検索ボタンと入力欄を生成 */
function createSearchButton(): HTMLElement {
  const container = document.createElement("div");
  container.className = "mrbb-search-container";

  const btn = document.createElement("div");
  btn.className = "mrbb-search-btn";
  btn.title = "Search bookmarks";
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 20 20" fill="#5f6368">
    <path d="M8.5 3a5.5 5.5 0 0 1 4.38 8.82l4.15 4.15a.75.75 0 0 1-1.06 1.06l-4.15-4.15A5.5 5.5 0 1 1 8.5 3zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/>
  </svg>`;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "mrbb-search-input";
  input.placeholder = "Search...";

  let searchTimer: ReturnType<typeof setTimeout>;
  let resultsEl: HTMLElement | null = null;

  const closeResults = () => {
    if (resultsEl) { resultsEl.remove(); resultsEl = null; }
  };
  const closeSearch = () => {
    input.classList.remove("mrbb-search-open");
    input.value = "";
    closeResults();
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (input.classList.contains("mrbb-search-open")) {
      closeSearch();
    } else {
      input.classList.add("mrbb-search-open");
      input.focus();
    }
  });

  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const query = input.value.trim();
    if (query.length < 2) { closeResults(); return; }
    searchTimer = setTimeout(() => {
      chrome.runtime.sendMessage({ type: "MRBB_SEARCH_BOOKMARKS", query }, (response) => {
        if (chrome.runtime.lastError || !response) return;
        showSearchResults(response.results || [], input);
      });
    }, 200);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSearch();
  });

  const showSearchResults = (results: Array<{ id: string; title: string; url: string }>, anchor: HTMLElement) => {
    closeResults();
    resultsEl = document.createElement("div");
    resultsEl.className = "mrbb-search-results";

    if (results.length === 0) {
      const empty = document.createElement("div");
      empty.className = "mrbb-search-empty";
      empty.textContent = "No results found";
      resultsEl.appendChild(empty);
    } else {
      for (const r of results) {
        const row = document.createElement("a");
        row.className = "mrbb-search-result-row";
        row.href = r.url;
        const icon = document.createElement("img");
        icon.width = 16; icon.height = 16;
        icon.style.cssText = "flex-shrink:0;border-radius:2px;";
        icon.src = faviconUrl(r.url);
        icon.onerror = () => { icon.src = LINK_ICON_SVG; };
        row.appendChild(icon);
        const textWrap = document.createElement("div");
        textWrap.style.cssText = "flex:1;overflow:hidden;";
        const title = document.createElement("div");
        title.className = "mrbb-search-result-text";
        title.textContent = r.title || r.url;
        textWrap.appendChild(title);
        const url = document.createElement("div");
        url.className = "mrbb-search-result-url";
        url.textContent = r.url;
        textWrap.appendChild(url);
        row.appendChild(textWrap);
        resultsEl.appendChild(row);
      }
    }

    const rect = anchor.getBoundingClientRect();
    resultsEl.style.position = "fixed";
    resultsEl.style.top = `${rect.bottom + 4}px`;
    resultsEl.style.left = `${Math.max(4, rect.right - 300)}px`;
    resultsEl.style.zIndex = "2147483647";
    document.body.appendChild(resultsEl);
  };

  document.addEventListener("mousedown", (e) => {
    if (!container.contains(e.target as Node) && resultsEl && !resultsEl.contains(e.target as Node)) {
      closeSearch();
    }
  }, true);

  container.appendChild(input);
  container.appendChild(btn);
  return container;
}

function updateFontSize(newFs: number): void {
  currentSettings.fontSize = newFs;
  saveSettings();
}

function saveSettings(): void {
  chrome.storage.sync.set({ [STORAGE_KEY]: currentSettings });
}

/** 多段バーを描画 */
export async function render(): Promise<void> {
  if (!currentSettings.enabled) {
    removeBar();
    return;
  }

  if (currentSettings.showCondition === "new_tab_only") {
    const href = location.href;
    const isNewTab =
      href === "chrome://newtab/" ||
      href.startsWith("chrome-search://") ||
      href === "about:blank" ||
      href === "chrome://new-tab-page/";
    if (!isNewTab) { removeBar(); return; }
  }

  const bookmarks = await fetchBookmarks();
  if (bookmarks.length === 0) { removeBar(); return; }

  const fontSize = currentSettings.fontSize || 12;
  const availableWidth = window.innerWidth;
  const layoutItems = calcLayout(bookmarks, availableWidth, currentSettings);
  if (layoutItems.length === 0) { removeBar(); return; }

  const maxRow = Math.max(...layoutItems.map((li) => li.row));
  const totalRows = maxRow + 1;
  if (totalRows <= 1) { removeBar(); return; }

  rootEl = await ensureRoot();
  rootEl.innerHTML = "";
  closeAllDropdowns(true);

  const barHeight = currentSettings.barHeight || 34;
  const itemHeight = Math.max(barHeight - 6, 16);

  // CSS カスタムプロパティ — ホスト要素に設定（:host が参照）
  hostEl!.style.setProperty("--mrbb-font-size", `${fontSize}px`);
  hostEl!.style.setProperty("--mrbb-bar-height", `${barHeight}px`);
  hostEl!.style.setProperty("--mrbb-item-height", `${itemHeight}px`);

  for (let row = 0; row < totalRows; row++) {
    const rowEl = document.createElement("div");
    rowEl.className = "mrbb-row";

    if (row === 1) {
      rowEl.appendChild(createGearButton());
    }

    const rowItems = layoutItems.filter((li) => li.row === row);
    for (const li of rowItems) {
      const itemEl = createBookmarkElement(li.bookmark, currentSettings.displayMode);
      if (li.bookmark.isFolder) {
        if (currentSettings.folderOpenMode === "hover") {
          itemEl.addEventListener("mouseenter", () => {
            showFolderDropdown(li.bookmark, itemEl, "hover");
          });
        } else {
          itemEl.addEventListener("click", (e) => {
            e.preventDefault();
            showFolderDropdown(li.bookmark, itemEl, "click");
          });
        }
      }
      rowEl.appendChild(itemEl);
    }

    if (row === 1) {
      rowEl.appendChild(createSearchButton());
    }

    rootEl.appendChild(rowEl);
  }

  // Row 0 を非表示
  const firstRow = rootEl.querySelector(".mrbb-row:first-child") as HTMLElement | null;
  if (firstRow) {
    firstRow.classList.add("mrbb-row-hidden");
  }

  // ホスト要素の高さを設定
  const extraRows = totalRows - 1;
  const barTotalHeight = extraRows * barHeight;
  hostEl!.style.height = `${barTotalHeight}px`;

  // body を押し下げる: transform でfixed子要素の基準を変更 + padding-top
  expectedPaddingTop = `${barTotalHeight}px`;
  document.body.style.setProperty("transform", "translateY(0px)", "important");
  document.body.style.setProperty("padding-top", expectedPaddingTop, "important");

  // SPA による style リセットを監視
  if (!marginObserver) {
    marginObserver = new MutationObserver(() => {
      if (!rootEl || !expectedPaddingTop) return;
      const curPad = document.body.style.getPropertyValue("padding-top");
      const curTransform = document.body.style.getPropertyValue("transform");
      if (curPad !== expectedPaddingTop || curTransform !== "translateY(0px)") {
        document.body.style.setProperty("transform", "translateY(0px)", "important");
        document.body.style.setProperty("padding-top", expectedPaddingTop, "important");
      }
    });
    marginObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["style"],
    });
  }
}

/** バーを除去 */
function removeBar(): void {
  if (hostEl) {
    hostEl.remove();
    hostEl = null;
    shadowRoot = null;
    rootEl = null;
    cssLoaded = false;
  }
  if (marginObserver) {
    marginObserver.disconnect();
    marginObserver = null;
  }
  expectedPaddingTop = "";
  document.body.style.removeProperty("padding-top");
  document.body.style.removeProperty("transform");
}

/** 設定を更新して再描画 */
export function updateSettings(newSettings: Settings): void {
  currentSettings = { ...newSettings };
  render();
}

/** 現在の設定を返す */
export function getSettings(): Settings {
  return { ...currentSettings };
}
