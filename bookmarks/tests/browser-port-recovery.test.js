const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

function findEdge() {
  return EDGE_PATHS.find((candidate) => fs.existsSync(candidate)) || '';
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJson(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch (error) {
      lastError = error;
    }
    await wait(150);
  }
  throw lastError || new Error('Timed out waiting for ' + url);
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.ws = null;
  }

  async open() {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const job = this.pending.get(message.id);
      if (!job) return;
      this.pending.delete(message.id);
      if (message.error) job.reject(new Error(message.error.message || 'CDP error'));
      else job.resolve(message.result);
    });
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    return this;
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

function safeRemoveProfile(profile) {
  const resolved = path.resolve(profile);
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  if (!resolved.startsWith(tempRoot) || !path.basename(resolved).startsWith('ai-extension-port-')) {
    throw new Error('Refusing to remove unexpected profile path: ' + resolved);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function startFixtureServer() {
  const server = http.createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body || '{}');
      const prompt = (payload.messages || []).map((message) => message.content).join('\n');
      const id = (prompt.match(/\[ID:([^\]]+)\]/) || [null, 'unknown'])[1];
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify([{ id, category: '学习' }]) } }],
      }));
      return;
    }
    if (request.url === '/article') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html><head><title>PyTorch 教程</title></head>
<body><nav>首页</nav><main><article><h1>PyTorch 入门教程</h1>
<p>本文介绍张量、自动求导、神经网络训练和模型部署的完整学习流程。</p>
<h2>课程内容</h2><p>包含代码示例、练习和进阶阅读资料。</p></article></main></body></html>`);
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('not found');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    server,
    baseUrl: 'http://127.0.0.1:' + address.port,
  };
}

test('reconnects after the bookmark service worker is stopped', {
  timeout: 60000,
  skip: findEdge() ? false : 'Microsoft Edge is not installed',
}, async () => {
  const fixture = await startFixtureServer();
  const debugPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-extension-port-'));
  const edge = spawn(findEdge(), [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-unsafe-extension-debugging',
    '--remote-debugging-port=' + debugPort,
    '--user-data-dir=' + profile,
    'about:blank',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let edgeLog = '';
  edge.stdout.on('data', (chunk) => { edgeLog += chunk; });
  edge.stderr.on('data', (chunk) => { edgeLog += chunk; });

  let browser = null;
  let page = null;
  try {
    const version = await waitForJson('http://127.0.0.1:' + debugPort + '/json/version', 15000);
    browser = await new CdpClient(version.webSocketDebuggerUrl).open();
    const loaded = await browser.send('Extensions.loadUnpacked', { path: REPO_ROOT });
    const extensionId = loaded && loaded.id;
    assert.ok(extensionId, 'Edge did not return an extension id');

    const optionsUrl = 'chrome-extension://' + extensionId + '/translate/options.html';
    const created = await browser.send('Target.createTarget', {
      url: optionsUrl,
      background: true,
    });

    let pageTarget = null;
    let workerTarget = null;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && (!pageTarget || !workerTarget)) {
      const targets = await waitForJson('http://127.0.0.1:' + debugPort + '/json/list', 2000);
      pageTarget = pageTarget || targets.find((target) => target.id === created.targetId);
      workerTarget = workerTarget || targets.find((target) =>
        target.type === 'service_worker' &&
        target.url.startsWith('chrome-extension://' + extensionId + '/')
      );
      if (!pageTarget || !workerTarget) await wait(150);
    }
    assert.ok(pageTarget, 'options page did not open');
    assert.ok(workerTarget, 'extension service worker did not start\n' + edgeLog.slice(-2000));

    page = await new CdpClient(pageTarget.webSocketDebuggerUrl).open();
    await page.send('Runtime.enable');

    const readyDeadline = Date.now() + 8000;
    let ready = false;
    while (Date.now() < readyDeadline && !ready) {
      const state = await page.send('Runtime.evaluate', {
        expression: `({
          ready: document.readyState,
          count: document.getElementById('bmBarCount')?.textContent || ''
        })`,
        returnByValue: true,
      });
      ready = state.result.value.ready === 'complete' && state.result.value.count !== '—';
      if (!ready) await wait(100);
    }
    assert.ok(ready, 'bookmark panel did not finish its first connection');

    const articleUrl = fixture.baseUrl + '/article';
    await page.send('Runtime.evaluate', {
      expression: `(async () => {
        await chrome.storage.local.set({
          translateSettings: {
            translateModelId: 'mock',
            models: [{
              id: 'mock',
              name: 'Mock model',
              kind: 'cloud',
              baseUrl: ${JSON.stringify(fixture.baseUrl + '/v1')},
              apiKey: '',
              model: 'mock'
            }],
            disableThinking: true
          }
        });
        await chrome.bookmarks.create({
          parentId: '1',
          title: 'PyTorch 教程',
          url: ${JSON.stringify(articleUrl)}
        });
        return true;
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });

    const stopped = await browser.send('Target.closeTarget', {
      targetId: workerTarget.id,
    });
    assert.equal(stopped.success, true, 'could not stop the bookmark service worker');
    await wait(500);

    await page.send('Runtime.evaluate', {
      expression: `document.getElementById('bmOrganize').click()`,
    });
    const resultDeadline = Date.now() + 15000;
    let visibleResult = { text: '', hidden: true, previewHidden: true, stats: '' };
    while (Date.now() < resultDeadline) {
      const result = await page.send('Runtime.evaluate', {
        expression: `({
          text: document.getElementById('bmResult')?.textContent || '',
          hidden: document.getElementById('bmResult')?.hidden,
          previewHidden: document.getElementById('bmPreview')?.hidden,
          stats: document.getElementById('bmPreviewStats')?.textContent || ''
        })`,
        returnByValue: true,
      });
      visibleResult = result.result.value;
      if ((!visibleResult.hidden && visibleResult.text) || !visibleResult.previewHidden) break;
      await wait(150);
    }

    assert.doesNotMatch(visibleResult.text, /disconnected port object/i);
    assert.equal(visibleResult.previewHidden, false, visibleResult.text || 'organize preview did not appear');
    assert.match(visibleResult.stats, /1 个书签/);
  } finally {
    if (browser) {
      try { await browser.send('Browser.close'); } catch (error) {}
      browser.close();
    }
    if (page) page.close();
    await wait(300);
    if (edge.pid) {
      spawnSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    }
    await new Promise((resolve) => fixture.server.close(resolve));
    safeRemoveProfile(profile);
  }
});
