import { DROPDOWN_PREFIX, FOLDER_ICON_SVG, LINK_ICON_SVG, faviconUrl } from "../shared/constants";
import type { BookmarkDisplayItem } from "../shared/types";
import { initDropdownDragDrop, isDragging, setDraggedFromDropdown } from "./drag-drop";
import { attachDropdownContextMenu } from "./context-menu";

let activeDropdown: HTMLElement | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let activeAnchor: HTMLElement | null = null;
let hoverTracker: (() => void) | null = null;
let clickDismissHandler: ((e: MouseEvent) => void) | null = null;

/** すべてのドロップダウンを閉じる（ドラッグ中は閉じない） */
export function closeAllDropdowns(force: boolean = false): void {
  if (!force && isDragging()) return;

  if (clickDismissHandler) {
    document.removeEventListener("mousedown", clickDismissHandler, true);
    clickDismissHandler = null;
  }
  if (hoverTracker) {
    hoverTracker();
    hoverTracker = null;
  }
  if (activeDropdown) {
    activeDropdown.remove();
    activeDropdown = null;
  }
  activeAnchor = null;
  document.querySelectorAll(".mrbb-sub-dropdown").forEach((el) => el.remove());
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
}

/**
 * ホバー追跡システム — ドキュメントレベルの mousemove で
 * マウスが「アンカー or ドロップダウン」の上にいるかを判定。
 * どちらでもない状態が一定時間続いたら閉じる。
 */
function setupHoverTracking(
  anchorEl: HTMLElement,
  dropdown: HTMLElement,
  closeDelay: number = 500
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const isInsideSafe = (x: number, y: number): boolean => {
    // アンカーの判定（上下左右に8pxの余裕）
    const ar = anchorEl.getBoundingClientRect();
    const inAnchor =
      x >= ar.left - 8 && x <= ar.right + 8 &&
      y >= ar.top - 4 && y <= ar.bottom + 4;
    if (inAnchor) return true;

    // ドロップダウンの判定（上方向に12px余裕を持たせてギャップをカバー）
    const dr = dropdown.getBoundingClientRect();
    const inDropdown =
      x >= dr.left - 4 && x <= dr.right + 4 &&
      y >= dr.top - 12 && y <= dr.bottom + 4;
    if (inDropdown) return true;

    // アンカーとドロップダウンの間の「三角形」ゾーン
    // アンカー下端からドロップダウン上端までの縦方向の隙間をカバー
    if (y >= ar.bottom - 4 && y <= dr.top + 8) {
      const leftBound = Math.min(ar.left, dr.left) - 8;
      const rightBound = Math.max(ar.right, dr.right) + 8;
      if (x >= leftBound && x <= rightBound) return true;
    }

    // サブドロップダウンも考慮
    const subs = document.querySelectorAll(".mrbb-sub-dropdown");
    for (const sub of subs) {
      const sr = sub.getBoundingClientRect();
      if (x >= sr.left - 4 && x <= sr.right + 4 &&
          y >= sr.top - 4 && y <= sr.bottom + 4) {
        return true;
      }
    }

    return false;
  };

  const onMove = (e: MouseEvent) => {
    if (isDragging()) {
      // ドラッグ中は閉じない
      if (timer) { clearTimeout(timer); timer = null; }
      return;
    }
    if (isInsideSafe(e.clientX, e.clientY)) {
      if (timer) { clearTimeout(timer); timer = null; }
    } else {
      if (!timer) {
        timer = setTimeout(() => closeAllDropdowns(true), closeDelay);
      }
    }
  };

  document.addEventListener("mousemove", onMove, true);

  // ドラッグイベントでもタイマーキャンセル
  const onDrag = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };
  dropdown.addEventListener("dragenter", onDrag);
  dropdown.addEventListener("dragover", onDrag);

  // クリーンアップ関数
  return () => {
    document.removeEventListener("mousemove", onMove, true);
    dropdown.removeEventListener("dragenter", onDrag);
    dropdown.removeEventListener("dragover", onDrag);
    if (timer) { clearTimeout(timer); timer = null; }
  };
}

