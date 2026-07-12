/** ブックマークバーフォルダのID（Chrome固定値） */
export const BOOKMARK_BAR_ID = "1";

/** バー1段の高さ (px) */
export const BAR_HEIGHT = 34;

/** ファビコンサイズ (px) */
export const FAVICON_SIZE = 16;

/** アイテム左右パディング (px) */
export const ITEM_PADDING_X = 8;

/** アイテム上下パディング (px) */
export const ITEM_PADDING_Y = 4;

/** アイテム間マージン (px) */
export const ITEM_GAP = 0;

/** テキスト最大幅 (px) */
export const TEXT_MAX_WIDTH = 150;

/** テキストフォントサイズ (px) */
export const TEXT_FONT_SIZE = 12;

/** テキストフォントファミリー */
export const TEXT_FONT = `${TEXT_FONT_SIZE}px "Segoe UI", system-ui, -apple-system, sans-serif`;

/** バー左右マージン (px) */
export const BAR_MARGIN_X = 8;

/**
 * ファビコン取得URL
 * Google 公開 favicon サービスを使用
 * chrome://favicon は Content Script からアクセスできないため
 */
export const faviconUrl = (pageUrl: string): string => {
  try {
    const u = new URL(pageUrl);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=32`;
  } catch {
    return "";
  }
};

/** フォルダアイコンSVG — Chrome純正と同じ黄色フォルダ形状 */
export const FOLDER_ICON_SVG = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">' +
  '<path fill="#F0B400" d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25V4.75A1.75 1.75 0 0 0 14.25 3H8L6.56 1.22A.75.75 0 0 0 6 1H1.75z"/>' +
  '<path fill="#F9D648" d="M0 5.5h16v7.75A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25V5.5z"/>' +
  '</svg>'
)}`;

/** リンクアイコンSVG（ファビコン取得失敗時のフォールバック） */
export const LINK_ICON_SVG = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#e8eaed" stroke="#9aa0a6" stroke-width="1"/><path fill="#5f6368" d="M5 8a3 3 0 0 1 3-3h1v1.5H8a1.5 1.5 0 0 0 0 3h1V11H8a3 3 0 0 1-3-3zm2-.25h2v.5H7v-.5zM8 5h1a3 3 0 0 1 0 6H8V9.5h1a1.5 1.5 0 0 0 0-3H8V5z"/></svg>'
)}`;

/** 拡張のルートDOM要素ID */
export const ROOT_ID = "mrbb-root";

/** Shadow DOM ホスト要素ID */
export const HOST_ID = "mrbb-host";

/** ドロップダウンのDOM要素ID prefix */
export const DROPDOWN_PREFIX = "mrbb-dropdown-";

/** storage key */
export const STORAGE_KEY = "mrbb-settings";
