/*
 * Rasterizes every design at 16/32/48/128 into icon-lab/sets/<id>/.
 *
 * Each size is drawn from the vector at 4x and then scaled down in canvas,
 * which is what keeps 16px from turning into a grey blob.
 */
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.CDP_PORT || 9224;
const LAB = 'D:/MyProjects/AI-extension/icon-lab';
const PAGE = 'file:///' + LAB + '/index.html';
const SIZES = [16, 32, 48, 128];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpJson(p, method = 'GET') {
  const res = await fetch(`http://127.0.0.1:${PORT}${p}`, { method });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

class Session {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
    return this;
  }
  send(method, params = {}, ms = 60000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); } }, ms);
    });
  }
  async evaluate(expression, ms = 60000) {
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, ms);
    if (res.exceptionDetails) {
      throw new Error('page threw: ' + res.exceptionDetails.text + ' :: ' +
        ((res.exceptionDetails.exception && res.exceptionDetails.exception.description) || ''));
    }
    return res.result.value;
  }
}

let version = null;
for (let i = 0; i < 40; i++) {
  try { version = await httpJson('/json/version'); break; } catch { await sleep(500); }
}
if (!version) { console.log('browser not reachable'); process.exit(1); }

const browser = await new Session(version.webSocketDebuggerUrl).open();
const page = await httpJson('/json/new?' + encodeURIComponent(PAGE), 'PUT');
await sleep(2000);
const list = await httpJson('/json/list');
const target = list.find((t) => t.url.startsWith('file:///') && t.url.includes('icon-lab'));
if (!target) { console.log('page not open'); process.exit(1); }

const s = await new Session(target.webSocketDebuggerUrl).open();
await s.send('Runtime.enable');
await sleep(800);

const designs = await s.evaluate(`JSON.stringify(ICONS.map((i) => ({ id: i.id, name: i.name })))`);
const icons = JSON.parse(designs);
console.log('designs on page:', icons.length);

const payload = await s.evaluate(`(async () => {
  const SIZES = ${JSON.stringify(SIZES)};
  const SS = 4;
  const out = [];
  const load = (svg) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('svg load failed'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  for (const icon of ICONS) {
    const files = [];
    for (const size of SIZES) {
      const big = size * SS;
      const img = await load(iconSvg(icon, big));
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, size, size);
      files.push({ size, data: canvas.toDataURL('image/png') });
    }
    out.push({ id: icon.id, files });
  }
  return JSON.stringify(out);
})()`);

const rendered = JSON.parse(payload);
let written = 0;
for (const icon of rendered) {
  const dir = path.join(LAB, 'sets', icon.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of icon.files) {
    const base64 = file.data.replace(/^data:image\/png;base64,/, '');
    const out = path.join(dir, `icon${file.size}.png`);
    fs.writeFileSync(out, Buffer.from(base64, 'base64'));
    written++;
  }
  console.log('wrote', icon.id, icon.files.map((f) => f.size + 'px').join(' '));
}
console.log('\nfiles written:', written);
process.exit(0);
