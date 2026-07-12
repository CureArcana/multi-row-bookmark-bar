import { STORAGE_KEY } from "../shared/constants";
import { DEFAULT_SETTINGS, type Settings } from "../shared/types";
import { render, updateSettings, getSettings } from "./bar-renderer";

/** 設定読み込み */
async function loadSettings(): Promise<Settings> {
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEY);
    return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEY] ?? {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** メイン初期化 */
async function init(): Promise<void> {
  const settings = await loadSettings();
  updateSettings(settings);

  // ウィンドウリサイズ時に再計算 (debounce 150ms)
  let resizeTimer: ReturnType<typeof setTimeout>;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => render(), 150);
  });

  // service worker からのリフレッシュメッセージを受信
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "MRBB_REFRESH") {
      render();
    }
  });

  // 設定変更を監視
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes[STORAGE_KEY]) {
      const newSettings = {
        ...DEFAULT_SETTINGS,
        ...(changes[STORAGE_KEY].newValue ?? {}),
      };
      updateSettings(newSettings);
    }
  });

  // キーボードショートカット: Ctrl+Shift+B で表示/非表示トグル
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === "B") {
      e.preventDefault();
      const current = getSettings();
      const toggled = { ...current, enabled: !current.enabled };
      chrome.storage.sync.set({ [STORAGE_KEY]: toggled });
    }
  });
}

// DOM準備完了後に初期化
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
