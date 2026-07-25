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
  // 新しいタブを開いた直後はアドレスバーにフォーカスがある（document.hasFocus() が
  // false）。そこで focus() するとアドレスバーへの入力・確定が横取りされて
  // 最初の検索がキャンセルされるため、ページ側にフォーカスがある時だけ移す
  if (document.hasFocus()) q.focus();

  // 初回のみ: Chrome が出す「変更を保持 / 元に戻す」確認バブルの説明カードを表示。
  // バブル自体は Chrome の機能で拡張からは消せないため、選び方をその場で案内する
  try {
    const NOTICE_KEY = "mrbb-ntp-notice-done";
    const local = await chrome.storage.local.get(NOTICE_KEY);
    if (!local[NOTICE_KEY]) {
      document.getElementById("notice-text").textContent = t("ntpNotice");
      document.getElementById("notice").classList.add("show");
      document.getElementById("notice-ok").addEventListener("click", async () => {
        document.getElementById("notice").classList.remove("show");
        await chrome.storage.local.set({ [NOTICE_KEY]: true });
      });
    }
  } catch (e) { /* storage が使えない環境では案内なしで続行 */ }
})();
