const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'page-inspector.js'),
  'utf8'
);

function createHarness(options = {}) {
  const listeners = { updated: [], removed: [] };
  const tabUrls = new Map();
  const calls = { create: [], remove: [], execute: [], update: [] };
  let nextTabId = 100;

  const chrome = {
    tabs: {
      async create(properties) {
        calls.create.push(properties);
        const id = nextTabId++;
        tabUrls.set(id, properties.url);
        return { id };
      },
      async get(id) {
        if (!tabUrls.has(id)) throw new Error('No tab with id: ' + id);
        return { id, status: 'complete' };
      },
      async update(id, properties) {
        calls.update.push({ id, properties });
      },
      async remove(id) {
        calls.remove.push(id);
        tabUrls.delete(id);
      },
      onUpdated: {
        addListener(listener) { listeners.updated.push(listener); },
        removeListener(listener) {
          const index = listeners.updated.indexOf(listener);
          if (index >= 0) listeners.updated.splice(index, 1);
        },
      },
      onRemoved: {
        addListener(listener) { listeners.removed.push(listener); },
        removeListener(listener) {
          const index = listeners.removed.indexOf(listener);
          if (index >= 0) listeners.removed.splice(index, 1);
        },
      },
    },
    scripting: {
      async executeScript(details) {
        const url = tabUrls.get(details.target.tabId);
        calls.execute.push({ details, url });
        if (options.executeError) throw new Error(options.executeError);
        const page = options.page || {
          title: '番茄牛腩家常做法',
          description: '牛腩、番茄和香料的家常菜谱',
          keywords: '牛腩,番茄,菜谱',
          headings: ['番茄牛腩'],
          snippet: '牛腩焯水后与番茄一起炖煮，加入盐和香料。',
          textLength: 260,
          finalUrl: url,
        };
        return [{ result: page }];
      },
    },
  };

  const context = vm.createContext({
    URL,
    chrome,
    clearTimeout,
    console,
    self: {},
    setTimeout,
  });
  vm.runInContext(SOURCE, context, { filename: 'page-inspector.js' });
  return { api: context.self.CodexBookmarkPageInspector, calls };
}

test('opens an inactive tab, reads the rendered page, and closes it', async () => {
  const harness = createHarness();
  const progress = [];
  const result = await harness.api.inspectBookmarks([
    { id: 'one', name: '今日推荐', url: 'https://example.test/article#top' },
  ], {
    onProgress(value) { progress.push(value); },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(harness.calls.create)), [{
    url: 'https://example.test/article#top',
    active: false,
  }]);
  assert.equal(harness.calls.remove.length, 1);
  assert.equal(harness.calls.execute.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(progress.at(-1))), {
    total: 1,
    done: 1,
    read: 1,
    partial: 0,
    failed: 0,
  });
  assert.equal(result.bookmarks[0].pageReadState, 'read');
  assert.match(result.bookmarks[0].pageSnippet, /番茄/);
  assert.equal(result.bookmarks[0].pageTitle, '番茄牛腩家常做法');
});

test('caches duplicate URLs and still closes every temporary tab', async () => {
  const harness = createHarness();
  const result = await harness.api.inspectBookmarks([
    { id: 'one', name: '甲', url: 'https://example.test/post#one' },
    { id: 'two', name: '乙', url: 'https://example.test/post#two' },
  ], { concurrency: 2 });

  assert.equal(harness.calls.create.length, 1);
  assert.equal(harness.calls.execute.length, 1);
  assert.equal(harness.calls.remove.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.stats)),
    { total: 2, done: 2, read: 2, partial: 0, failed: 0 }
  );
});

test('marks unreadable pages as failed and never leaves a tab behind', async () => {
  const harness = createHarness({ executeError: 'Cannot access contents of the page' });
  const result = await harness.api.inspectBookmarks([
    { id: 'one', name: '受限页面', url: 'https://example.test/private' },
  ]);

  assert.equal(result.bookmarks[0].pageReadState, 'failed');
  assert.match(result.bookmarks[0].pageReadError, /Cannot access contents/);
  assert.equal(result.stats.failed, 1);
  assert.equal(harness.calls.remove.length, 1);
});

test('rejects non-http bookmarks without creating a tab', async () => {
  const harness = createHarness();
  const result = await harness.api.inspectBookmarks([
    { id: 'one', name: '本地文件', url: 'file:///C:/secret.html' },
  ]);

  assert.equal(harness.calls.create.length, 0);
  assert.equal(result.bookmarks[0].pageReadState, 'failed');
  assert.match(result.bookmarks[0].pageReadError, /不是可打开的网页地址/);
});
