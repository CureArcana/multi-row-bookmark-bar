# Multi-Row Bookmark Bar

**English** | [日本語](README.md)

A Chrome extension that shows the bookmarks hidden behind the `>>` overflow of Chrome's bookmarks bar as additional rows below it.

```
┌──────────────────────────────────────────────────┐
│ Google  GitHub  Twitter  YouTube  Reddit  ... >> │ ← Chrome's native bar (untouched)
├──────────────────────────────────────────────────┤
│ Notion  Discord  Figma  Qiita  Zenn  ...         │ ← the hidden ones continue here
├──────────────────────────────────────────────────┤
│ Holodex  Qiita  Zenn                             │ ← more rows added automatically
└──────────────────────────────────────────────────┘
```

## Features

- **Overflow continuation** — Starts exactly from the bookmarks that don't fit on the native bar (hidden behind `>>`). When everything fits, the extension bar disappears entirely.
- **Follows the native bar automatically** — Recalculates instantly when tab groups change. If you hide the native bar with Ctrl+Shift+B, it switches to rendering all bookmarks (no estimation, always exact); in F11 fullscreen it hides itself.
- **Looks identical to Chrome's native bar** — Font, background, text color, folder icon, and hover states all matched to measured Chrome values (dark mode supported).
- **Never modifies the page (auto-hide, default)** — The bar stays off-screen and slides down when you move the cursor to the very top edge. Because it never touches the page layout, no site ever breaks.
- **Push mode (optional)** — If you prefer it always visible, choose "Push page down" in Display settings (auto-offsets fixed/sticky headers; may break on some sites).
- **Automatic wrapping** — The number of rows adjusts to window width and to bookmark count changes.
- **Folders** — Dropdowns expand on hover (sub-folders supported recursively).
- **Drag & drop** — Reorder within the multi-row bar, drop into folders, and move between the native bar and the extension bar (reflected in the actual bookmark positions).
- **Real-time sync** — Bookmark add/remove/move is reflected instantly.
- **Search, sort, context menu** — All available right on the bar.
- **Alt+Shift+B** — Toggle the bar on/off.
- **New tab page (switchable)** — Replace the new tab with a custom page featuring the multi-row bar plus a Google search box (revertible to Chrome default in settings).

## Install

Installed directly from GitHub, not the Chrome Web Store — **no Google review required**.

1. Get the `extension/` folder from this repository (clone or download ZIP)
2. Open `chrome://extensions` in Chrome
3. Turn on **Developer mode** (top right)
4. **Load unpacked** → select the `extension/` folder

No build step required (plain JS).

## Settings

Configurable from the extension icon popup or the gear at the left end of the bar.

| Setting | Default | Description |
|---------|---------|-------------|
| Enabled | ON | Temporarily disable the extension (also toggled with Alt+Shift+B) |
| Language | Match browser | Can be pinned to English / 日本語 |
| New tab page | Custom with bar | Revertible to Chrome default |
| Display | Auto-hide overlay | Push-down always-visible mode also available (may break some sites) |
| Auto-hide details | 2px / 0ms / 400ms | Reveal-area height, reveal delay, hide delay, and hide-on-click toggles |
| Bar mode | Overflow only | Can switch to showing all bookmarks |
| Boundary offset | 0px | Corrects the estimate of the native bar's capacity via ◀▶ (stored in px, stable across reordering) |
| Max rows | 0 (unlimited) | Maximum number of rows to show |
| Folder open / close delay | Hover / 400ms | Switchable to click-to-open; close delay adjustable |
| Font size / row height | 12px / 36px | Visual tuning of the extension bar |

Each setting has an ⓘ icon that reveals an explanation.

## Development / Test

```bash
npm install

# E2E tests (loads the extension into Chrome for Testing and verifies every feature)
npm run test:e2e

# Visual comparison against the native bar (a headful window flashes briefly)
npm run test:visual
```

> Since production Chrome 137+ disables `--load-extension`, the automated tests
> run on the Chrome for Testing build that puppeteer installs.

## How it works

- The native bar's capacity is estimated with a dimension model reverse-engineered
  from measured Chrome values (item width = text width + 40px, 55px reserved left/right)
  plus Canvas text measurement. Tab-group chip widths and the presence of the
  "Other bookmarks" button are also factored in dynamically.
- The extension bar is rendered in a Shadow DOM, so page CSS cannot affect it.
- The default auto-hide mode never touches the page layout. Only push mode offsets
  the page via `body` `margin-top` and per-element `top` offsets on fixed/sticky elements.

## Known Limitations

- Does not work on `chrome://` pages or the Chrome Web Store (Chrome security restriction). The new tab is covered by the custom NTP (enabled by default).
- The native bar's capacity is an estimate and may be off by ±1 item depending on the environment (correctable with the gear panel's Boundary offset ◀▶; once set, it stays stable thanks to px storage).
- Push mode may break the layout on some sites (fixed headers, 100vh layouts). This never happens in the default auto-hide mode.

## License

[MIT](LICENSE)
