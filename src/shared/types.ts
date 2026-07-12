/** ブックマークアイテムの表示用データ */
export interface BookmarkDisplayItem {
  id: string;
  title: string;
  url?: string;
  isFolder: boolean;
  children?: BookmarkDisplayItem[];
  faviconUrl: string;
}

/** 各アイテムの計算済みレイアウト */
export interface LayoutItem {
  bookmark: BookmarkDisplayItem;
  width: number;
  row: number;
}

/** ユーザー設定 */
export interface Settings {
  enabled: boolean;
  maxRows: number;           // 0 = 無制限
  displayMode: "both" | "icon_only" | "text_only";
  folderOpenMode: "hover" | "click";
  showCondition: "always" | "new_tab_only";
  fontSize: number;          // px (default 12)
  barHeight: number;         // px (default 34)
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  maxRows: 0,
  displayMode: "both",
  folderOpenMode: "hover",
  showCondition: "always",
  fontSize: 12,
  barHeight: 34,
};
