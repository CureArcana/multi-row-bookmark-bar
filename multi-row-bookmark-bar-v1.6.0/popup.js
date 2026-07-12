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
  const $ = (id) => document.getElementById(id);

  async function load() {
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
    $("displayMode").value = s.displayMode;
    $("folderOpenMode").value = s.folderOpenMode;
    $("hoverCloseMs").value = String(s.hoverCloseMs || 400);
    $("showCondition").value = s.showCondition;
  }

  async function save() {
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
      displayMode: $("displayMode").value,
      folderOpenMode: $("folderOpenMode").value,
      hoverCloseMs: Math.max(100, Math.min(2000, parseInt($("hoverCloseMs").value, 10) || 400)),
      showCondition: $("showCondition").value,
    };
    await chrome.storage.sync.set({ [STORAGE_KEY]: s });
  }

  function localize() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const m = chrome.i18n.getMessage(el.dataset.i18n);
      if (m) el.textContent = m;
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    localize();
    await load();
    document.querySelectorAll("input, select").forEach((el) => {
      el.addEventListener("change", save);
      el.addEventListener("input", save);
    });
  });
})();
