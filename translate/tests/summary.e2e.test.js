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

function startFixtureServer() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      let body = '';
      for await (const chunk of request) body += chunk;
      requests.push(JSON.parse(body || '{}'));
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: '# 测试摘要\n\n- 延迟加载的正文已总结' } }],
        })
      );
      return;
    }

    if (request.url === '/slow') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>延迟文章</title></head>
<body>
  <article id="article"><h1>延迟文章</h1></article>
  <script>
    setTimeout(() => {
      const article = document.getElementById('article');
      for (let index = 1; index <= 6; index++) {
        const paragraph = document.createElement('p');
        paragraph.textContent =
          '第 ' + index + ' 段：延迟加载的正文，用来验证总结全文会等到文章渲染完成再读取。';
        article.appendChild(paragraph);
      }
    }, 900);
  </script>
</body>
</html>`);
      return;
    }

    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('not found');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, baseUrl: 'http://127.0.0.1:' + address.port, requests });
    });
  });
}

async function safeRemoveProfile(profile) {
  const resolved = path.resolve(profile);
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  if (!resolved.startsWith(tempRoot) || !path.basename(resolved).startsWith('ai-extension-summary-')) {
    throw new Error('Refusing to remove unexpected profile path: ' + resolved);
  }
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      fs.rmSync(resolved, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error.code !== 'EPERM' && error.code !== 'EBUSY') throw error;
      await wait(250);
    }
  }
}

test('summary waits for late article content and answers from the page', {
  timeout: 90000,
  skip: findEdge() ? false : 'Microsoft Edge is not installed',
}, async () => {
  const fixture = await startFixtureServer();
  const debugPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-extension-summary-'));
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
  let worker = null;
  let page = null;
  try {
    await waitForJson('http://127.0.0.1:' + debugPort + '/json/version', 15000);
    const version = await waitForJson('http://127.0.0.1:' + debugPort + '/json/version', 1000);
    browser = await new CdpClient(version.webSocketDebuggerUrl).open();
    const loaded = await browser.send('Extensions.loadUnpacked', { path: REPO_ROOT });
    const extensionId = loaded && loaded.id;
    assert.ok(extensionId, 'Edge did not return an extension id');

    await browser.send('Target.createTarget', {
      url: 'chrome-extension://' + extensionId + '/translate/options.html',
      background: true,
    });

    const deadline = Date.now() + 15000;
    let workerTarget = null;
    while (Date.now() < deadline && !workerTarget) {
      const targets = await waitForJson('http://127.0.0.1:' + debugPort + '/json/list', 2000);
      workerTarget = targets.find((target) =>
        target.type === 'service_worker' &&
        target.url.startsWith('chrome-extension://' + extensionId + '/')
      );
      if (!workerTarget) await wait(150);
    }
    assert.ok(workerTarget, 'extension service worker did not start\n' + edgeLog.slice(-2000));

    worker = await new CdpClient(workerTarget.webSocketDebuggerUrl).open();
    await worker.send('Runtime.enable');
    /* The options page reads its defaults once; let that write land before
     * replacing the settings with the fixture model. */
    await wait(1000);
    const settings = {
      translateModelId: 'mock-summary',
      subtitleModelId: '',
      models: [{
        id: 'mock-summary',
        name: 'Mock summary',
        kind: 'cloud',
        baseUrl: fixture.baseUrl + '/v1',
        apiKey: 'test-key',
        model: 'mock-summary',
        dialect: 'chat',
      }],
      targetLang: 'zh-CN',
      displayMode: 'replace',
      autoTranslateSelection: false,
      disableThinking: true,
      autoTranslateAll: false,
      blockedSites: [],
      glossary: [],
      subtitleEnabled: false,
      modelStamp: 'local-translategemma-2026-09',
      layoutStamp: 'inline-2026-09',
    };
    const configured = await worker.send('Runtime.evaluate', {
      expression: `chrome.storage.local.set({ translateSettings: ${JSON.stringify(settings)} })`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (configured.exceptionDetails) {
      throw new Error(
        (configured.exceptionDetails.exception && configured.exceptionDetails.exception.description) ||
        configured.exceptionDetails.text ||
        'failed to configure the extension'
      );
    }

    const pageUrl = fixture.baseUrl + '/slow';
    await browser.send('Target.createTarget', { url: pageUrl });
    let pageTarget = null;
    const pageDeadline = Date.now() + 15000;
    while (Date.now() < pageDeadline && !pageTarget) {
      const targets = await waitForJson('http://127.0.0.1:' + debugPort + '/json/list', 2000);
      pageTarget = targets.find((target) => target.type === 'page' && target.url === pageUrl);
      if (!pageTarget) await wait(150);
    }
    assert.ok(pageTarget, 'fixture page did not open');

    page = await new CdpClient(pageTarget.webSocketDebuggerUrl).open();
    await page.send('Runtime.enable');

    const started = await worker.send('Runtime.evaluate', {
      expression: `(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((item) => item.url === ${JSON.stringify(pageUrl)});
        if (!tab) return { error: 'fixture tab not found' };
        let ping = null;
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          ping = await chrome.tabs.sendMessage(tab.id, { type: 'translate:ping' }).catch(() => null);
          if (ping && ping.ok) break;
          await sleep(100);
        }
        await summarizeIntoPanel(tab);
        return { ping, tabId: tab.id };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (started.exceptionDetails) {
      throw new Error(started.exceptionDetails.text || 'summary trigger failed');
    }
    assert.equal(
      started.result.value.ping && started.result.value.ping.ok,
      true,
      'summary.js was not present before the context-menu click'
    );

    const rendered = await page.send('Runtime.evaluate', {
      expression: `(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const deadline = Date.now() + 25000;
        let text = '';
        while (Date.now() < deadline) {
          const host = document.getElementById('codex-summary-page');
          const panel = host && host.shadowRoot && host.shadowRoot.querySelector('.panel');
          text = panel ? panel.innerText : '';
          if (text.includes('测试摘要')) break;
          await sleep(150);
        }
        return {
          text,
          ready: document.documentElement.getAttribute('data-codex-summary'),
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (rendered.exceptionDetails) {
      throw new Error(rendered.exceptionDetails.text || 'summary panel read failed');
    }
    const panel = rendered.result.value;
    assert.equal(panel.ready, 'ready');
    assert.ok(panel.text.includes('测试摘要'), 'summary panel did not show the model result: ' + panel.text);
    assert.ok(panel.text.includes('延迟加载的正文已总结'));

    assert.equal(fixture.requests.length, 1, 'summary should make one model call');
    const userMessage = (fixture.requests[0].messages || [])
      .filter((message) => message.role === 'user')
      .pop();
    assert.ok(
      userMessage && userMessage.content.includes('延迟加载的正文'),
      'summary request did not include the late article text'
    );
  } finally {
    if (browser) {
      try { await browser.send('Browser.close'); } catch (error) {}
      browser.close();
    }
    if (worker) worker.close();
    if (page) page.close();
    await wait(300);
    if (edge.pid) {
      spawnSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    }
    await new Promise((resolve) => fixture.server.close(resolve));
    await safeRemoveProfile(profile);
  }
});
