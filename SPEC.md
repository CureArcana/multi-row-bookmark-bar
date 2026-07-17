# Multi-Row Bookmark Bar — 仕様・設計ドキュメント

> v1.5.0 時点 (2026-03-26 更新)

## 1. プロダクト概要

Chrome のブックマークバーが 1 行に収まらないとき、あふれたブックマークを自動で 2 行目以降に折り返し表示する Chrome 拡張。Chrome 純正のバーはそのまま活かし、拡張はオーバーフロー分だけを描画する「共存方式」を採用している。

Chrome Web Store を経由せず、GitHub からダウンロード → `chrome://extensions` で「パッケージ化されていない拡張機能を読み込む」形式で配布する。

**リポジトリ**: `CureArcana/multi-row-bookmark-bar`

---

## 2. 設計思想

### 2.1 Chrome 純正バーとの共存

拡張はブックマーク全体を再描画しない。Chrome がネイティブに表示する 1 行目（row 0）はそのまま残し、そこに収まりきらないアイテムだけを拡張バー（row 1+）で描画する。ユーザーから見ると「Chrome の標準バーがそのまま下に伸びた」ように見える。

内部的には全ブックマークを行に割り振り、row 0 は `display: none` で非表示にしている。こうすることでドラッグ＆ドロップ時に row 0 をドロップゾーンとして一時的に可視化できる。

### 2.2 Content Script の制約と Service Worker 分離

Chrome 拡張の Content Script は `chrome.bookmarks` API にアクセスできない。そのため全てのブックマーク操作は Service Worker（Background）経由のメッセージングで行う。

```
Content Script  ──sendMessage──▶  Service Worker
   (DOM操作)                       (chrome.bookmarks)
                ◀──sendResponse──
```

これにより Content Script は純粋な描画・UI 層、Service Worker はデータ・操作層として責務が分離されている。

### 2.3 ページ CSS からの隔離

拡張の DOM はページ本体に直接挿入されるため、ページ側の CSS が拡張の見た目を壊す可能性がある。対策として重要なプロパティに `!important` を付与しているが、`all: initial` のような過激なリセットは使わない。過去に `all: initial` を導入した v1.4.4 でインラインスタイル（`display: none` 等）が上書きされて表示が壊れた経験から、「ターゲットを絞った !important」が最適解と判断した。

### 2.4 Row 0 のネイティブバー幅推定

Chrome のネイティブバーと拡張バーではアイテムのパディングが異なる（Chrome 約 4px vs 拡張 8px）。row 0 の幅計算にはネイティブバーのパディングを模倣する `calcNativeItemWidth` を使い、row 1 以降は拡張独自の `calcItemWidth` を使う。ネイティブバーの使用可能幅も左端のアプリアイコン（約 40px）と右端の >> シェブロン（約 48px）を差し引いて計算する。

---

## 3. 技術スタック

| 領域 | 技術 |
|------|------|
| 種別 | Chrome Extension (Manifest V3) |
| 言語 | TypeScript 5.7+ |
| UI | Vanilla DOM (Chrome 純正風) |
| ビルド | Vite 6 (IIFE format, `build.mjs` カスタムスクリプト) |
| API | `chrome.bookmarks`, `chrome.storage.sync` |
| 配布 | GitHub Releases (ZIP) |
| ライセンス | MIT |

### ビルドの仕組み

Content Script / Service Worker / Popup の 3 エントリポイントをそれぞれ個別の IIFE としてビルドする。ES Module は Content Script で使えないため IIFE 形式が必須。`build.mjs` が Vite の JS API を呼び出し、ビルド後に manifest.json のパスを書き換え、CSS・HTML・アイコンをコピーして `dist-out/` に最終成果物を生成する。

---

## 4. アーキテクチャ図

