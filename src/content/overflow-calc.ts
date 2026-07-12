import {
  BAR_MARGIN_X,
  FAVICON_SIZE,
  ITEM_GAP,
  ITEM_PADDING_X,
  TEXT_MAX_WIDTH,
} from "../shared/constants";
import type { BookmarkDisplayItem, LayoutItem, Settings } from "../shared/types";

/** テキスト幅計測用の隠しCanvas */
let measureCanvas: HTMLCanvasElement | null = null;

function getTextWidth(text: string, fontSize: number): number {
  if (!measureCanvas) {
    measureCanvas = document.createElement("canvas");
  }
  const ctx = measureCanvas.getContext("2d")!;
  ctx.font = `${fontSize}px "Segoe UI", system-ui, -apple-system, sans-serif`;
  return Math.min(ctx.measureText(text).width, TEXT_MAX_WIDTH);
}

/** 拡張バー（row 1+）のアイテム幅を計算 — padding 8px */
export function calcItemWidth(
  item: BookmarkDisplayItem,
  displayMode: Settings["displayMode"],
  fontSize: number = 12
): number {
  let w = ITEM_PADDING_X * 2; // 左右パディング 8px * 2

  if (displayMode !== "text_only") {
    w += FAVICON_SIZE; // アイコン 16px
  }

  if (displayMode !== "icon_only" && item.title) {
    if (displayMode !== "text_only") w += 6; // アイコンとテキストの間
    w += getTextWidth(item.title, fontSize);
  }

  return Math.ceil(w);
}

/**
 * Chrome ネイティブバー（row 0）のアイテム幅を推定
 * Chrome は拡張より狭いパディング（~4px）を使用
 * Canvas測定とChromeレンダリングの差を吸収するため +2px バッファ
 */
function calcNativeItemWidth(
  item: BookmarkDisplayItem,
  fontSize: number = 12
): number {
  const NATIVE_PADDING = 4;
  const NATIVE_ICON_GAP = 4;
  const BUFFER = 2; // Chrome内部レンダリングとの差吸収
  let w = NATIVE_PADDING * 2;

  w += FAVICON_SIZE; // 常にアイコンあり

  if (item.title) {
    w += NATIVE_ICON_GAP;
    w += getTextWidth(item.title, fontSize);
  }

  return Math.ceil(w) + BUFFER;
}

/**
 * Chrome ネイティブバーの使用可能幅を推定
 * 左: アプリアイコン + マージン (~40px)
 * 右: >> シェブロン (~28px) + 拡張アイコン群 + プロフィール + メニュー
 * 右側は拡張アイコンの数で変動するため、ウィンドウ幅の12%をマージンとして取る（最低200px）
 */
function calcNativeBarWidth(windowWidth: number): number {
  const leftMargin = 40;
  // 右側マージン: ウィンドウ幅の12%（最低200px、最大350px）
  const rightMargin = Math.min(350, Math.max(200, Math.floor(windowWidth * 0.12)));
  return windowWidth - leftMargin - rightMargin;
}

/**
 * 全ブックマークを行に割り振る。
 * row 0 はChrome標準バーに合わせた幅計算、row 1+ は拡張バー用。
 */
export function calcLayout(
  bookmarks: BookmarkDisplayItem[],
  availableWidth: number,
  settings: Settings
): LayoutItem[] {
  const result: LayoutItem[] = [];
  if (bookmarks.length === 0) return result;

  const fontSize = settings.fontSize || 12;
  const gearWidth = 24; // ギアアイコン分
  const searchWidth = 24; // 検索アイコン分

  const nativeBarWidth = calcNativeBarWidth(availableWidth);

  // Row 1+ (拡張バー): 通常のマージン
  const usableWidth = availableWidth - BAR_MARGIN_X * 2;

  let currentRow = 0;
  let rowUsed = 0;

  for (let i = 0; i < bookmarks.length; i++) {
    const bm = bookmarks[i];

    // row 0 はネイティブバー幅計算、row 1+ は拡張バー幅計算
    const w = currentRow === 0
      ? calcNativeItemWidth(bm, fontSize) + ITEM_GAP
      : calcItemWidth(bm, settings.displayMode, fontSize) + ITEM_GAP;

    // row 0 はネイティブバー幅、row 1 はギア+検索アイコン分差し引き、row 2+ はフル幅
    let effectiveWidth: number;
    if (currentRow === 0) {
      effectiveWidth = nativeBarWidth;
    } else if (currentRow === 1) {
      effectiveWidth = usableWidth - gearWidth - searchWidth;
    } else {
      effectiveWidth = usableWidth;
    }

    if (rowUsed + w > effectiveWidth && rowUsed > 0) {
      currentRow++;
      rowUsed = 0;
      // maxRows制限チェック (0 = 無制限)
      if (settings.maxRows > 0 && currentRow >= settings.maxRows) break;

      // 行が変わったので、このアイテムの幅を再計算（row 0→1 で計算方式が変わる）
      const wNew = currentRow === 0
        ? calcNativeItemWidth(bm, fontSize) + ITEM_GAP
        : calcItemWidth(bm, settings.displayMode, fontSize) + ITEM_GAP;

      result.push({ bookmark: bm, width: wNew - ITEM_GAP, row: currentRow });
      rowUsed += wNew;
      continue;
    }

    result.push({ bookmark: bm, width: w - ITEM_GAP, row: currentRow });
    rowUsed += w;
  }

  return result;
}
