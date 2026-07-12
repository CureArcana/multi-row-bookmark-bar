// Calibration: capture native bookmark bar at several window widths,
// and print exact Segoe UI 12px text widths for each bookmark label.
import puppeteer from "puppeteer";
import { fileURLToPath } from "url";
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";

const EXT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "multi-row-bookmark-bar-v1.6.0");
const TITLES = ["Google", "GitHub", "YouTube", "Twitter", "Reddit", "StackOverflow",
  "Notion", "Discord", "Figma", "Qiita", "Zenn", "Amazon", "Netflix", "Spotify",
  "Wikipedia", "MDN Web Docs", "Hacker News", "Product Hunt", "Dribbble", "Behance", "MyFolder"];

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><head><title>MRBB Cal</title></head><body style="margin:0"><p>x</p></body></html>`);
});
await new Promise(r => server.listen(18925, r));

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mrbb-cal-"));
fs.mkdirSync(path.join(userDataDir, "Default"), { recursive: true });
fs.writeFileSync(path.join(userDataDir, "Default", "Preferences"),
  JSON.stringify({ bookmark_bar: { show_on_all_tabs: true } }));

const browser = await puppeteer.launch({
  headless: false,
  userDataDir,
  defaultViewport: null,
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    "--no-first-run",
    "--window-position=0,0",
    "--window-size=1280,400",
  ],
});

function captureWindow(pid, outName) {
  const ps = `
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$h = (Get-Process -Id ${pid}).MainWindowHandle
$r = New-Object Win32+RECT
[Win32]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
$b = New-Object System.Drawing.Bitmap($w, $ht)
$g = [System.Drawing.Graphics]::FromImage($b)
$dc = $g.GetHdc()
[Win32]::PrintWindow($h, $dc, 2) | Out-Null
$g.ReleaseHdc($dc)
$crop = $b.Clone([System.Drawing.Rectangle]::new(0, 78, $w, 46), $b.PixelFormat)
$crop.Save("${outName}", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $b.Dispose(); $crop.Dispose()
`;
  execFileSync("powershell", ["-NoProfile", "-Command", ps], { cwd: process.cwd() });
}

try {
  const swTarget = await browser.waitForTarget(
    t => t.type() === "service_worker" && t.url().includes("background.js"), { timeout: 15000 });
  const sw = await swTarget.worker();
  await sw.evaluate(async (titles) => {
    for (const t of titles) {
      if (t === "MyFolder") await chrome.bookmarks.create({ parentId: "1", title: t });
      else await chrome.bookmarks.create({ parentId: "1", title: t, url: "https://example.com/" + t.toLowerCase().replace(/\s/g, "") });
    }
  }, TITLES);

  const pages = await browser.pages();
  const page = pages[0];
  await page.goto("http://localhost:18925/", { waitUntil: "load" });

  // exact canvas text widths (same measurement the extension uses)
  const widths = await page.evaluate((titles) => {
    const c = document.createElement("canvas").getContext("2d");
    c.font = '12px "Segoe UI", system-ui, -apple-system, sans-serif';
    return titles.map(t => c.measureText(t).width);
  }, TITLES);
  console.log("TEXTWIDTHS:", JSON.stringify(widths.map(w => Math.round(w * 10) / 10)));

  // resize the OS window via CDP and capture native bar each time
  const cdp = await page.createCDPSession();
  const { windowId } = await cdp.send("Browser.getWindowForTarget");
  const pid = browser.process().pid;
  for (const w of [900, 1100, 1280]) {
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { width: w, height: 400 } });
    await new Promise(r => setTimeout(r, 1200));
    captureWindow(pid, `cal-${w}.png`);
    console.log(`captured cal-${w}.png`);
  }
} finally {
  await browser.close();
  server.close();
}