/** ドロップダウンメニューを生成・表示 */
export function showFolderDropdown(
  folder: BookmarkDisplayItem,
  anchorEl: HTMLElement,
  mode: "hover" | "click"
): void {
  // clickモード: 同じフォルダを再クリックしたらトグルで閉じる
  if (mode === "click" && activeAnchor === anchorEl && activeDropdown) {
    closeAllDropdowns(true);
    return;
  }

  closeAllDropdowns(true);

  const dropdown = document.createElement("div");
  dropdown.className = "mrbb-dropdown";
  dropdown.id = `${DROPDOWN_PREFIX}${folder.id}`;

  if (!folder.children || folder.children.length === 0) {
    const empty = document.createElement("div");
    empty.className = "mrbb-dropdown-empty";
    empty.textContent = "(empty)";
    dropdown.appendChild(empty);
  } else {
    for (const child of folder.children) {
      const row = createDropdownRow(child, folder.id);
      dropdown.appendChild(row);
    }
  }

  // D&D対応
  initDropdownDragDrop(dropdown, folder.id);

  // 位置計算 — アンカーと4px重ねて物理的ギャップを消す
  const rect = anchorEl.getBoundingClientRect();
  dropdown.style.setProperty("position", "fixed", "important");
  dropdown.style.setProperty("top", `${rect.bottom - 4}px`, "important");
  dropdown.style.setProperty("left", `${rect.left}px`, "important");
  dropdown.style.setProperty("z-index", "2147483647", "important");
  dropdown.style.setProperty("padding-top", "4px", "important");

  document.body.appendChild(dropdown);
  activeDropdown = dropdown;
  activeAnchor = anchorEl;

  // 画面外補正（右端・下端）
  const ddRect = dropdown.getBoundingClientRect();
  if (ddRect.right > window.innerWidth) {
    dropdown.style.setProperty("left", `${window.innerWidth - ddRect.width - 4}px`, "important");
  }
  if (ddRect.bottom > window.innerHeight) {
    const newTop = Math.max(4, window.innerHeight - ddRect.height - 4);
    dropdown.style.setProperty("top", `${newTop}px`, "important");
  }

  // hover モード — ドキュメントレベルのマウス追跡で確実に制御
  if (mode === "hover") {
    hoverTracker = setupHoverTracking(anchorEl, dropdown, 400);
  }

  // click モード — ドロップダウン外クリックで閉じる
  if (mode === "click") {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      // ドロップダウン内 or アンカー内のクリックは無視（アンカーはトグル処理が担当）
      if (dropdown.contains(target) || anchorEl.contains(target)) return;
      // サブドロップダウン内のクリックも無視
      const subs = document.querySelectorAll(".mrbb-sub-dropdown");
      for (const sub of subs) {
        if (sub.contains(target)) return;
      }
      closeAllDropdowns(true);
    };
    // 次フレームで登録（現在のクリックイベントの伝播完了後）
    setTimeout(() => {
      document.addEventListener("mousedown", handler, true);
      clickDismissHandler = handler;
    }, 0);
  }
}

