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
    language: "auto",
  };
  const $ = (id) => document.getElementById(id);
  // chrome.* が無い環境（file:// で開いた場合など）でも表示だけはできるようにする
  const hasChrome = typeof chrome !== "undefined" && !!chrome.storage;

  // ===== ナビゲーション =====
  function showNav(nav) {
    const valid = ["howto", "settings", "contact"];
    if (!valid.includes(nav)) nav = "howto";
    document.querySelectorAll(".nav-item").forEach((el) => {
      el.classList.toggle("active", el.dataset.nav === nav);
    });
    document.querySelectorAll(".panel").forEach((el) => {
      el.classList.toggle("active", el.id === "sec-" + nav);
    });
    const url = new URL(location.href);
    url.searchParams.set("nav", nav);
    history.replaceState(null, "", url);
  }

  // ===== 言語 =====
  // 設定が "auto" ならブラウザ UI 言語に従う。プロース（.l-ja/.l-en）と
  // フォームラベル（data-i18n）の両方をこの言語で揃える
  function resolveLang(setting) {
    if (setting === "ja" || setting === "en") return setting;
    const ui = hasChrome && chrome.i18n ? chrome.i18n.getUILanguage() : navigator.language || "en";
    return ui.toLowerCase().startsWith("ja") ? "ja" : "en";
  }

  let dict = null;
  async function loadDict(lang) {
    if (!hasChrome) { dict = null; return; }
    try {
      dict = await (await fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`))).json();
    } catch (e) { dict = null; }
  }
  function localize() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n;
      const m = dict?.[key]?.message || (hasChrome && chrome.i18n ? chrome.i18n.getMessage(key) : "");
      if (m) el.textContent = m;
    });
  }

  async function applyLanguage(setting) {
    const lang = resolveLang(setting);
    document.documentElement.dataset.lang = lang;
    document.documentElement.lang = lang;
    await loadDict(lang);
    localize();
  }

  // ===== 設定の読み書き =====
  async function load() {
    if (!hasChrome) return DEFAULT_SETTINGS;
    const data = await chrome.storage.sync.get(STORAGE_KEY);
    const s = { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEY] ?? {}) };
    $("enabled").checked = s.enabled;
    $("fontSize").value = String(s.fontSize || 12);
    $("barHeight").value = String(s.barHeight || 36);
    $("maxRows").value = String(s.maxRows);
    $("boundaryOffset").value = String(s.boundaryOffsetPx || 0);
    $("barMode").value = s.barMode;
    $("displayBehavior").value = s.displayBehavior || "autohide";
    $("revealEdgePx").value = String(s.revealEdgePx ?? 2);
    $("revealDelayMs").value = String(s.revealDelayMs ?? 0);
    $("autohideDelayMs").value = String(s.autohideDelayMs ?? 400);
    $("hideOnClick").checked = s.hideOnClick !== false;
    $("hideOnOutsideClick").checked = s.hideOnOutsideClick !== false;
    $("ntpMode").value = s.ntpMode || "custom";
    $("language").value = s.language || "auto";
    $("displayMode").value = s.displayMode;
    $("folderOpenMode").value = s.folderOpenMode;
    $("hoverCloseMs").value = String(s.hoverCloseMs || 400);
    $("showCondition").value = s.showCondition;
    return s;
  }

  async function save() {
    if (!hasChrome) return;
    const s = {
      enabled: $("enabled").checked,
      fontSize: parseInt($("fontSize").value, 10) || 12,
      barHeight: parseInt($("barHeight").value, 10) || 36,
      maxRows: parseInt($("maxRows").value, 10) || 0,
      boundaryOffset: 0,
      boundaryOffsetPx: Math.max(-600, Math.min(600, parseInt($("boundaryOffset").value, 10) || 0)),
      barMode: $("barMode").value,
      displayBehavior: $("displayBehavior").value,
      revealEdgePx: Math.max(1, Math.min(50, parseInt($("revealEdgePx").value, 10) || 2)),
      revealDelayMs: Math.max(0, Math.min(1000, parseInt($("revealDelayMs").value, 10) || 0)),
      autohideDelayMs: Math.max(100, Math.min(5000, parseInt($("autohideDelayMs").value, 10) || 400)),
      hideOnClick: $("hideOnClick").checked,
      hideOnOutsideClick: $("hideOnOutsideClick").checked,
      ntpMode: $("ntpMode").value,
      language: $("language").value,
      displayMode: $("displayMode").value,
      folderOpenMode: $("folderOpenMode").value,
      hoverCloseMs: Math.max(100, Math.min(2000, parseInt($("hoverCloseMs").value, 10) || 400)),
      showCondition: $("showCondition").value,
    };
    await chrome.storage.sync.set({ [STORAGE_KEY]: s });
  }

  async function init() {
    const verEl = $("ver");
    if (verEl) verEl.textContent = hasChrome && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : "";

    document.querySelectorAll(".nav-item").forEach((el) => {
      el.addEventListener("click", () => showNav(el.dataset.nav));
    });
    showNav(new URLSearchParams(location.search).get("nav") || "howto");

    const s = await load();
    await applyLanguage(s.language || "auto");

    document.querySelectorAll("#sec-settings input, #sec-settings select").forEach((el) => {
      el.addEventListener("change", save);
      el.addEventListener("input", save);
    });
    $("language").addEventListener("change", () => applyLanguage($("language").value));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
