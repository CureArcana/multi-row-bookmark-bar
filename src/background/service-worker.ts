/**
 * Background Service Worker
 *
 * - chrome.bookmarks API へのアクセスを一手に担う
 * - content script からのメッセージを受けてブックマークデータを返す
 */

import { BOOKMARK_BAR_ID, STORAGE_KEY } from "../shared/constants";
import { DEFAULT_SETTINGS } from "../shared/types";
import type { BookmarkDisplayItem } from "../shared/types";

/** Chrome BookmarkTreeNode → 表示用に変換 */
function toDisplayItem(node: chrome.bookmarks.BookmarkTreeNode): BookmarkDisplayItem {
  const isFolder = !node.url;
  return {
    id: node.id,
    title: node.title,
    url: node.url,
    isFolder,
    children: isFolder ? (node.children ?? []).map(toDisplayItem) : undefined,
    faviconUrl: "",
  };
}

/** ブックマークバー直下の全アイテムを取得 */
async function fetchBookmarks(): Promise<BookmarkDisplayItem[]> {
  const children = await chrome.bookmarks.getChildren(BOOKMARK_BAR_ID);
  const items: BookmarkDisplayItem[] = [];
  for (const child of children) {
    if (child.url) {
      items.push(toDisplayItem(child));
    } else {
      const subtree = await chrome.bookmarks.getSubTree(child.id);
      items.push(toDisplayItem(subtree[0]));
    }
  }
  return items;
}

// インストール時: デフォルト設定を保存
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    const existing = await chrome.storage.sync.get(STORAGE_KEY);
    if (!existing[STORAGE_KEY]) {
      await chrome.storage.sync.set({ [STORAGE_KEY]: DEFAULT_SETTINGS });
    }
  }
});

// content script からのメッセージを処理
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "MRBB_GET_BOOKMARKS") {
    fetchBookmarks()
      .then((bookmarks) => sendResponse({ bookmarks }))
      .catch((err) => sendResponse({ bookmarks: [], error: String(err) }));
    return true; // 非同期レスポンスを示す
  }

  if (message.type === "MRBB_MOVE_BOOKMARK") {
    chrome.bookmarks
      .move(message.id, message.destination)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  if (message.type === "MRBB_DELETE_BOOKMARK") {
    const removePromise = message.isFolder
      ? chrome.bookmarks.removeTree(message.id)
      : chrome.bookmarks.remove(message.id);
    removePromise
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  if (message.type === "MRBB_CREATE_BOOKMARK") {
    chrome.bookmarks
      .create({
        parentId: message.parentId || BOOKMARK_BAR_ID,
        title: message.title,
        url: message.url,
      })
      .then((node) => sendResponse({ success: true, id: node.id }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  if (message.type === "MRBB_CREATE_FOLDER") {
    chrome.bookmarks
      .create({
        parentId: message.parentId || BOOKMARK_BAR_ID,
        title: message.title,
      })
      .then((node) => sendResponse({ success: true, id: node.id }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  if (message.type === "MRBB_UPDATE_BOOKMARK") {
    chrome.bookmarks
      .update(message.id, message.changes)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  if (message.type === "MRBB_SEARCH_BOOKMARKS") {
    const query = (message.query || "").toLowerCase();
    chrome.bookmarks
      .search(query)
      .then((results) => {
        const items = results
          .filter((r) => r.url) // フォルダを除外
          .slice(0, 20) // 最大20件
          .map((r) => ({
            id: r.id,
            title: r.title,
            url: r.url,
          }));
        sendResponse({ results: items });
      })
      .catch((err) => sendResponse({ results: [], error: String(err) }));
    return true;
  }

  if (message.type === "MRBB_SORT_BOOKMARKS") {
    const parentId = message.parentId || BOOKMARK_BAR_ID;
    const sortBy = message.sortBy || "title"; // "title" | "url" | "dateAdded"
    chrome.bookmarks
      .getChildren(parentId)
      .then(async (children) => {
        // フォルダを先、リンクを後に分けてソート
        const folders = children.filter((c) => !c.url);
        const links = children.filter((c) => c.url);

        const sortFn = (a: chrome.bookmarks.BookmarkTreeNode, b: chrome.bookmarks.BookmarkTreeNode) => {
          if (sortBy === "url") {
            return (a.url || "").localeCompare(b.url || "");
          }
          if (sortBy === "dateAdded") {
            return (a.dateAdded || 0) - (b.dateAdded || 0);
          }
          return a.title.localeCompare(b.title);
        };

        folders.sort(sortFn);
        links.sort(sortFn);
        const sorted = [...folders, ...links];

        // 順番通りに移動
        for (let i = 0; i < sorted.length; i++) {
          await chrome.bookmarks.move(sorted[i].id, { parentId, index: i });
        }
        sendResponse({ success: true });
      })
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  if (message.type === "MRBB_OPEN_ALL_IN_TABS") {
    const folderId = message.folderId;
    chrome.bookmarks
      .getChildren(folderId)
      .then(async (children) => {
        const urls = children.filter((c) => c.url).map((c) => c.url!);
        for (const url of urls) {
          await chrome.tabs.create({ url, active: false });
        }
        sendResponse({ success: true, count: urls.length });
      })
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  if (message.type === "MRBB_OPEN_TAB") {
    chrome.tabs
      .create({ url: message.url })
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }
});

// ブックマーク変更時: 全タブに再描画メッセージを送信
function notifyAllTabs(): void {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id && tab.url && !tab.url.startsWith("chrome://")) {
        chrome.tabs.sendMessage(tab.id, { type: "MRBB_REFRESH" }).catch(() => {});
      }
    }
  });
}

chrome.bookmarks.onCreated.addListener(notifyAllTabs);
chrome.bookmarks.onRemoved.addListener(notifyAllTabs);
chrome.bookmarks.onChanged.addListener(notifyAllTabs);
chrome.bookmarks.onMoved.addListener(notifyAllTabs);
