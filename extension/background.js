(function () {
  "use strict";

  const STORAGE_KEY = "mrbb-settings";
  // ショートカット割当は設定と別キーで保存する
  // （設定ページの save() は既知フィールドだけで上書きするため、混ぜると消える）
  const SHORTCUTS_KEY = "mrbb-shortcuts";
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
    barColor: "",
    displayBehavior: "autohide",
    revealEdgePx: 2,
    revealDelayMs: 0,
    autohideDelayMs: 400,
    hideOnClick: true,
    hideOnOutsideClick: true,
    ntpMode: "custom",
    language: "auto",
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
      // 初回インストール時のみ使い方ページを開く（アップデート時は開かない）
      chrome.tabs.create({ url: chrome.runtime.getURL("howto.html") });
    }
  });

  // ツールバーのアイコンクリックで使い方/設定ページを開く
  // （manifest に default_popup が無い場合のみ onClicked が発火する）
  chrome.action.onClicked.addListener(() => {
    chrome.tabs.create({ url: chrome.runtime.getURL("howto.html") });
  });

  // 拡張バーからのドラッグ中情報。ネイティブバーにドロップされると Chrome が
  // 「新規ブックマーク作成」として複製を作るので、それを検知して複製を消し、
  // 元をその位置へ「移動」する。
  // MV3 のサービスワーカーはいつでも停止・再起動されるため、メモリ変数ではなく
  // chrome.storage.session に保存する（メモリだとドロップ時に消えていて
  // 入れ替えが走らず、壊れたブックマークがそのまま残る）
  const PENDING_DRAG_KEY = "mrbb-pending-drag"; // { id, url?, isFolder?, expires }
  async function getPendingDrag() {
    const d = await chrome.storage.session.get(PENDING_DRAG_KEY).catch(() => ({}));
    return d[PENDING_DRAG_KEY] || null;
  }
  function setPendingDrag(v) {
    if (v) return chrome.storage.session.set({ [PENDING_DRAG_KEY]: v }).catch(() => {});
    return chrome.storage.session.remove(PENDING_DRAG_KEY).catch(() => {});
  }

  chrome.bookmarks.onCreated.addListener(async (id, node) => {
    const pd = await getPendingDrag();
    if (!pd || Date.now() >= pd.expires || id === pd.id) return;
    const isUrlCopy = pd.url && node.url === pd.url;
    const isFolderStub = pd.isFolder && node.url && node.parentId === "1";
    if (!isUrlCopy && !isFolderStub) return;
    await setPendingDrag(null);
    // 複製の方を消して元を移動する（複製を残して元を消すと ID が変わり、
    // ショートカットキー割当が古い ID を指したままになる）
    const dest = { parentId: node.parentId || "1", index: node.index };
    await chrome.bookmarks.remove(id).catch(() => {});
    await chrome.bookmarks.move(pd.id, dest).catch(() => {});
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "MRBB_DRAG_START") {
      const pd = msg.url
        ? { id: msg.id, url: msg.url, expires: Date.now() + 60000 }
        : { id: msg.id, isFolder: true, expires: Date.now() + 60000 };
      setPendingDrag(pd); // 書き込み完了はドロップ（数百ms後）より十分早い
      sendResponse({ success: true });
      return false;
    }

    if (msg.type === "MRBB_DRAG_END") {
      // ネイティブバーへのドロップは dragend より先に onCreated が来るが、
      // 念のため少し猶予を持たせてから破棄する
      setTimeout(() => { setPendingDrag(null); }, 1500);
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

    if (msg.type === "MRBB_SHORTCUTS_INFO") {
      // スロット割当と、各コマンドに現在バインドされているキーを返す
      (async () => {
        const data = await chrome.storage.sync.get(SHORTCUTS_KEY);
        const commands = chrome.commands ? await chrome.commands.getAll() : [];
        const keys = {};
        for (const c of commands) if (c.name) keys[c.name] = c.shortcut || "";
        sendResponse({ slots: data[SHORTCUTS_KEY] || {}, keys });
      })().catch(() => sendResponse({ slots: {}, keys: {} }));
      return true;
    }

    if (msg.type === "MRBB_SHORTCUT_SET") {
      // bookmark を渡すと割当（同じブックマークの既存割当は自動で外す）、null で解除
      (async () => {
        const data = await chrome.storage.sync.get(SHORTCUTS_KEY);
        const slots = data[SHORTCUTS_KEY] || {};
        if (msg.bookmark) {
          for (const k of Object.keys(slots)) {
            if (slots[k] && slots[k].id === msg.bookmark.id) delete slots[k];
          }
          slots[String(msg.slot)] = msg.bookmark;
        } else {
          delete slots[String(msg.slot)];
        }
        await chrome.storage.sync.set({ [SHORTCUTS_KEY]: slots });
        sendResponse({ success: true });
      })().catch((err) => sendResponse({ success: false, error: String(err) }));
      return true;
    }

    if (msg.type === "MRBB_OPEN_SHORTCUTS_PAGE") {
      chrome.tabs
        .create({ url: "chrome://extensions/shortcuts" })
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
    // host_permissions 無しでは tab.url が見えないため URL では絞らず全タブへ送る。
    // content script がいないタブ（chrome:// 等）はエラーになるので握りつぶす
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id !== undefined) {
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
      if (command === "toggle-bar") {
        const data = await chrome.storage.sync.get(STORAGE_KEY);
        const settings = { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEY] ?? {}) };
        settings.enabled = !settings.enabled;
        await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
        return;
      }
      // Alt+1 等: 割り当てたブックマークを新しいタブで開く
      const m = command.match(/^open-bookmark-([1-9])$/);
      if (!m) return;
      const data = await chrome.storage.sync.get(SHORTCUTS_KEY);
      const slot = (data[SHORTCUTS_KEY] || {})[m[1]];
      if (!slot) return;
      let url = slot.url;
      if (slot.id) {
        try {
          const nodes = await chrome.bookmarks.get(slot.id);
          if (nodes && nodes[0] && nodes[0].url) url = nodes[0].url;
        } catch (e) { /* ブックマーク削除済み → 割当時に保存した URL で開く */ }
      }
      if (url) chrome.tabs.create({ url });
    });
  }
})();
