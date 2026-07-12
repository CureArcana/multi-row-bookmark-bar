/**
 * 各エントリポイントを個別にIIFEビルドし、dist/に出力する
 */
import { build } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { cpSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = resolve(__dirname, "dist-out");

// dist-out をクリーンアップ
if (existsSync(dist)) {
  rmSync(dist, { recursive: true, force: true });
}
mkdirSync(dist, { recursive: true });

// 各エントリを個別にIIFEビルド
const entries = [
  { name: "content", input: resolve(__dirname, "src/content/index.ts") },
  { name: "background", input: resolve(__dirname, "src/background/service-worker.ts") },
  { name: "popup", input: resolve(__dirname, "src/popup/popup.ts") },
];

for (const entry of entries) {
  await build({
    configFile: false,
    build: {
      outDir: dist,
      emptyOutDir: false,
      lib: {
        entry: entry.input,
        name: entry.name,
        formats: ["iife"],
        fileName: () => `${entry.name}.js`,
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
      minify: "esbuild",
    },
  });
}

// manifest.json
const manifest = JSON.parse(readFileSync(resolve(__dirname, "src/manifest.json"), "utf-8"));
manifest.background.service_worker = "background.js";
manifest.content_scripts[0].js = ["content.js"];
manifest.content_scripts[0].css = ["content.css"];
manifest.action.default_popup = "popup.html";
manifest.action.default_icon = { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" };
manifest.icons = { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" };
writeFileSync(resolve(dist, "manifest.json"), JSON.stringify(manifest, null, 2));

// icons
mkdirSync(resolve(dist, "icons"), { recursive: true });
for (const size of [16, 48, 128]) {
  cpSync(resolve(__dirname, `src/icons/icon${size}.png`), resolve(dist, `icons/icon${size}.png`));
}

// styles.css → content.css
cpSync(resolve(__dirname, "src/content/styles.css"), resolve(dist, "content.css"));

// popup.html
let popupHtml = readFileSync(resolve(__dirname, "src/popup/popup.html"), "utf-8");
popupHtml = popupHtml.replace('src="popup.ts"', 'src="popup.js"');
popupHtml = popupHtml.replace('src="../icons/icon48.png"', 'src="icons/icon48.png"');
writeFileSync(resolve(dist, "popup.html"), popupHtml);

console.log("Build complete! Output: dist-out/");
