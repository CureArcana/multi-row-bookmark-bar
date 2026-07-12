(function () {
  "use strict";

  const STORAGE_KEY = "mrbb-settings";
  const DEFAULT_SETTINGS = {
    enabled: true,
    maxRows: 0,
    displayMode: "both",
    folderOpenMode: "hover",
    showCondition: "always",
    fontSize: 12,
    barHeight: 36,
    barMode: "overflow",
    boundaryOffset: 0,
    boundaryOffsetPx: 0,
    hoverCloseMs: 400,
    displayBehavior: "autohide",
    revealEdgePx: 2,
    revealDelayMs: 0,
    autohideDelayMs: 400,
    hideOnClick: true,
    hideOnOutsideClick: true,
    ntpMode: "custom",
  };

  function mapBookmark(node) {
    const isFolder = !node.url;
    return {
      id: node.id,
      title: node.title,
      url: node.url,
      isFolder: isFolder,
      children: isFolder ? (node.children ?? []).map(mapBookmark) : undefined,
      faviconUrl: "",
    };
  }

  async function fetchAllBookmarks() {
    const children = await chrome.bookmarks.getChildren("1");
    const result = [];
    for (const child of children) {
      if (child.url) {
        result.push(mapBookmark(child));
      } else {
        const subtree = await chrome.bookmarks.getSubTree(child.id);
        result.push(mapBookmark(subtree[0]));
      }
    }
    return result;
  }

  // Recursively collect all URLs in a folder
  async function collectFolderUrls(folderId) {
    const subtree = await chrome.bookmarks.getSubTree(folderId);
    const urls = [];
    function walk(node) {
      if (node.url) urls.push(node.url);
      if (node.children) node.children.forEach(walk);
    }
    walk(subtree[0]);
    return urls;
  }

  chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === "install") {
      const data = await chrome.storage.sync.get(STORAGE_KEY);
      if (!data[STORAGE_KEY]) {
        await chrome.storage.sync.set({ [STORAGE_KEY]: DEFAULT_SETTINGS });
      }
    }
  });

  // 拡張バーからのドラッグ中情報。ネイティブバーにドロップされると Chrome が
  // 「新規ブックマーク作成」として複製を作るので、それを検知して元を削除し
  // 「移動」の挙動にする
  let pendingDrag = null; // { id, url, expires }

  chrome.bookmarks.onCreated.addListener((id, node) => {
    if (
      pendingDrag &&
      Date.now() < pendingDrag.expires &&
      node.url === pendingDrag.url &&
      id !== pendingDrag.id
    ) {
      const originalId = pendingDrag.id;
      pendingDrag = null;
      chrome.bookmarks.remove(originalId).catch(() => {});
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "MRBB_DRAG_START") {
      pendingDrag = msg.url
        ? { id: msg.id, url: msg.url, expires: Date.now() + 60000 }
        : null;
      sendResponse({ success: true });
      return false;
    }

    if (msg.type === "MRBB_DRAG_END") {
      // ネイティブバーへのドロップは dragend より先に onCreated が来るが、
      // 念のため少し猶予を持たせてから破棄する
      setTimeout(() => { pendingDrag = null; }, 1500);
      sendResponse({ success: true });
      return false;
    }

    if (msg.type === "MRBB_EXTERNAL_DROP") {
      // ネイティブバー（や他フォルダ・ページ上のリンク）からのドロップ。
      // 同じ URL のブックマークが既に存在すれば move、無ければ create
      (async () => {
        const dest = { parentId: msg.destination.parentId || "1" };
        if (msg.destination.index !== undefined) dest.index = msg.destination.index;
        const results = await chrome.bookmarks.search({ url: msg.url }).catch(() => []);
        const exact = results.filter((r) => r.url === msg.url);
        const existing =
          exact.find((r) => r.parentId === "1") || exact[0];
        if (existing) {
          await chrome.bookmarks.move(existing.id, dest);
          sendResponse({ success: true, moved: existing.id });
        } else {
          const bm = await chrome.bookmarks.create({
            parentId: dest.parentId,
            index: dest.index,
            title: msg.title || msg.url,
            url: msg.url,
          });
          sendResponse({ success: true, created: bm.id });
        }
      })().catch((err) => sendResponse({ success: false, error: String(err) }));
      return true;
    }

    if (msg.type === "MRBB_GET_BOOKMARKS") {
      // hasOtherBookmarks: 「その他のブックマーク」が非空だとネイティブバー右端に
      // そのボタンが表示され、使用可能幅が狭くなる（overflow 計算に必要）
      // tabGroupTitles: 保存済みタブグループのチップはネイティブバー左側の幅を
      // 消費するため、開いているグループのタイトルを返して content 側で幅を見積もる
      const windowId = sender.tab ? sender.tab.windowId : undefined;
      const tabGroupsPromise =
        chrome.tabGroups && windowId !== undefined
          ? chrome.tabGroups.query({ windowId }).catch(() => [])
          : Promise.resolve([]);
      Promise.all([
        fetchAllBookmarks(),
        chrome.bookmarks.getChildren("2").catch(() => []),
        tabGroupsPromise,
      ])
        .then(([bookmarks, others, groups]) =>
          sendResponse({
            bookmarks,
            hasOtherBookmarks: others.length > 0,
            tabGroupTitles: groups.map((g) => g.title || ""),
          })
        )
        .catch((err) => sendResponse({ bookmarks: [], error: String(err) }));
      return true;
    }

    if (msg.type === "MRBB_MOVE_BOOKMARK") {
      chrome.bookmarks
        .move(msg.id, msg.destination)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: String(err) }));
      return true;
    }

    if (msg.type === "MRBB_DELETE_BOOKMARK") {
      const op = msg.isFolder
        ? chrome.bookmarks.removeTree(msg.id)
        : chrome.bookmarks.remove(msg.id);
      op.then(() => sendResponse({ success: true })).catch((err) =>
        sendResponse({ success: false, error: String(err) })
      );
      return true;
    }

    if (msg.type === "MRBB_CREATE_BOOKMARK") {
      chrome.bookmarks
        .create({
          parentId: msg.parentId || "1",
          title: msg.title,
          url: msg.url,
        })
        .then((bm) => sendResponse({ success: true, id: bm.id }))
        .catch((err) => sendResponse({ success: false, error: String(err) }));
      return true;
    }

    if (msg.type === "MRBB_CREATE_FOLDER") {
      chrome.bookmarks
        .create({ parentId: msg.parentId || "1", title: msg.title })
        .then((bm) => sendResponse({ success: true, id: bm.id }))
        .catch((err) => sendResponse({ success: false, error: String(err) }));
      return true;
    }

    if (msg.type === "MRBB_UPDATE_BOOKMARK") {
      chrome.bookmarks
        .update(msg.id, msg.changes)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: String(err) }));
      return true;
    }

    if (msg.type === "MRBB_OPEN_TAB") {
      chrome.tabs
        .create({ url: msg.url })
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: String(err) }));
      return true;
    }

    if (msg.type === "MRBB_OPEN_ALL_IN_TABS") {
      collectFolderUrls(msg.folderId)
        .then((urls) => {
          urls.forEach((url) => chrome.tabs.create({ url }));
          sendResponse({ success: true });
        })
        .catch((err) => sendResponse({ success: false, error: String(err) }));
      return true;
    }

    if (msg.type === "MRBB_SEARCH_BOOKMARKS") {
      chrome.bookmarks
        .search(msg.query)
        .then((results) => {
          const filtered = results
            .filter((r) => r.url)
            .slice(0, 20)
            .map((r) => ({ id: r.id, title: r.title, url: r.url }));
          sendResponse({ results: filtered });
        })
        .catch((err) => sendResponse({ results: [], error: String(err) }));
      return true;
    }

    if (msg.type === "MRBB_SORT_BOOKMARKS") {
      chrome.bookmarks.getChildren(msg.parentId).then(async (children) => {
        const sorted = [...children].sort((a, b) => {
          if (msg.sortBy === "title")
            return (a.title || "").localeCompare(b.title || "");
          if (msg.sortBy === "url")
            return (a.url || "").localeCompare(b.url || "");
          if (msg.sortBy === "dateAdded")
            return (a.dateAdded || 0) - (b.dateAdded || 0);
          return 0;
        });
        for (let i = 0; i < sorted.length; i++) {
          await chrome.bookmarks.move(sorted[i].id, {
            parentId: msg.parentId,
            index: i,
          });
        }
        sendResponse({ success: true });
      });
      return true;
    }
  });

  function notifyAllTabs() {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id && tab.url && !tab.url.startsWith("chrome://")) {
          chrome.tabs
            .sendMessage(tab.id, { type: "MRBB_REFRESH" })
            .catch(() => {});
        }
      }
    });
  }

  chrome.bookmarks.onCreated.addListener(notifyAllTabs);
  chrome.bookmarks.onRemoved.addListener(notifyAllTabs);
  chrome.bookmarks.onChanged.addListener(notifyAllTabs);
  chrome.bookmarks.onMoved.addListener(notifyAllTabs);

  // タブグループのチップはネイティブバーの幅を消費する → 増減・改名で境界を即再計算
  if (chrome.tabGroups) {
    chrome.tabGroups.onCreated.addListener(notifyAllTabs);
    chrome.tabGroups.onRemoved.addListener(notifyAllTabs);
    chrome.tabGroups.onUpdated.addListener(notifyAllTabs);
  }

  // Alt+Shift+B でバーの表示/非表示をトグル
  // （Ctrl+Shift+B は Chrome 本体のネイティブバー切替に取られるため使えない）
  if (chrome.commands) {
    chrome.commands.onCommand.addListener(async (command) => {
      if (command !== "toggle-bar") return;
      const data = await chrome.storage.sync.get(STORAGE_KEY);
      const settings = { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEY] ?? {}) };
      settings.enabled = !settings.enabled;
      await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
    });
  }
})();
