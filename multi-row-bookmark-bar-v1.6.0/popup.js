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
  };
  const $ = (id) => document.getElementById(id);

  async function load() {
    const data = await chrome.storage.sync.get(STORAGE_KEY);
    const s = { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEY] ?? {}) };
    $("enabled").checked = s.enabled;
    $("fontSize").value = String(s.fontSize || 12);
    $("barHeight").value = String(s.barHeight || 36);
    $("maxRows").value = String(s.maxRows);
    $("boundaryOffset").value = String(s.boundaryOffset || 0);
    $("barMode").value = s.barMode;
    $("displayMode").value = s.displayMode;
    $("folderOpenMode").value = s.folderOpenMode;
    $("showCondition").value = s.showCondition;
  }

  async function save() {
    const s = {
      enabled: $("enabled").checked,
      fontSize: parseInt($("fontSize").value, 10) || 12,
      barHeight: parseInt($("barHeight").value, 10) || 36,
      maxRows: parseInt($("maxRows").value, 10) || 0,
      boundaryOffset: Math.max(-5, Math.min(5, parseInt($("boundaryOffset").value, 10) || 0)),
      barMode: $("barMode").value,
      displayMode: $("displayMode").value,
      folderOpenMode: $("folderOpenMode").value,
      showCondition: $("showCondition").value,
    };
    await chrome.storage.sync.set({ [STORAGE_KEY]: s });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    await load();
    document.querySelectorAll("input, select").forEach((el) => {
      el.addEventListener("change", save);
      el.addEventListener("input", save);
    });
  });
})();