```
┌──────────────────────────────────────────────────────┐
│                     Browser Tab                       │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │ Chrome Native Bookmark Bar (row 0)             │  │
│  │  ← 拡張は触らない、Chrome が描画 →             │  │
│  ├────────────────────────────────────────────────┤  │
│  │ #mrbb-root (position: fixed, top: 0)          │  │
│  │  ├─ .mrbb-row [row 0] → display: none         │  │
│  │  ├─ .mrbb-row [row 1] → ギア + 検索 + items  │  │
│  │  ├─ .mrbb-row [row 2] → items                 │  │
│  │  └─ .mrbb-row [row N] → items                 │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  body.style.marginTop = (totalRows - 1) * barHeight  │
│                                                      │
└──────────────────────────────────────────────────────┘

┌─────────────────────┐     message     ┌──────────────────────┐
│   Content Script     │ ──────────────▶ │  Service Worker       │
│                      │                 │                       │
│ - bar-renderer.ts    │                 │ - chrome.bookmarks    │
│ - overflow-calc.ts   │ ◀────────────── │ - CRUD 操作           │
│ - folder-dropdown.ts │   sendResponse  │ - 検索                │
│ - drag-drop.ts       │                 │ - ソート              │
│ - context-menu.ts    │                 │ - 設定初期化          │
│ - bookmark-item.ts   │                 └──────────────────────┘
│ - index.ts           │
└─────────────────────┘

┌─────────────────────────────┐
│ 使い方/設定ページ (howto.html) │
│ - アイコンクリックで開く       │
│ - 使い方・設定 UI・お問い合わせ │
│ - chrome.storage.sync        │
└─────────────────────────────┘
```

> **注 (v2.4.1〜):** 旧ポップアップ (popup.html) は廃止し、ツールバーアイコンの
> クリックでタブに開く使い方/設定ページ (howto.html) に置き換えた。
> 初回インストール時にも自動で開く。以下のディレクトリ構成は初期TS設計時のもので、
> 現行の配布物は `extension/` 直下のプレーンJS構成（ビルド不要）。

---

## 5. ディレクトリ構成

```
multi-row-bookmark-bar/
├── src/
│   ├── manifest.json                # Manifest V3 定義
│   ├── background/
│   │   └── service-worker.ts        # chrome.bookmarks 操作、メッセージハンドラ
│   ├── content/
│   │   ├── index.ts                 # エントリポイント（設定読込、イベント登録）
│   │   ├── bar-renderer.ts          # メイン描画ロジック（render, 設定パネル, 検索）
│   │   ├── overflow-calc.ts         # レイアウト計算（行割り振り、ネイティブ幅推定）
│   │   ├── bookmark-item.ts         # 個別アイテム DOM 生成
│   │   ├── folder-dropdown.ts       # フォルダドロップダウン（hover/click モード）
│   │   ├── drag-drop.ts             # ドラッグ＆ドロップ（バー間・フォルダへ・DD内）
│   │   ├── context-menu.ts          # 右クリックコンテキストメニュー
│   │   └── styles.css               # 全スタイル（CSS カスタムプロパティ + !important）
│   ├── popup/
│   │   ├── popup.html               # 拡張アイコンクリック時の設定画面
│   │   └── popup.ts                 # 設定読み書き
│   ├── shared/
│   │   ├── constants.ts             # 定数（サイズ、ID、アイコン SVG）
│   │   └── types.ts                 # 型定義（Settings, BookmarkDisplayItem, LayoutItem）
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
├── build.mjs                        # Vite IIFE ビルドスクリプト
├── package.json
├── tsconfig.json
├── SPEC.md                          # このファイル
├── README.md
└── LICENSE
```

---

## 6. メッセージング仕様

Content Script ↔ Service Worker 間のメッセージ一覧:

| type | 方向 | ペイロード | レスポンス | 用途 |
|------|------|-----------|-----------|------|
| `MRBB_GET_BOOKMARKS` | CS → SW | なし | `{ bookmarks: BookmarkDisplayItem[] }` | ブックマークバー全件取得 |
| `MRBB_MOVE_BOOKMARK` | CS → SW | `{ id, destination }` | `{ success }` | ブックマーク移動 |
| `MRBB_DELETE_BOOKMARK` | CS → SW | `{ id, isFolder }` | `{ success }` | ブックマーク削除 |
| `MRBB_CREATE_BOOKMARK` | CS → SW | `{ parentId, title, url }` | `{ success, id }` | ブックマーク作成 |
| `MRBB_CREATE_FOLDER` | CS → SW | `{ parentId, title }` | `{ success, id }` | フォルダ作成 |
| `MRBB_UPDATE_BOOKMARK` | CS → SW | `{ id, changes }` | `{ success }` | タイトル/URL 編集 |
| `MRBB_SEARCH_BOOKMARKS` | CS → SW | `{ query }` | `{ results: [{id, title, url}] }` | ブックマーク検索（最大 20 件） |
| `MRBB_SORT_BOOKMARKS` | CS → SW | `{ parentId, sortBy }` | `{ success }` | ブックマークソート |
| `MRBB_OPEN_TAB` | CS → SW | `{ url }` | なし | 新しいタブで開く |
| `MRBB_REFRESH` | SW → CS | なし | なし | 再描画トリガー（ブックマーク変更時） |

