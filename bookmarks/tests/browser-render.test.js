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

async function startFixtureServer() {
  const prompts = [];
  const server = http.createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body || '{}');
      const prompt = (payload.messages || []).map((message) => message.content).join('\n');
      prompts.push(prompt);
      const id = (prompt.match(/\[ID:([^\]]+)\]/) || [null, 'unknown'])[1];
      const category = prompt.includes('番茄牛腩') ? '美食' : '工具';
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify([{ id, category }]),
          },
        }],
      }));
      return;
    }

    if (request.url === '/dynamic') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html>
<html lang="zh-CN">
<head><title>今日推荐</title></head>
<body>
  <nav>首页 登录 注册</nav>
  <main id="app">正在加载...</main>
  <footer>版权信息</footer>
  <script>
    setTimeout(() => {
      document.title = '番茄牛腩家常做法';
      document.querySelector('#app').innerHTML =
        '<article><h1>番茄牛腩家常做法</h1>' +
        '<p>牛腩焯水后与番茄慢炖，加入洋葱、盐和少量香料。</p>' +
        '<h2>准备材料</h2><p>牛腩、番茄、洋葱、姜片、盐。</p></article>';
    }, 900);
  </script>
</body>
</html>`);
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
    prompts,
    baseUrl: 'http://127.0.0.1:' + address.port,
  };
}

function safeRemoveProfile(profile) {
  const resolved = path.resolve(profile);
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  if (!resolved.startsWith(tempRoot) || !path.basename(resolved).startsWith('ai-extension-render-')) {
    throw new Error('Refusing to remove unexpected profile path: ' + resolved);
  }
  fs.rmSync(resolved, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}

test('dynamic page content reaches classification from a real rendered tab', {
  timeout: 90000,
  skip: findEdge() ? false : 'Microsoft Edge is not installed',
}, async () => {
  const fixture = await startFixtureServer();
  const debugPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-extension-render-'));
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
    const expression = `(async () => {
      const progress = [];
      const results = await self.CodexBookmarks.classifyBookmarks(
        [{ id: 'dynamic', name: '今日推荐', url: ${JSON.stringify(fixture.baseUrl + '/dynamic')} }],
        {
          categories: [{ name: '美食', children: [] }, { name: '工具', children: [] }],
          model: {
            baseUrl: ${JSON.stringify(fixture.baseUrl + '/v1')},
            model: 'mock-model',
            apiKey: 'test-key'
          },
          disableThinking: true
        },
        (value) => progress.push(value)
      );
      const tabs = await chrome.tabs.query({});
      return {
        results,
        progress,
        pageTabs: tabs.filter((tab) => tab.url === ${JSON.stringify(fixture.baseUrl + '/dynamic')}).length
      };
    })()`;
    const evaluated = await worker.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (evaluated.exceptionDetails) {
      throw new Error(evaluated.exceptionDetails.text || 'worker evaluation failed');
    }
    const value = evaluated.result.value;

    assert.deepEqual(value.results, [{ id: 'dynamic', category: ['美食'] }]);
    assert.ok(value.progress.some((entry) =>
      entry.kind === 'inspect' && entry.done === 1 && entry.total === 1 && entry.read === 1
    ));
    assert.ok(fixture.prompts.some((prompt) => prompt.includes('番茄牛腩') && prompt.includes('牛腩焯水')));
    assert.equal(value.pageTabs, 0, 'temporary inspection tab was not closed');
  } finally {
    if (browser) {
      try { await browser.send('Browser.close'); } catch (error) {}
      browser.close();
    }
    if (worker) worker.close();
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

test('bookmark automation uses one linked switch in the real settings page', {
  timeout: 60000,
  skip: findEdge() ? false : 'Microsoft Edge is not installed',
}, async () => {
  const debugPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-extension-render-'));
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
    await waitForJson('http://127.0.0.1:' + debugPort + '/json/version', 15000);
    const version = await waitForJson('http://127.0.0.1:' + debugPort + '/json/version', 1000);
    browser = await new CdpClient(version.webSocketDebuggerUrl).open();
    const loaded = await browser.send('Extensions.loadUnpacked', { path: REPO_ROOT });
    const extensionId = loaded && loaded.id;
    assert.ok(extensionId, 'Edge did not return an extension id');

    const url = 'chrome-extension://' + extensionId + '/translate/options.html';
    await browser.send('Target.createTarget', { url, background: true });
    const deadline = Date.now() + 15000;
    let pageTarget = null;
    while (Date.now() < deadline && !pageTarget) {
      const targets = await waitForJson('http://127.0.0.1:' + debugPort + '/json/list', 2000);
      pageTarget = targets.find((target) => target.type === 'page' && target.url === url);
      if (!pageTarget) await wait(150);
    }
    assert.ok(pageTarget, 'settings page did not open\n' + edgeLog.slice(-2000));

    page = await new CdpClient(pageTarget.webSocketDebuggerUrl).open();
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1200,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const expression = `(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (predicate, timeout = 5000) => {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          if (predicate()) return;
          await sleep(50);
        }
        throw new Error('UI condition timed out');
      };

      await waitFor(() => document.readyState === 'complete' && document.getElementById('bmAutoAll'));
      document.querySelector('[data-pane="bookmarks"]').click();
      await waitFor(() => document.getElementById('bmBarCount').textContent !== '—');

      const autoBlock = Array.from(document.querySelectorAll('#view-bookmarks .bm-block'))
        .find((block) => block.querySelector('h3')?.textContent.trim() === '自动');
      const oldSwitches = ['bmAutoClassify', 'bmAutoRename', 'bmAutoDedupe']
        .filter((id) => document.getElementById(id)).length;
      const initial = {
        switches: autoBlock.querySelectorAll('.switch').length,
        on: document.getElementById('bmAutoAll').getAttribute('aria-checked'),
        intervalHidden: document.getElementById('bmIntervalRow').hidden,
      };

      document.getElementById('bmAutoAll').click();
      await waitFor(() => {
        const button = document.getElementById('bmAutoAll');
        return button.getAttribute('aria-checked') === 'true' &&
          !document.getElementById('bmIntervalRow').hidden;
      });
      await sleep(100);
      const storedOn = await chrome.storage.local.get('bookmarkSettings');
      const enabled = {
        on: document.getElementById('bmAutoAll').getAttribute('aria-checked'),
        intervalHidden: document.getElementById('bmIntervalRow').hidden,
        stored: storedOn.bookmarkSettings,
      };

      document.getElementById('bmAutoAll').click();
      await waitFor(() => {
        const button = document.getElementById('bmAutoAll');
        return button.getAttribute('aria-checked') === 'false' &&
          document.getElementById('bmIntervalRow').hidden;
      });
      const disabled = {
        on: document.getElementById('bmAutoAll').getAttribute('aria-checked'),
        intervalHidden: document.getElementById('bmIntervalRow').hidden,
      };
      return { initial, oldSwitches, enabled, disabled };
    })()`;
    const evaluated = await page.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (evaluated.exceptionDetails) {
      throw new Error(evaluated.exceptionDetails.text || 'settings page evaluation failed');
    }
    const value = evaluated.result.value;

    assert.equal(value.initial.switches, 1);
    assert.equal(value.oldSwitches, 0);
    assert.equal(value.initial.on, 'false');
    assert.equal(value.initial.intervalHidden, true);
    assert.equal(value.enabled.on, 'true');
    assert.equal(value.enabled.intervalHidden, false);
    assert.equal(value.enabled.stored.autoEnabled, true);
    assert.equal('autoClassify' in value.enabled.stored, false);
    assert.equal('autoRename' in value.enabled.stored, false);
    assert.equal('autoDedupe' in value.enabled.stored, false);
    assert.equal(value.disabled.on, 'false');
    assert.equal(value.disabled.intervalHidden, true);

    const shotTarget = process.env.AI_EXTENSION_UI_SHOT;
    if (shotTarget) {
      await page.send('Runtime.evaluate', {
        expression: `document.getElementById('bmAutoAll').closest('.bm-block').scrollIntoView({ block: 'center' })`,
      });
      await wait(150);
      const screenshot = await page.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.resolve(shotTarget), Buffer.from(screenshot.data, 'base64'));
    }
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
    safeRemoveProfile(profile);
  }
});
