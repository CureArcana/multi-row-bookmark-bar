import { getBarContainer } from "./bar-renderer";

let draggedId: string | null = null;
let draggedEl: HTMLElement | null = null;
let indicator: HTMLElement | null = null;
let dropTargetInfo: { parentId: string; index?: number } | null = null;
let highlightedFolder: HTMLElement | null = null;
let dragGhost: HTMLElement | null = null;

/** 現在ドラッグ中かどうか */
export function isDragging(): boolean {
  return draggedId !== null;
}

/** ドロップダウン内のドラッグ開始用 — グローバルのdraggedIdを設定 */
export function setDraggedFromDropdown(id: string): void {
  draggedId = id;
}

/** D&D初期化: バーコンテナにイベントを付与 */
export function initDragDrop(container: HTMLElement): void {
  container.addEventListener("dragstart", onDragStart);
  container.addEventListener("dragover", onDragOver);
  container.addEventListener("dragend", onDragEnd);
  container.addEventListener("drop", onDrop);
}

/** ドロップダウン内にもD&Dを付与 */
export function initDropdownDragDrop(dropdown: HTMLElement, folderId: string): void {
  dropdown.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedId) return;
    e.dataTransfer!.dropEffect = "move";

    const rows = [...dropdown.querySelectorAll<HTMLElement>(".mrbb-dropdown-row")];
    const ind = ensureIndicator();

    let insertBefore: HTMLElement | null = null;
    let indicatorTop = 0;

    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;

      // フォルダ行の中央にドラッグしたらフォルダに入れるハイライト
      if (row.classList.contains("mrbb-dropdown-folder")) {
        const inFolderZone = e.clientY >= rect.top + rect.height * 0.25 && e.clientY <= rect.top + rect.height * 0.75;
        if (inFolderZone) {
          clearFolderHighlight();
          row.classList.add("mrbb-folder-drop-target");
          highlightedFolder = row;
          const subFolderId = row.dataset.bmId;
          if (subFolderId) {
            dropTargetInfo = { parentId: subFolderId };
          }
          removeIndicator();
          return;
        }
      }

      if (e.clientY < midY) {
        insertBefore = row;
        indicatorTop = rect.top;
        break;
      }
    }

    clearFolderHighlight();

    if (!insertBefore && rows.length > 0) {
      const lastRow = rows[rows.length - 1];
      indicatorTop = lastRow.getBoundingClientRect().bottom;
    }

    const ddRect = dropdown.getBoundingClientRect();
    ind.style.position = "fixed";
    ind.style.top = `${indicatorTop - 1}px`;
    ind.style.left = `${ddRect.left + 8}px`;
    ind.style.width = `${ddRect.width - 16}px`;
    ind.style.height = "2px";
    ind.style.zIndex = "2147483647";

    if (!ind.parentElement) {
      document.body.appendChild(ind);
    }

    if (insertBefore) {
      const idx = rows.indexOf(insertBefore);
      dropTargetInfo = { parentId: folderId, index: idx >= 0 ? idx : 0 };
    } else {
      dropTargetInfo = { parentId: folderId, index: rows.length };
    }
  });

  dropdown.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    executeDrop();
  });
}

/** I-beam インジケーターを生成 */
function ensureIndicator(): HTMLElement {
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.className = "mrbb-drop-indicator";
  }
  return indicator;
}

function clearFolderHighlight(): void {
  if (highlightedFolder) {
    highlightedFolder.classList.remove("mrbb-folder-drop-target");
    highlightedFolder = null;
  }
  document.querySelectorAll(".mrbb-folder-drop-target").forEach((el) =>
    el.classList.remove("mrbb-folder-drop-target")
  );
}