---

## 7. レイアウト計算（overflow-calc.ts）

### 7.1 幅計算モデル（v1.6.0 で実測再キャリブレーション済み）

Chrome 150 で幅 900 / 1100 / 1280px のネイティブバー表示個数を実測し、
Canvas 計測テキスト幅と連立して逆算した。拡張バーも同一モデルで描画するため
row 0 と row 1+ の計算式は共通（テキスト幅のキャップ以外）。

```
アイテム幅 = テキスト幅(12px Segoe UI) + 40
  内訳: padding 8*2 + icon 16 + icon-text gap 6 + item spacing 2

row 0 (Chrome ネイティブ):
  使用可能幅(オーバーフロー時) = windowWidth - 22(左) - 33(>>シェブロン込み右)
  「その他のブックマーク」が非空の場合はそのボタン幅も差し引く
  全アイテムが windowWidth - 22 - 8 に収まる場合は拡張バー自体を出さない

row 1+ (拡張バー):
  使用可能幅 = windowWidth - BAR_MARGIN_X * 2 (= 16px)
  row 1 のみ: さらに gear (24px) + search (24px) を差し引き
```

再キャリブレーション手順: `node test/calibrate.mjs` → 生成される cal-*.png の
ネイティブバー表示個数と TEXTWIDTHS 出力から定数を解き直す。

### 7.2 テキスト幅計測

Canvas 2D Context の `measureText()` を使い、フォントは `"Segoe UI", system-ui, -apple-system, sans-serif` で実測する。最大幅は `TEXT_MAX_WIDTH = 150px` でキャップ。

### 7.3 行送りロジック

```
for each bookmark:
  w = 現在行に応じた幅計算(native or extension)
  if rowUsed + w > effectiveWidth:
    currentRow++
    rowUsed = 0
    w を新しい行に合わせて再計算（row 0→1 で計算方式が変わるため）
  result.push({ bookmark, width, row: currentRow })
  rowUsed += w
```

---

## 8. 描画フロー（bar-renderer.ts）

```
render()
  ├─ fetchBookmarks() → Service Worker からデータ取得
  ├─ calcLayout() → 行割り振り
  ├─ totalRows <= 1 → removeBar() して終了（全て1行に収まる）
  ├─ ensureRoot() → #mrbb-root 作成 or 既存取得
  ├─ for each row:
  │   ├─ div.mrbb-row を生成、高さ設定
  │   ├─ row 1 → ギアアイコン + 検索ボタンを挿入
  │   └─ createBookmarkElement() で各アイテム生成
  ├─ row 0 → style.display = "none"（Chrome ネイティブバーが担当）
  ├─ CSS カスタムプロパティ更新
  │   ├─ --mrbb-font-size
  │   ├─ --mrbb-bar-height
  │   └─ --mrbb-item-height
  └─ body.marginTop = (totalRows - 1) * barHeight
```

再描画のトリガー:
- ウィンドウリサイズ（150ms デバウンス）
- Service Worker からの `MRBB_REFRESH` メッセージ
- `chrome.storage.onChanged` による設定変更検知

---

## 9. 設定（Settings）

| プロパティ | 型 | デフォルト | 説明 |
|-----------|------|----------|------|
| `enabled` | boolean | `true` | 拡張の有効/無効 |
| `maxRows` | number | `0` | 最大行数（0 = 無制限） |
| `displayMode` | `"both" \| "icon_only" \| "text_only"` | `"both"` | アイテムの表示モード |
| `folderOpenMode` | `"hover" \| "click"` | `"hover"` | フォルダの開き方 |
| `showCondition` | `"always" \| "new_tab_only"` | `"always"` | 表示条件 |
| `fontSize` | number | `12` | フォントサイズ (px, 8-20) |
| `barHeight` | number | `34` | 1 行の高さ (px, 20-60) |

設定は `chrome.storage.sync` に保存され、デバイス間で同期される。変更は `chrome.storage.onChanged` で検知し、即座に再描画する。

設定の変更方法は 2 つ:
1. 拡張アイコンクリック → Popup 画面（全設定項目）
2. バー上のギアアイコン → インライン設定パネル（主要設定のみ）

---

## 10. 機能一覧

### 10.1 自動折り返し表示

