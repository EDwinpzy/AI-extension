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
  const translations = new Map([
    ['Alpha beta', '阿尔法 贝塔'],
    ['First line', '第一行'],
    ['Second line', '第二行'],
    ['Hello world today', '你好 世界 今天'],
    ['Line one Line two', '第一行 第二行'],
  ]);
  const server = http.createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body || '{}');
      const user = (payload.messages || []).filter((message) => message.role === 'user').pop();
      const source = String((user && user.content) || '');
      const lines = [];
      const numbered = /^\s*\[(\d+)\]\s*(.*)$/gm;
      let match;
      while ((match = numbered.exec(source))) {
        const index = Number(match[1]);
        const text = match[2].trim();
        lines[index - 1] = '[' + index + '] ' + (translations.get(text) || ('译文' + index));
      }
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        choices: [{ message: { content: lines.filter(Boolean).join('\n') } }],
      }));
      return;
    }

    if (request.url === '/format') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Format fixture</title></head>
<body>
  <p id="spaced">  Alpha   beta  </p>
  <p id="lines">First line<br>Second line</p>
  <p id="pre" style="white-space: pre-wrap">  Line one
  Line two  </p>
  <p id="inline">Hello <strong>world</strong> today</p>
</body>
</html>`);
      return;
    }

    if (request.url === '/long') {
      const paragraphs = Array.from({ length: 520 }, (_, index) => {
        const number = index + 1;
        return '<p id="block-' + number + '">Community story ' + number +
          ': a long page keeps adding readable paragraphs below the first screen.</p>';
      }).join('\n');
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Long fixture</title></head>
<body>${paragraphs}</body>
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
      resolve({ server, baseUrl: 'http://127.0.0.1:' + address.port });
    });
  });
}

async function safeRemoveProfile(profile) {
  const resolved = path.resolve(profile);
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  if (!resolved.startsWith(tempRoot) || !path.basename(resolved).startsWith('ai-extension-format-')) {
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

test('page translation keeps original spaces and line breaks', {
  timeout: 120000,
  skip: findEdge() ? false : 'Microsoft Edge is not installed',
}, async () => {
  const fixture = await startFixtureServer();
  const debugPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-extension-format-'));
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
  let longPage = null;
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
    const settings = {
      translateModelId: 'mock-format',
      subtitleModelId: '',
      models: [{
        id: 'mock-format',
        name: 'Mock format',
        kind: 'cloud',
        baseUrl: fixture.baseUrl + '/v1',
        apiKey: 'test-key',
        model: 'mock-format',
        dialect: 'chat',
      }],
      targetLang: 'zh-CN',
      displayMode: 'replace',
      autoTranslateSelection: false,
      disableThinking: true,
      autoTranslateAll: true,
      blockedSites: [],
      glossary: [],
      subtitleEnabled: false,
      modelStamp: 'local-translategemma-2026-09',
      layoutStamp: 'inline-2026-09',
    };
    let configured = null;
    const configDeadline = Date.now() + 10000;
    while (Date.now() < configDeadline) {
      configured = await worker.send('Runtime.evaluate', {
        expression: `chrome.storage.local.set({ translateSettings: ${JSON.stringify(settings)} })`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (!configured.exceptionDetails) break;
      await wait(150);
    }
    if (configured.exceptionDetails) {
      throw new Error(
        (configured.exceptionDetails.exception && configured.exceptionDetails.exception.description) ||
        configured.exceptionDetails.text ||
        'failed to configure the extension'
      );
    }

    const fixtureUrl = fixture.baseUrl + '/format';
    await browser.send('Target.createTarget', { url: fixtureUrl });
    let pageTarget = null;
    const pageDeadline = Date.now() + 15000;
    while (Date.now() < pageDeadline && !pageTarget) {
      const targets = await waitForJson('http://127.0.0.1:' + debugPort + '/json/list', 2000);
      pageTarget = targets.find((target) => target.type === 'page' && target.url === fixtureUrl);
      if (!pageTarget) await wait(150);
    }
    assert.ok(pageTarget, 'fixture page did not open');

    page = await new CdpClient(pageTarget.webSocketDebuggerUrl).open();
    await page.send('Runtime.enable');
    const translated = await page.send('Runtime.evaluate', {
      expression: `(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
          const lines = document.getElementById('lines');
          if (
            document.getElementById('spaced').hasAttribute('data-codex-translated') &&
            lines.textContent.includes('第一行') &&
            lines.textContent.includes('第二行') &&
            document.getElementById('pre').textContent.includes('第一行')
          ) break;
          await sleep(100);
        }
        const spaced = document.getElementById('spaced');
        const lines = document.getElementById('lines');
        const pre = document.getElementById('pre');
        const inline = document.getElementById('inline');
        return {
          spacedText: spaced.textContent,
          spacedNodes: Array.from(spaced.childNodes).map((node) => node.nodeValue),
          lineText: lines.textContent,
          lineChildren: Array.from(lines.childNodes).map((node) => ({
            type: node.nodeType,
            name: node.nodeName,
            value: node.nodeValue,
          })),
          preText: pre.textContent,
          inlineText: inline.textContent,
          strongText: inline.querySelector('strong').textContent,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (translated.exceptionDetails) {
      throw new Error(translated.exceptionDetails.text || 'fixture evaluation failed');
    }
    const value = translated.result.value;

    assert.equal(value.spacedText, '  阿尔法 贝塔  ', 'leading/trailing spaces changed');
    assert.deepEqual(value.spacedNodes, ['  阿尔法 贝塔  '], 'text node was split or trimmed');
    assert.equal(value.lineText, '第一行第二行', 'line translations were not both written');
    assert.equal(value.lineChildren.length, 3, 'line break was added or removed');
    assert.equal(value.lineChildren[0].value, '第一行');
    assert.equal(value.lineChildren[1].name, 'BR');
    assert.equal(value.lineChildren[2].value, '第二行');
    assert.equal(value.preText, '  第一行\n  第二行  ', 'pre-wrap line breaks changed');
    assert.equal(value.inlineText, '你好 世界 今天 ', 'inline block trailing space was lost');
    assert.equal(value.strongText, '', 'replaced inline text was left behind');

    const restored = await worker.send('Runtime.evaluate', {
      expression: `(async () => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((item) => item.url === ${JSON.stringify(fixtureUrl)});
        if (!tab) throw new Error('fixture tab not found');
        await chrome.tabs.sendMessage(tab.id, { type: 'translate:restore-page' });
        await new Promise((resolve) => setTimeout(resolve, 250));
        return { ok: true };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (restored.exceptionDetails) {
      throw new Error(restored.exceptionDetails.text || 'restore failed');
    }

    const original = await page.send('Runtime.evaluate', {
      expression: `(() => {
        const spaced = document.getElementById('spaced');
        const lines = document.getElementById('lines');
        const pre = document.getElementById('pre');
        const inline = document.getElementById('inline');
        return {
          spacedText: spaced.textContent,
          lineHtml: lines.innerHTML,
          preText: pre.textContent,
          inlineText: inline.textContent,
          strongText: inline.querySelector('strong').textContent,
          marked: document.querySelectorAll('[data-codex-translated]').length,
        };
      })()`,
      returnByValue: true,
    });
    const restoredValue = original.result.value;
    assert.equal(restoredValue.spacedText, '  Alpha   beta  ', 'restore did not recover exact spaces');
    assert.equal(restoredValue.lineHtml, 'First line<br>Second line', 'restore changed line breaks');
    assert.equal(restoredValue.preText, '  Line one\n  Line two  ', 'restore changed pre-wrap lines');
    assert.equal(restoredValue.inlineText, 'Hello world today', 'restore did not recover inline text');
    assert.equal(restoredValue.strongText, 'world', 'restore did not recover inline markup');
    assert.equal(restoredValue.marked, 0, 'translation marks were left behind');

    const bilingual = await worker.send('Runtime.evaluate', {
      expression: `(async () => {
        const bag = await chrome.storage.local.get('translateSettings');
        bag.translateSettings.displayMode = 'bilingual';
        await chrome.storage.local.set({ translateSettings: bag.translateSettings });
        await new Promise((resolve) => setTimeout(resolve, 200));
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((item) => item.url === ${JSON.stringify(fixtureUrl)});
        if (!tab) throw new Error('fixture tab not found');
        await chrome.tabs.sendMessage(tab.id, { type: 'translate:translate-page' });
        return { ok: true };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (bilingual.exceptionDetails) {
      throw new Error(bilingual.exceptionDetails.text || 'bilingual translation failed');
    }

    const bilingualValue = await page.send('Runtime.evaluate', {
      expression: `(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
          const lines = document.getElementById('lines');
          if (lines.textContent.includes('第一行') && lines.textContent.includes('第二行')) break;
          await sleep(100);
        }
        const spaced = document.getElementById('spaced');
        const lines = document.getElementById('lines');
        const pre = document.getElementById('pre');
        const inline = document.getElementById('inline');
        return {
          spacedText: spaced.textContent,
          lineChildren: Array.from(lines.childNodes).map((node) => ({
            type: node.nodeType,
            name: node.nodeName,
            value: node.nodeValue,
          })),
          preText: pre.textContent,
          inlineText: inline.textContent,
          strongText: inline.querySelector('strong').textContent,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (bilingualValue.exceptionDetails) {
      throw new Error(bilingualValue.exceptionDetails.text || 'bilingual evaluation failed');
    }
    const bilingualState = bilingualValue.result.value;
    assert.ok(
      bilingualState.spacedText.startsWith('  Alpha   beta  '),
      'bilingual mode changed the original spacing'
    );
    assert.ok(bilingualState.spacedText.includes('阿尔法 贝塔'));
    assert.equal(bilingualState.lineChildren.length, 3, 'bilingual mode changed line breaks');
    assert.ok(bilingualState.lineChildren[0].value.startsWith('First line'));
    assert.equal(bilingualState.lineChildren[1].name, 'BR');
    assert.ok(bilingualState.lineChildren[2].value.startsWith('Second line'));
    assert.ok(bilingualState.preText.startsWith('  Line one\n  Line two  '));
    assert.ok(bilingualState.inlineText.startsWith('Hello world today'));
    assert.equal(bilingualState.strongText, 'world', 'bilingual mode changed inline markup');

    await worker.send('Runtime.evaluate', {
      expression: `(async () => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((item) => item.url === ${JSON.stringify(fixtureUrl)});
        if (!tab) throw new Error('fixture tab not found');
        await chrome.tabs.sendMessage(tab.id, { type: 'translate:restore-page' });
        return { ok: true };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });

    /*
     * A long page is capped at 500 units per pass. The rest has to be picked
     * up by scrolling, not by a childList mutation: this fixture never adds a
     * node after load.
     */
    const longUrl = fixture.baseUrl + '/long';
    await browser.send('Target.createTarget', { url: longUrl });
    let longTarget = null;
    const longDeadline = Date.now() + 15000;
    while (Date.now() < longDeadline && !longTarget) {
      const targets = await waitForJson('http://127.0.0.1:' + debugPort + '/json/list', 2000);
      longTarget = targets.find((target) => target.type === 'page' && target.url === longUrl);
      if (!longTarget) await wait(150);
    }
    assert.ok(longTarget, 'long fixture page did not open');

    longPage = await new CdpClient(longTarget.webSocketDebuggerUrl).open();
    await longPage.send('Runtime.enable');
    const initialLong = await longPage.send('Runtime.evaluate', {
      expression: `(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          if (document.querySelectorAll('[data-codex-translated]').length >= 480) break;
          await sleep(100);
        }
        return {
          marked: document.querySelectorAll('[data-codex-translated]').length,
          bottomMarked: document.getElementById('block-520').hasAttribute('data-codex-translated'),
          height: document.documentElement.scrollHeight,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (initialLong.exceptionDetails) {
      throw new Error(initialLong.exceptionDetails.text || 'long fixture evaluation failed');
    }
    const beforeScroll = initialLong.result.value;
    assert.ok(beforeScroll.marked >= 480, 'initial pass did not translate the first 500 blocks');
    assert.equal(beforeScroll.bottomMarked, false, 'bottom block was translated before it was reached');

    const scrolled = await longPage.send('Runtime.evaluate', {
      expression: `(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        return { y: window.scrollY, height: document.documentElement.scrollHeight };
      })()`,
      returnByValue: true,
    });
    if (scrolled.exceptionDetails) {
      throw new Error(scrolled.exceptionDetails.text || 'long fixture scroll failed');
    }
    assert.ok(scrolled.result.value.y > 0, 'long fixture did not scroll');

    const afterScroll = await longPage.send('Runtime.evaluate', {
      expression: `(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const deadline = Date.now() + 25000;
        while (Date.now() < deadline) {
          if (document.getElementById('block-520').hasAttribute('data-codex-translated')) break;
          await sleep(150);
        }
        return {
          marked: document.getElementById('block-520').hasAttribute('data-codex-translated'),
          text: document.getElementById('block-520').textContent,
          state: document.documentElement.getAttribute('data-codex-translate-state'),
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (afterScroll.exceptionDetails) {
      throw new Error(afterScroll.exceptionDetails.text || 'long fixture catch-up failed');
    }
    const afterValue = afterScroll.result.value;
    assert.equal(
      afterValue.marked,
      true,
      'scrolling did not translate the next batch: ' + JSON.stringify(afterValue)
    );
  } finally {
    if (browser) {
      try { await browser.send('Browser.close'); } catch (error) {}
      browser.close();
    }
    if (worker) worker.close();
    if (page) page.close();
    if (longPage) longPage.close();
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
