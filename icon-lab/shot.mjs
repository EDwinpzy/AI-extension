/* Full-page screenshot of the preview, so the designs can be reviewed as a set. */
const PORT = process.env.CDP_PORT || 9224;
const OUT = process.env.OUT || 'D:/MyProjects/AI-extension/icon-lab/preview.png';
const URL = 'file:///D:/MyProjects/AI-extension/icon-lab/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
import fs from 'node:fs';

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
  send(method, params = {}, ms = 30000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); } }, ms);
    });
  }
}

const page = await httpJson('/json/new?' + encodeURIComponent(URL), 'PUT');
await sleep(1800);
const list = await httpJson('/json/list');
const target = list.find((t) => t.url.includes('icon-lab/index.html'));
const s = await new Session(target.webSocketDebuggerUrl).open();
await s.send('Page.enable');
await s.send('Emulation.setDeviceMetricsOverride', {
  width: 1240, height: 900, deviceScaleFactor: 1, mobile: false,
});
await sleep(700);
const metrics = await s.send('Page.getLayoutMetrics');
const height = Math.ceil(metrics.cssContentSize.height);
const shot = await s.send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: true,
  clip: { x: 0, y: 0, width: 1240, height, scale: 1 },
});
fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log('saved', OUT, 'height', height);
process.exit(0);
