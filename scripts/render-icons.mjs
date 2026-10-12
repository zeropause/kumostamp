// Renders the extension's toolbar icons (16/32/48/128 px PNG) from the logo SVG,
// using headless Microsoft Edge (Windows) or Chrome through the DevTools protocol.
//   node scripts/render-icons.mjs
// Set BROWSER to another Chromium binary if neither default path exists.
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  process.env.BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].filter(Boolean);
const browser = candidates.find((p) => existsSync(p));
if (!browser) throw new Error("No Chromium browser found. Set BROWSER=/path/to/chrome.");

// The mark on a paper tile, so it stays visible on light and dark browser toolbars.
const tile = (size) => `<!doctype html><html style="overflow:hidden"><body style="margin:0;overflow:hidden;background:transparent">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" style="display:block">
  <rect x="1" y="1" width="62" height="62" rx="12" fill="#eef1ea" stroke="#3d8fa8" stroke-width="2"/>
  <g transform="translate(6.4 6.4) scale(0.8) translate(2 0)">
    <rect x="6" y="6" width="13" height="52" fill="#1b1f1d"/>
    <line x1="19" y1="32" x2="39.7" y2="14.67" stroke="#1b1f1d" stroke-width="10"/>
    <line x1="19" y1="32" x2="39.7" y2="49.33" stroke="#d23a2c" stroke-width="10"/>
    <path d="M42.42 5.99A35 35 0 0 1 42.42 58.01" fill="none" stroke="#1b1f1d" stroke-width="4"/>
    <line x1="47" y1="32" x2="52" y2="32" stroke="#1b1f1d" stroke-width="3"/>
  </g>
</svg></body></html>`;

const port = 9400 + Math.floor(Math.random() * 400);
const proc = spawn(browser, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${join(root, ".icon-render-profile")}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60 && !targets; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(250); }
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const waiting = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

await cdp("Page.enable");
await cdp("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
for (const size of [16, 32, 48, 128]) {
  await cdp("Emulation.setDeviceMetricsOverride", { width: size, height: size, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.navigate", { url: "data:text/html;base64," + Buffer.from(tile(size)).toString("base64") });
  await sleep(400);
  const shot = await cdp("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
  const out = join(root, "extension", "icons", `icon${size}.png`);
  writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  console.log(`extension/icons/icon${size}.png`);
}
ws.close();
proc.kill();
process.exit(0);