function onDragStart(e: DragEvent): void {
  const target = (e.target as HTMLElement).closest<HTMLElement>(".mrbb-item");
  if (!target?.dataset.bmId) return;

  draggedId = target.dataset.bmId;
  draggedEl = target;
  target.classList.add("mrbb-dragging");

  e.dataTransfer!.effectAllowed = "move";
  e.dataTransfer!.setData("text/plain", draggedId);

  // ドラッグゴーストを生成 — dragend まで保持する（即削除するとChromeがドラッグを中断する）
  if (e.dataTransfer!.setDragImage) {
    const clone = target.cloneNode(true) as HTMLElement;
    clone.style.opacity = "0.8";
    clone.style.position = "absolute";
    clone.style.top = "-1000px";
    clone.style.left = "-1000px";
    document.body.appendChild(clone);
    e.dataTransfer!.setDragImage(clone, e.offsetX, e.offsetY);
    dragGhost = clone; // cleanup() で除去
  }

  // row 0（ネイティブバー領域）のドロップゾーン表示は無効化
  // 表示すると混乱するため、拡張バー内でのみD&Dを許可する
}

function onDragOver(e: DragEvent): void {
  e.preventDefault();
  if (!draggedId) return;
  e.dataTransfer!.dropEffect = "move";

  const root = e.currentTarget as HTMLElement;
  const rows = root.querySelectorAll<HTMLElement>(".mrbb-row");

  // マウス位置から対象行を決定
  let targetRow: HTMLElement | null = null;
  for (const row of rows) {
    // row1ドロップゾーンも含める
    if (row.style.display === "none") continue;
    const rect = row.getBoundingClientRect();
    if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
      targetRow = row;
      break;
    }
  }

  if (!targetRow) {
    removeIndicator();
    clearFolderHighlight();
    return;
  }

  // Row 1 ドロップゾーン
  if (targetRow.classList.contains("mrbb-row1-dropzone")) {
    const zoneRect = targetRow.getBoundingClientRect();
    // row1内の位置を計算 — 横位置でインデックスを推定
    const allRow1Items = targetRow.querySelectorAll<HTMLElement>(".mrbb-item");
    let insertIdx = 0;
    let indicatorLeft = zoneRect.left + 8;

    for (let i = 0; i < allRow1Items.length; i++) {
      const rect = allRow1Items[i].getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      if (e.clientX < midX) {
        insertIdx = i;
        indicatorLeft = rect.left;
        break;
      }
      insertIdx = i + 1;
      indicatorLeft = rect.right;
    }

    clearFolderHighlight();
    const ind = ensureIndicator();
    ind.style.position = "fixed";
    ind.style.top = `${zoneRect.top + 2}px`;
    ind.style.left = `${indicatorLeft - 1}px`;
    ind.style.height = `${zoneRect.height - 4}px`;
    ind.style.width = "2px";
    ind.style.zIndex = "2147483647";
    if (!ind.parentElement) document.body.appendChild(ind);

    dropTargetInfo = { parentId: "1", index: insertIdx };
    return;
  }

  // 通常の行
  const items = [...targetRow.querySelectorAll<HTMLElement>(".mrbb-item:not(.mrbb-dragging)")];

  let insertBefore: HTMLElement | null = null;
  let indicatorLeft = 0;

  for (const item of items) {
    const rect = item.getBoundingClientRect();

    // フォルダの上にドラッグしたらフォルダに入れるハイライト
    if (item.classList.contains("mrbb-folder")) {
      const inFolderZone = e.clientX >= rect.left + rect.width * 0.25 && e.clientX <= rect.left + rect.width * 0.75;
      if (inFolderZone) {
        clearFolderHighlight();
        item.classList.add("mrbb-folder-drop-target");
        highlightedFolder = item;
        const folderId = item.dataset.bmId;
        if (folderId) {
          dropTargetInfo = { parentId: folderId };
        }
        removeIndicator();
        return;
      }
    }

    const midX = rect.left + rect.width / 2;
    if (e.clientX < midX) {
      insertBefore = item;
      indicatorLeft = rect.left;
      break;
    }
  }

  clearFolderHighlight();

  if (!insertBefore && items.length > 0) {
    const lastItem = items[items.length - 1];
    const rect = lastItem.getBoundingClientRect();
    indicatorLeft = rect.right;
  }

  const ind = ensureIndicator();
  const rowRect = targetRow.getBoundingClientRect();
  ind.style.position = "fixed";
  ind.style.top = `${rowRect.top + 2}px`;
  ind.style.left = `${indicatorLeft - 1}px`;
  ind.style.height = `${rowRect.height - 4}px`;
  ind.style.width = "2px";
  ind.style.zIndex = "2147483647";

  if (!ind.parentElement) {
    document.body.appendChild(ind);
  }

  // ドロップ情報を保存（ブックマークバー直下）
  // ドラッグ中のアイテムも含めた全アイテムでインデックスを計算する
  // （Chrome API は元の位置を含む絶対インデックスを期待する）
  if (insertBefore) {
    const allItems = [...root.querySelectorAll<HTMLElement>(".mrbb-item")];
    const idx = allItems.indexOf(insertBefore);
    dropTargetInfo = { parentId: "1", index: idx >= 0 ? idx : 0 };
  } else {
    const allItems = [...root.querySelectorAll<HTMLElement>(".mrbb-item")];
    dropTargetInfo = { parentId: "1", index: allItems.length };
  }
}