```
┌──────────────────────────────────────────────────────┐
│ ★Google  ★GitHub  ★Twitter  ★YouTube  ★Reddit ... >> │ ← Chrome標準バー
├──────────────────────────────────────────────────────┤
│ ⚙🔍 ★Stack..  ★Notion  ★Discord  ★Figma  ★DLsite   │ ← 拡張 (row 1)
├──────────────────────────────────────────────────────┤
│ ★Holodex  ★Qiita  ★Zenn                              │ ← 拡張 (row 2)
└──────────────────────────────────────────────────────┘
```

### 10.2 フォルダドロップダウン

2 つのモードを設定で切り替え可能:

- **hover モード**: マウスホバーで開く。document レベルの `mousemove` で「アンカー要素 ↔ ドロップダウン領域」のどちらにもカーソルがなければ 400ms 後に閉じる。サブフォルダも同様のホバー追跡で連鎖的に開く。
- **click モード**: クリックで開閉トグル。同じフォルダの再クリックで閉じる。ドロップダウン外のクリック（document レベル `mousedown`）でも閉じる。

ドロップダウンは画面端に近い場合、自動で左右反転して画面内に収まるよう調整する。

### 10.3 ドラッグ＆ドロップ

- バー上のアイテムをドラッグして並べ替え可能
- フォルダ上に長く乗せるとフォルダ内にドロップ（青ハイライト表示）
- ドロップ位置は I-beam インジケーター（青い縦線）で表示
- ドラッグ中は row 0（通常は非表示）がドロップゾーンとして一時的に表示される
- ドロップダウン内でもドラッグ＆ドロップ対応
- `<a>` タグのデフォルト URL ドラッグを上書きし、ブックマーク ID でのドラッグに統一

### 10.4 コンテキストメニュー（右クリック）

バー上・ドロップダウン内のアイテムで利用可能:

- Open in new tab（リンクのみ）
- Rename
- Edit URL（リンクのみ）
- Move to bookmark bar（サブフォルダ内アイテム）
- Delete
- Add page... / Add folder...

### 10.5 ブックマーク検索 (v1.5.0)

バー上の検索アイコンをクリックするとインライン検索入力欄が展開。2 文字以上入力すると 200ms デバウンスで `chrome.bookmarks.search` を呼び出し、最大 20 件の結果をドロップダウンで表示する。タイトル・URL の両方を表示。

### 10.6 ブックマークソート (v1.5.0)

Service Worker が `MRBB_SORT_BOOKMARKS` メッセージを処理し、指定フォルダ内のブックマークをタイトル / URL / 追加日時でソートする。

### 10.7 インライン設定パネル

ギアアイコンクリックで展開。ページ遷移なしで Font size / Row height / Max rows / Folder open mode を即座に変更できる。パネル外クリックで閉じる。

### 10.8 キーボードショートカット

`Ctrl+Shift+B` で拡張バーの表示/非表示をトグル。

---

## 11. 定数一覧（constants.ts）

| 定数 | 値 | 説明 |
|------|-----|------|
| `BOOKMARK_BAR_ID` | `"1"` | Chrome のブックマークバーフォルダ ID（固定値） |
| `BAR_HEIGHT` | `34` | デフォルト行高さ (px) |
| `FAVICON_SIZE` | `16` | ファビコンサイズ (px) |
| `ITEM_PADDING_X` | `8` | 拡張バーアイテム左右パディング (px) |
| `ITEM_GAP` | `0` | アイテム間マージン (px) |
| `TEXT_MAX_WIDTH` | `150` | テキスト最大幅 (px) |
| `BAR_MARGIN_X` | `8` | バー左右マージン (px) |
| `ROOT_ID` | `"mrbb-root"` | ルート DOM 要素の ID |
| `STORAGE_KEY` | `"mrbb-settings"` | chrome.storage のキー |

ファビコンは Google 公開サービス（`google.com/s2/favicons`）で取得。フォルダアイコン（黄色 SVG）・リンクフォールバックアイコン（灰色 SVG）はインライン data URI として定義。

---

## 12. CSS 設計方針

### 12.1 CSS カスタムプロパティ (v1.5.0)

`#mrbb-root` に `--mrbb-font-size`, `--mrbb-bar-height`, `--mrbb-item-height` を定義し、子要素は `var()` で参照する。JS 側は `root.style.setProperty("--mrbb-font-size", ...)` で動的に変更。

### 12.2 !important 戦略

