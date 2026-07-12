// Headful Chrome for Testing + OS-level screenshot:
// native bookmark bar (browser chrome) vs extension bar (page top) side by side.
import puppeteer from "puppeteer";
import { fileURLToPath } from "url";
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";

const EXT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "extension");

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><head><title>MRBB Visual</title></head>
  <body style="margin:0;background:#fff"><p style="padding:8px">page content</p></body></html>`);
});
await new Promise(r => server.listen(18924, r));

// Profile with native bookmarks bar shown on all tabs
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mrbb-visual-"));
fs.mkdirSync(path.join(userDataDir, "Default"), { recursive: true });
fs.writeFileSync(
  path.join(userDataDir, "Default", "Preferences"),
  JSON.stringify({ bookmark_bar: { show_on_all_tabs: true } })
);

const browser = await puppeteer.launch({
  headless: false,
  userDataDir,
  defaultViewport: null,
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    "--no-first-run",
    "--window-position=0,0",
    "--window-size=1280,700",
  ],
});

try {
  const swTarget = await browser.waitForTarget(
    t => t.type() === "service_worker" && t.url().includes("background.js"),
    { timeout: 15000 }
  );
  const sw = await swTarget.worker();
  await sw.evaluate(async () => {
    const titles = ["Google", "GitHub", "YouTube", "Twitter", "Reddit", "StackOverflow",
      "Notion", "Discord", "Figma", "Qiita", "Zenn", "Amazon", "Netflix", "Spotify",
      "Wikipedia", "MDN Web Docs", "Hacker News", "Product Hunt", "Dribbble", "Behance"];
    for (let i = 0; i < titles.length; i++) {
      await chrome.bookmarks.create({
        parentId: "1", title: titles[i],
        url: "https://example.com/" + titles[i].toLowerCase().replace(/\s/g, ""),
      });
    }
    await chrome.bookmarks.create({ parentId: "1", title: "MyFolder" });
  });

  const pages = await browser.pages();
  const page = pages[0];
  await page.goto("http://localhost:18924/", { waitUntil: "load" });
  await page.waitForFunction(
    () => !!document.getElementById("mrbb-host")?.shadowRoot?.querySelector(".mrbb-row"),
    { timeout: 10000 }
  );
  await new Promise(r => setTimeout(r, 1500)); // let favicons settle

  // report geometry: where does the viewport begin (in screen px)?
  const geo = await page.evaluate(() => ({
    chromeTop: window.outerHeight - window.innerHeight, // tabstrip+toolbar+native bar height (CSS px)
    dpr: window.devicePixelRatio,
    extBarH: document.getElementById("mrbb-host").getBoundingClientRect().height,
  }));
  console.log("GEO:", JSON.stringify(geo));

  // Capture ONLY the Chrome test window via PrintWindow (works even when occluded,
  // and never includes other windows on the desktop)
  const ps = `
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$h = (Get-Process -Id BROWSER_PID).MainWindowHandle
if ($h -eq [IntPtr]::Zero) { Write-Error "window not found"; exit 1 }
$r = New-Object Win32+RECT
[Win32]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
$b = New-Object System.Drawing.Bitmap($w, $ht)
$g = [System.Drawing.Graphics]::FromImage($b)
$dc = $g.GetHdc()
[Win32]::PrintWindow($h, $dc, 2) | Out-Null
$g.ReleaseHdc($dc)
$crop = $b.Clone([System.Drawing.Rectangle]::new(0, 0, $w, [Math]::Min(280, $ht)), $b.PixelFormat)
$crop.Save("mrbb-native-vs-ext.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $b.Dispose(); $crop.Dispose()
Write-Output "size: $w x $ht"
`;
  const psFinal = ps.replace("BROWSER_PID", String(browser.process().pid));
  const out = execFileSync("powershell", ["-NoProfile", "-Command", psFinal], { cwd: process.cwd() });
  console.log(String(out));
  console.log("captured mrbb-native-vs-ext.png");
} finally {
  await browser.close();
  server.close();
}
