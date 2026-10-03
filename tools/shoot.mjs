// README screenshots through the Chrome DevTools Protocol: exact element crops (or the viewport), light or dark, reduced motion.
// Usage: node tools/shoot.mjs <url> <selector|viewport> <waitForSelector> <out.png> [width] [light|dark] [setupJS] [height] [scale]
// e.g.   node tools/shoot.mjs "http://localhost:4173/aws-ip-map/history/?ip=35.180.0.1" "#ip" "[data-out=ip] .gantt" docs/history.png
// Needs Chrome (set CHROME to its path) and a running `npm run serve`. Zero dependencies (Node 22+ has WebSocket).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [,, url, selector, waitFor, out, width = '1100', scheme = 'light', setup = '', height = '900', dsf = '2'] = process.argv;
const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9333', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'shoot-')), 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets; for (let i = 0; i < 50; i++) { try { targets = await (await fetch('http://127.0.0.1:9333/json')).json(); break; } catch { await sleep(200); } }
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Emulation.setDeviceMetricsOverride', { width: Number(width), height: Number(height), deviceScaleFactor: Number(dsf), mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
await send('Page.enable'); await send('Page.navigate', { url });
for (let i = 0; i < 100; i++) { await sleep(200); if (await evalJS('!!document.querySelector(' + JSON.stringify(waitFor) + ')')) break; }
await sleep(1500);
if (setup) { await evalJS(setup); await sleep(1200); }
if (selector === 'viewport') { await sleep(4000); const v = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(out, Buffer.from(v.result.data, 'base64')); console.log(out, 'viewport'); ws.close(); proc.kill(); process.exit(0); }
const r = await evalJS('(() => { const el = document.querySelector(' + JSON.stringify(selector) + '); el.scrollIntoView({block: "start"}); const b = el.getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height }; })()');
await sleep(800);
const pad = 24; const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.w + pad * 2, height: r.h + pad * 2, scale: 1 } });
fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log(out, JSON.stringify(r)); ws.close(); proc.kill();