ページ CSS が拡張を壊すのを防ぐため、レイアウトに関わるプロパティ（`display`, `position`, `width`, `height`, `font-size`, `padding`, `margin`, `color`, `background` 等）には `!important` を付与する。ただし以下は避ける:

- **`all: initial !important`** — インラインスタイル（`style.display = "none"` 等）を上書きしてしまう。v1.4.4 で実証済み。**使用禁止。**
- **`all: revert !important`** — 継承チェーンを壊す
- `opacity`, `transition` など視覚演出系 — ページ CSS が多少影響しても実害がない

### 12.3 z-index

- `#mrbb-root`: `2147483646`（ほぼ最大値）
- ドロップダウン / コンテキストメニュー / 設定パネル / ドロップインジケーター: `2147483647`（最大値）

---

## 13. 過去の失敗と教訓

### v1.4.4: `all: initial` の罠

ページ CSS 隔離のために `all: initial !important` を `#mrbb-root` と子要素に適用 → `style.display = "none"` が CSS の `all: initial` に上書きされ、row 0 が非表示にならず全ブックマークが表示されるバグが発生。

**教訓: `all: initial` はインラインスタイルも殺す。使ってはいけない。**

### v1.4.5: クラスベース隠蔽の不完全対策

`all: initial` の問題を回避するため `.mrbb-row-hidden { display: none !important }` クラスに切り替えたが、子要素の `all: revert !important` が残っていたため依然として壊れた。

**教訓: CSS リセット系プロパティは連鎖的に予期しない影響を及ぼす。**

### v1.4.6: 幅計算の不一致

CSS 問題を解決したが、row 0 のアイテム幅を拡張と同じ 8px パディングで計算していたため、Chrome ネイティブバーが実際に表示しているアイテム数と拡張の認識がズレ、ブックマークが重複表示された。

**教訓: Chrome ネイティブバーのパディング（約 4px）と拡張のパディング（8px）は別々に計算する必要がある。**

---

## 14. ビルド手順

```bash
# 依存インストール
npm install

# ビルド → dist-out/ に出力
node build.mjs

# dist-out/ を Chrome に読み込み
# chrome://extensions → デベロッパーモード
# → パッケージ化されていない拡張機能を読み込む → dist-out/ を選択
```

---

## 15. 注意事項

- `chrome://` や `chrome-extension://` ページでは content_script が動作しないため、多段バーは表示されない
- Chrome 起動直後の新しいタブ（`chrome://newtab`）も同様
- ファビコンは Google 公開 API を使用（`chrome://favicon/` はセキュリティ制約で Content Script から使えないため）
- `<all_urls>` の host_permission は GitHub 配布なら問題ないが、Web Store 公開時は審査が厳しくなる

---

## 16. バージョン履歴

| バージョン | 主な変更 |
|-----------|---------|
| 1.0.0 | 初期実装（基本的な多段表示） |
| 1.1.0 | ファビコン・背景色改善 |
| 1.2.0 | D&D I-beam インジケーター、コンテキストメニュー |
| 1.3.0 | フォントサイズ設定、ギアアイコン、フォルダ D&D |
| 1.4.0 | Row height 設定、フォルダドロップダウン hover 改善 |
| 1.4.1 | Document レベル mousemove によるドロップダウンホバー追跡 |
| 1.4.2 | アイテムレベル dragstart でバー上ドラッグ修正 |
| 1.4.3 | Click モードトグル、外部クリック dismiss |
| 1.4.4 | CSS `all: initial` 導入 → リグレッション発生 |
| 1.4.5 | クラスベース隠蔽に切替 → 不完全修正 |
| 1.4.6 | CSS を targeted !important に戻し安定化 |
| 1.4.7 | Row 0 にネイティブバー幅推定 `calcNativeItemWidth` を導入 |
| 1.5.0 | CSS カスタムプロパティ、ブックマーク検索、ソート機能 |
| 1.5.1 | 独立方式（ネイティブバー非依存で全ブックマーク描画）に変更 |
| 1.6.0 | オーバーフロー連続方式に回帰（隠れた分だけ描画）。寸法モデルを Chrome 150 実測で再キャリブレーション（アイテム幅=テキスト+40、左右予約55）。見た目をネイティブ実測値に統一（bg=白, text=#474747, 境界=#e1e3e1, radius 8px, モノクロフォルダアイコン, GM3ダークモード）。fixed/sticky ヘッダーの動的押し下げ。barMode 設定追加。Alt+Shift+B トグル（chrome.commands）。puppeteer E2E テスト（test/）追加 |
