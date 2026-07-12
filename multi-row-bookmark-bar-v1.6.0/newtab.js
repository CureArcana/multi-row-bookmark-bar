// 新しいタブページ（切替式）
// ntpMode = "custom": このページ（Google検索 + 多段バー）を表示
// ntpMode = "default": Chrome 標準の新しいタブへ即転送
(async function () {
  "use strict";
  const STORAGE_KEY = "mrbb-settings";
  const data = await chrome.storage.sync.get(STORAGE_KEY).catch(() => ({}));
  const s = data[STORAGE_KEY] || {};

  if (s.ntpMode === "default") {
    const tab = await chrome.tabs.getCurrent();
    if (tab) {
      await chrome.tabs.update(tab.id, { url: "chrome://new-tab-page/" });
      return; // body は hidden のまま（チラつき防止）
    }
  }

  const q = document.getElementById("q");
  const msg = chrome.i18n.getMessage("searchGoogle");
  if (msg) q.placeholder = msg;
  document.title = chrome.i18n.getMessage("newTabTitle") || "New Tab";
  document.body.classList.add("ready");
  q.focus();
})();
