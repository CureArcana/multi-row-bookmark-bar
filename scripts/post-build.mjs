/**
 * ビルド後にmanifest.json, icons, popup.html, styles.cssをdist/にコピーするスクリプト
 */
import { cpSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist2");

// manifest.json — パスをdist構造に合わせて書き換え
const manifest = JSON.parse(readFileSync(resolve(root, "src/manifest.json"), "utf-8"));
manifest.background.service_worker = "background.js";
manifest.content_scripts[0].js = ["content.js"];
manifest.content_scripts[0].css = ["content.css"];
manifest.action.default_popup = "popup.html";
manifest.action.default_icon = {
  "16": "icons/icon16.png",
  "48": "icons/icon48.png",
  "128": "icons/icon128.png",
};
manifest.icons = {
  "16": "icons/icon16.png",
  "48": "icons/icon48.png",
  "128": "icons/icon128.png",
};
writeFileSync(resolve(dist, "manifest.json"), JSON.stringify(manifest, null, 2));

// icons
mkdirSync(resolve(dist, "icons"), { recursive: true });
for (const size of [16, 48, 128]) {
  cpSync(
    resolve(root, `src/icons/icon${size}.png`),
    resolve(dist, `icons/icon${size}.png`)
  );
}

// styles.css → content.css
cpSync(resolve(root, "src/content/styles.css"), resolve(dist, "content.css"));

// popup.html — script srcをビルド後のパスに書き換え
let popupHtml = readFileSync(resolve(root, "src/popup/popup.html"), "utf-8");
popupHtml = popupHtml.replace('src="popup.ts"', 'src="popup.js"');
popupHtml = popupHtml.replace('src="../icons/icon48.png"', 'src="icons/icon48.png"');
writeFileSync(resolve(dist, "popup.html"), popupHtml);

console.log("Post-build: copied manifest, icons, styles, popup.html to dist/");
