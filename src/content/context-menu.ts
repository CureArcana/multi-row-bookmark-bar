import { closeAllDropdowns } from "./folder-dropdown";

let activeMenu: HTMLElement | null = null;
let globalListenersAttached = false;

/** 右クリックメニュー初期化 — バーコンテナに付与 */
export function initContextMenu(container: HTMLElement): void {
  container.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e);
  });

  // グローバルリスナーは一度だけ登録
  if (!globalListenersAttached) {
    document.addEventListener("click", () => dismissMenu(), true);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") dismissMenu();
    });
    globalListenersAttached = true;
  }
}

/** ドロップダウン内のアイテムにも右クリックを付与する用 */
export function attachDropdownContextMenu(
  rowEl: HTMLElement,
  bmId: string,
  isFolder: boolean,
  title: string,
  url: string,
  parentFolderId: string
): void {
  rowEl.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenuForItem(e, bmId, isFolder, title, url, parentFolderId);
  });
}

function dismissMenu(): void {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
}

function onContextMenu(e: MouseEvent): void {
  closeAllDropdowns(true);
  dismissMenu();

  const target = (e.target as HTMLElement).closest<HTMLElement>(".mrbb-item");
  const menu = document.createElement("div");
  menu.className = "mrbb-context-menu";

  if (target?.dataset.bmId) {
    const bmId = target.dataset.bmId;
    const isFolder = target.classList.contains("mrbb-folder");
    const title = target.querySelector(".mrbb-title")?.textContent || "";
    const url = target.getAttribute("href") || "";
    buildItemMenu(menu, bmId, isFolder, title, url, "1");
  }

  // 共通メニュー
  buildCommonMenu(menu, "1");
  showMenuAt(menu, e.clientX, e.clientY);
}

function onContextMenuForItem(
  e: MouseEvent,
  bmId: string,
  isFolder: boolean,
  title: string,
  url: string,
  parentFolderId: string
): void {
  dismissMenu();

  const menu = document.createElement("div");
  menu.className = "mrbb-context-menu";
  buildItemMenu(menu, bmId, isFolder, title, url, parentFolderId);
  buildCommonMenu(menu, parentFolderId);
  showMenuAt(menu, e.clientX, e.clientY);
}

/** ブックマーク固有のメニュー */
function buildItemMenu(
  menu: HTMLElement,
  bmId: string,
  isFolder: boolean,
  title: string,
  url: string,
  parentId: string
): void {
  // 「新しいタブで開く」（リンクのみ）
  if (!isFolder && url && url !== "#") {
    menu.appendChild(createMenuItem("Open in new tab", () => {
      chrome.runtime.sendMessage({ type: "MRBB_OPEN_TAB", url });
    }));
    menu.appendChild(createSeparator());
  }

  // 「フォルダ内すべてを新しいタブで開く」（フォルダのみ）
  if (isFolder) {
    menu.appendChild(createMenuItem("Open all in tabs", () => {
      chrome.runtime.sendMessage({ type: "MRBB_OPEN_ALL_IN_TABS", folderId: bmId });
    }));
    menu.appendChild(createSeparator());
  }

  // 「名前を変更」
  menu.appendChild(createMenuItem("Rename", () => {
    const newTitle = prompt("Enter new name:", title);
    if (newTitle !== null && newTitle !== title) {
      chrome.runtime.sendMessage({
        type: "MRBB_UPDATE_BOOKMARK",
        id: bmId,
        changes: { title: newTitle },
      });
    }
  }));

  // 「URLを編集」（リンクのみ）
  if (!isFolder) {
    menu.appendChild(createMenuItem("Edit URL", () => {
      const newUrl = prompt("Enter new URL:", url);
      if (newUrl !== null && newUrl !== url) {
        chrome.runtime.sendMessage({
          type: "MRBB_UPDATE_BOOKMARK",
          id: bmId,
          changes: { url: newUrl },
        });
      }
    }));
  }

  // フォルダから取り出す（parentIdが"1"でなければ）
  if (parentId !== "1") {
    menu.appendChild(createMenuItem("Move to bookmark bar", () => {
      chrome.runtime.sendMessage({
        type: "MRBB_MOVE_BOOKMARK",
        id: bmId,
        destination: { parentId: "1" },
      });
    }));
  }

  menu.appendChild(createSeparator());

  // 「削除」
  menu.appendChild(createMenuItem("Delete", () => {
    chrome.runtime.sendMessage({
      type: "MRBB_DELETE_BOOKMARK",
      id: bmId,
      isFolder,
    });
  }));

  menu.appendChild(createSeparator());
}

/** 共通メニュー（ページ追加、フォルダ追加、ソート） */
function buildCommonMenu(menu: HTMLElement, parentId: string): void {
  menu.appendChild(createMenuItem("Add page...", () => {
    const title = prompt("Bookmark name:", document.title);
    if (title === null) return;
    const url = prompt("URL:", window.location.href);
    if (url === null) return;
    chrome.runtime.sendMessage({
      type: "MRBB_CREATE_BOOKMARK",
      parentId,
      title,
      url,
    });
  }));

  menu.appendChild(createMenuItem("Add folder...", () => {
    const title = prompt("Folder name:");
    if (title === null || title.trim() === "") return;
    chrome.runtime.sendMessage({
      type: "MRBB_CREATE_FOLDER",
      parentId,
      title: title.trim(),
    });
  }));

  menu.appendChild(createSeparator());

  // ソートサブメニュー
  menu.appendChild(createMenuItem("Sort by name", () => {
    chrome.runtime.sendMessage({ type: "MRBB_SORT_BOOKMARKS", parentId, sortBy: "title" });
  }));
  menu.appendChild(createMenuItem("Sort by URL", () => {
    chrome.runtime.sendMessage({ type: "MRBB_SORT_BOOKMARKS", parentId, sortBy: "url" });
  }));
  menu.appendChild(createMenuItem("Sort by date added", () => {
    chrome.runtime.sendMessage({ type: "MRBB_SORT_BOOKMARKS", parentId, sortBy: "dateAdded" });
  }));
}

function showMenuAt(menu: HTMLElement, x: number, y: number): void {
  menu.style.position = "fixed";
  menu.style.zIndex = "2147483647";
  menu.style.left = "-9999px";
  menu.style.top = "-9999px";
  document.body.appendChild(menu);

  // 位置計算（画面外にはみ出さないよう調整）
  const menuRect = menu.getBoundingClientRect();
  let left = x;
  let top = y;
  if (left + menuRect.width > window.innerWidth) {
    left = window.innerWidth - menuRect.width - 4;
  }
  if (top + menuRect.height > window.innerHeight) {
    top = window.innerHeight - menuRect.height - 4;
  }

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  activeMenu = menu;

  // メニュー自体の右クリックはブラウザデフォルトを防ぐ
  menu.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
}

function createMenuItem(label: string, onClick: () => void): HTMLElement {
  const item = document.createElement("div");
  item.className = "mrbb-context-item";
  item.textContent = label;
  item.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dismissMenu();
    onClick();
  });
  return item;
}

function createSeparator(): HTMLElement {
  const sep = document.createElement("div");
  sep.className = "mrbb-context-separator";
  return sep;
}