/** row 1 をドラッグ中のみドロップゾーンとして表示 */
function showRow1DropZone(): void {
  const root = getBarContainer();
  if (!root) return;
  const firstRow = root.querySelector(".mrbb-row:first-child") as HTMLElement | null;
  if (!firstRow) return;
  firstRow.classList.remove("mrbb-row-hidden");
  firstRow.classList.add("mrbb-row1-dropzone");
}

/** row 1 を非表示に戻す */
function hideRow1DropZone(): void {
  const root = getBarContainer();
  if (!root) return;
  const firstRow = root.querySelector(".mrbb-row:first-child") as HTMLElement | null;
  if (!firstRow) return;
  firstRow.classList.add("mrbb-row-hidden");
  firstRow.classList.remove("mrbb-row1-dropzone");
}

function removeIndicator(): void {
  indicator?.remove();
  indicator = null;
}

function onDragEnd(_e: DragEvent): void {
  cleanup();
}

function executeDrop(): void {
  if (!draggedId || !dropTargetInfo) {
    cleanup();
    return;
  }

  try {
    const dest: { parentId: string; index?: number } = { parentId: dropTargetInfo.parentId };
    if (dropTargetInfo.index !== undefined) {
      // Chrome bookmarks.move のインデックスは移動元を考慮する必要がある。
      // 同じ親内で前方から後方に移動する場合、元の位置が除かれるため
      // インデックスが1つずれる。service worker 側で正しく処理されるよう
      // ここでは計算済みのインデックスをそのまま渡す。
      // Chrome API は同一親内の移動時に自動補正する。
      dest.index = dropTargetInfo.index;
    }
    chrome.runtime.sendMessage({
      type: "MRBB_MOVE_BOOKMARK",
      id: draggedId,
      destination: dest,
    });
  } catch (err) {
    console.warn("[MRBB] bookmark move failed:", err);
  }

  cleanup();
}

async function onDrop(e: DragEvent): Promise<void> {
  e.preventDefault();
  executeDrop();
}

function cleanup(): void {
  // Shadow DOM 内のドラッグ中クラスをクリア
  const root = getBarContainer();
  if (root) {
    root.querySelectorAll(".mrbb-dragging")
      .forEach((el) => el.classList.remove("mrbb-dragging"));
  }
  removeIndicator();
  clearFolderHighlight();
  hideRow1DropZone();
  // ドラッグゴーストを除去
  if (dragGhost) {
    dragGhost.remove();
    dragGhost = null;
  }
  draggedEl = null;
  draggedId = null;
  dropTargetInfo = null;
}
