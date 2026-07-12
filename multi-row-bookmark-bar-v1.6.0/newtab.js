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

  // language 設定が "auto" 以外なら該当ロケール辞書を優先
  let dict = null;
  if (s.language && s.language !== "auto") {
    try {
      dict = await (await fetch(chrome.runtime.getURL(`_locales/${s.language}/messages.json`))).json();
    } catch (e) { dict = null; }
  }
  const t = (k) => dict?.[k]?.message || chrome.i18n.getMessage(k) || "";

  const q = document.getElementById("q");
  q.placeholder = t("searchGoogle") || "Search Google";
  document.title = t("newTabTitle") || "New Tab";
  document.body.classList.add("ready");
  q.focus();
})();
