import { FOLDER_ICON_SVG, LINK_ICON_SVG, faviconUrl } from "../shared/constants";
import type { BookmarkDisplayItem, Settings } from "../shared/types";

/**
 * 個別ブックマークアイテムのDOM要素を生成
 */
export function createBookmarkElement(
  item: BookmarkDisplayItem,
  displayMode: Settings["displayMode"]
): HTMLElement {
  const el = document.createElement("a");
  el.className = "mrbb-item";
  el.dataset.bmId = item.id;
  el.draggable = true;
  // dragstart はコンテナ側 (drag-drop.ts initDragDrop) で一括処理
  // アイテム個別のdragstartリスナーは不要（重複するとドラッグが壊れる）

  if (item.isFolder) {
    el.classList.add("mrbb-folder");
    el.href = "#";
    el.addEventListener("click", (e) => e.preventDefault());
  } else {
    el.classList.add("mrbb-link");
    el.href = item.url || "#";
    el.addEventListener("click", (e) => {
      // 中クリックやCtrl+クリックはブラウザに任せる
      if (e.ctrlKey || e.metaKey || e.button === 1) return;
    });
  }

  // ファビコン / フォルダアイコン
  if (displayMode !== "text_only") {
    const icon = document.createElement("img");
    icon.className = "mrbb-favicon";
    icon.width = 16;
    icon.height = 16;

    if (item.isFolder) {
      icon.src = FOLDER_ICON_SVG;
    } else if (item.url) {
      icon.src = faviconUrl(item.url);
      icon.onerror = () => {
        icon.src = LINK_ICON_SVG;
      };
    } else {
      icon.src = LINK_ICON_SVG;
    }

    el.appendChild(icon);
  }

  // テキスト
  if (displayMode !== "icon_only") {
    const span = document.createElement("span");
    span.className = "mrbb-title";
    span.textContent = item.title || (item.isFolder ? "フォルダ" : "");
    el.appendChild(span);
  }

  return el;
}