/** ドロップダウン内の1行を生成 */
function createDropdownRow(item: BookmarkDisplayItem, parentFolderId: string): HTMLElement {
  const row = document.createElement("a");
  row.className = "mrbb-dropdown-row";
  row.dataset.bmId = item.id;
  row.draggable = true;

  // ドラッグ開始 — グローバルのdraggedIdを設定
  row.addEventListener("dragstart", (e) => {
    e.stopPropagation();
    setDraggedFromDropdown(item.id);
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/plain", item.id);
  });

  if (item.isFolder) {
    row.classList.add("mrbb-dropdown-folder");
    row.href = "#";
    row.addEventListener("click", (e) => e.preventDefault());

    let subCleanup: (() => void) | null = null;

    row.addEventListener("mouseenter", () => {
      if (isDragging()) return;

      // 既存のサブドロップダウンを削除
      document.querySelectorAll(".mrbb-sub-dropdown").forEach((el) => el.remove());
      if (subCleanup) { subCleanup(); subCleanup = null; }

      const sub = document.createElement("div");
      sub.className = "mrbb-dropdown mrbb-sub-dropdown";

      if (!item.children || item.children.length === 0) {
        const empty = document.createElement("div");
        empty.className = "mrbb-dropdown-empty";
        empty.textContent = "(empty)";
        sub.appendChild(empty);
      } else {
        for (const child of item.children) {
          sub.appendChild(createDropdownRow(child, item.id));
        }
      }

      initDropdownDragDrop(sub, item.id);

      // サブドロップダウンも親行と少し重ねる
      const rowRect = row.getBoundingClientRect();
      sub.style.setProperty("position", "fixed", "important");
      sub.style.setProperty("top", `${rowRect.top}px`, "important");
      sub.style.setProperty("left", `${rowRect.right - 4}px`, "important");
      sub.style.setProperty("padding-left", "4px", "important");
      sub.style.setProperty("z-index", "2147483647", "important");

      document.body.appendChild(sub);

      const subRect = sub.getBoundingClientRect();
      if (subRect.right > window.innerWidth) {
        sub.style.setProperty("left", `${rowRect.left - subRect.width + 4}px`, "important");
        sub.style.setProperty("padding-left", "0", "important");
        sub.style.setProperty("padding-right", "4px", "important");
      }
      if (subRect.bottom > window.innerHeight) {
        const newTop = Math.max(4, window.innerHeight - subRect.height - 4);
        sub.style.setProperty("top", `${newTop}px`, "important");
      }

      // サブドロップダウン用のマウス追跡
      let subTimer: ReturnType<typeof setTimeout> | null = null;

      const checkSubHover = (e: MouseEvent) => {
        if (isDragging()) {
          if (subTimer) { clearTimeout(subTimer); subTimer = null; }
          return;
        }
        const rr = row.getBoundingClientRect();
        const sr = sub.getBoundingClientRect();
        const inRow = e.clientX >= rr.left - 4 && e.clientX <= rr.right + 4 &&
                      e.clientY >= rr.top - 4 && e.clientY <= rr.bottom + 4;
        const inSub = e.clientX >= sr.left - 8 && e.clientX <= sr.right + 4 &&
                      e.clientY >= sr.top - 4 && e.clientY <= sr.bottom + 4;
        // 行とサブの間のゾーン
        const inBetween = e.clientY >= Math.min(rr.top, sr.top) - 4 &&
                          e.clientY <= Math.max(rr.bottom, sr.bottom) + 4 &&
                          e.clientX >= rr.right - 8 && e.clientX <= sr.left + 8;

        if (inRow || inSub || inBetween) {
          if (subTimer) { clearTimeout(subTimer); subTimer = null; }
        } else {
          if (!subTimer) {
            subTimer = setTimeout(() => {
              sub.remove();
              document.removeEventListener("mousemove", checkSubHover, true);
            }, 300);
          }
        }
      };

      document.addEventListener("mousemove", checkSubHover, true);
      subCleanup = () => {
        document.removeEventListener("mousemove", checkSubHover, true);
        if (subTimer) { clearTimeout(subTimer); subTimer = null; }
      };
    });
  } else {
    row.href = item.url || "#";
  }

  // 右クリックメニュー
  attachDropdownContextMenu(
    row,
    item.id,
    item.isFolder,
    item.title || "",
    item.url || "",
    parentFolderId
  );

  // アイコン
  const icon = document.createElement("img");
  icon.className = "mrbb-dropdown-icon";
  icon.width = 16;
  icon.height = 16;
  if (item.isFolder) {
    icon.src = FOLDER_ICON_SVG;
  } else {
    icon.src = item.url ? faviconUrl(item.url) : "";
    icon.onerror = () => { icon.src = LINK_ICON_SVG; };
  }
  row.appendChild(icon);

  // テキスト
  const text = document.createElement("span");
  text.className = "mrbb-dropdown-text";
  text.textContent = item.title || (item.url ?? "");
  row.appendChild(text);

  // フォルダには右矢印
  if (item.isFolder) {
    const arrow = document.createElement("span");
    arrow.className = "mrbb-dropdown-arrow";
    arrow.textContent = "\u25B6";
    row.appendChild(arrow);
  }

  return row;
}
