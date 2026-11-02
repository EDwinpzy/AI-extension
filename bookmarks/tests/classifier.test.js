const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'classifier.js'),
  'utf8'
);

const CATEGORIES = [
  { name: '美食', children: [] },
  { name: '工具', children: [] },
];

function createHarness(options = {}) {
  const requests = [];
  const inspector = {
    async inspectBookmarks(bookmarks, inspectOptions) {
      let read = 0;
      let failed = 0;
      const enriched = bookmarks.map((bookmark) => {
        const isRead = options.pageState ? options.pageState(bookmark) : true;
        if (isRead) read++;
        else failed++;
        return {
          ...bookmark,
          pageTitle: isRead ? '番茄牛腩家常做法' : '',
          pageDescription: isRead ? '牛腩和番茄的详细菜谱' : '',
          pageKeywords: isRead ? '牛腩,番茄' : '',
          pageHeadings: isRead ? ['番茄牛腩'] : [],
          pageSnippet: isRead ? '牛腩焯水后与番茄慢炖，加入盐和香料。' : '',
          pageReadState: isRead ? 'read' : 'failed',
          pageReadError: isRead ? '' : '登录后才能查看',
        };
      });
      if (inspectOptions && inspectOptions.onProgress) {
        inspectOptions.onProgress({
          total: enriched.length,
          done: enriched.length,
          read,
          partial: 0,
          failed,
        });
      }
      return { bookmarks: enriched, stats: { total: enriched.length, done: enriched.length, read, partial: 0, failed } };
    },
  };

  const context = vm.createContext({
    AbortController,
    URL,
    clearTimeout,
    console,
    self: { CodexBookmarkPageInspector: inspector },
    setTimeout,
    DIALECT_CHAT: 'chat',
    dialectFor: () => 'chat',
    dialectRequest: (dialect, base, model, messages) => ({
      url: base + '/chat/completions',
      headers: {},
      body: { model, messages },
    }),
    openCodeSessionHeaders: async () => ({}),
    fetch: async (url, request) => {
      requests.push({ url, body: JSON.parse(request.body) });
      if (options.fetchError) throw new Error(options.fetchError);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            choices: [{
              message: {
                content: options.modelContent || '[{"id":"one","category":"美食"}]',
              },
            }],
          });
        },
      };
    },
  });
  vm.runInContext(SOURCE, context, { filename: 'classifier.js' });
  return { api: context.self.CodexBookmarks, requests };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('uses rendered page text in the model prompt', async () => {
  const harness = createHarness();
  const progress = [];
  const result = await harness.api.classifyBookmarks(
    [{ id: 'one', name: '今日推荐', url: 'https://example.test/dynamic' }],
    {
      categories: CATEGORIES,
      model: { baseUrl: 'https://model.test/v1', model: 'mock', apiKey: '' },
    },
    (value) => progress.push(value)
  );

  assert.deepEqual(plain(result), [{ id: 'one', category: ['美食'] }]);
  assert.equal(harness.requests.length, 1);
  const prompt = harness.requests[0].body.messages.map((message) => message.content).join('\n');
  assert.match(prompt, /番茄牛腩/);
  assert.match(prompt, /牛腩焯水/);
  assert.match(prompt, /不可信数据/);
  assert.ok(progress.some((entry) => entry.kind === 'inspect' && entry.read === 1));
  assert.ok(progress.some((entry) => entry.kind === 'classify' && entry.done === 1));
});

test('does not turn an unknown model category into 工具', async () => {
  const harness = createHarness({
    modelContent: '[{"id":"one","category":"模型临时发明的分类"}]',
  });
  const result = await harness.api.classifyBookmarks(
    [{ id: 'one', name: '今日推荐', url: 'https://example.test/dynamic' }],
    {
      categories: CATEGORIES,
      model: { baseUrl: 'https://model.test/v1', model: 'mock', apiKey: '' },
    }
  );

  assert.deepEqual(plain(result), []);
});

test('does not send unread pages to the classification model', async () => {
  const harness = createHarness({ pageState: () => false });
  const result = await harness.api.classifyBookmarks(
    [{ id: 'one', name: '登录页面', url: 'https://example.test/private' }],
    {
      categories: CATEGORIES,
      model: { baseUrl: 'https://model.test/v1', model: 'mock', apiKey: '' },
    }
  );

  assert.deepEqual(plain(result), []);
  assert.equal(harness.requests.length, 0);
});

test('custom instructions can still delete unread bookmarks by metadata', async () => {
  const harness = createHarness({
    pageState: () => false,
    modelContent: '[{"id":"one","action":"delete"}]',
  });
  const result = await harness.api.classifyBookmarks(
    [{
      id: 'one',
      name: '旧书签',
      url: 'https://example.test/private',
      dateAdded: Date.UTC(2020, 0, 1),
    }],
    {
      categories: CATEGORIES,
      instruction: '删除 2021 年以前添加的书签',
      model: { baseUrl: 'https://model.test/v1', model: 'mock', apiKey: '' },
    }
  );

  assert.deepEqual(plain(result), [{ id: 'one', action: 'delete' }]);
  assert.equal(harness.requests.length, 1);
});

test('custom instructions cannot classify an unread bookmark', async () => {
  const harness = createHarness({
    pageState: () => false,
    modelContent: '[{"id":"one","category":"美食"}]',
  });
  const result = await harness.api.classifyBookmarks(
    [{ id: 'one', name: '登录页面', url: 'https://example.test/private' }],
    {
      categories: CATEGORIES,
      instruction: '保留所有书签',
      model: { baseUrl: 'https://model.test/v1', model: 'mock', apiKey: '' },
    }
  );

  assert.deepEqual(plain(result), []);
});

test('model failures leave bookmarks unclassified', async () => {
  const harness = createHarness({ fetchError: 'network down' });
  const result = await harness.api.classifyBookmarks(
    [{ id: 'one', name: '今日推荐', url: 'https://example.test/dynamic' }],
    {
      categories: CATEGORIES,
      model: { baseUrl: 'https://model.test/v1', model: 'mock', apiKey: '' },
    }
  );

  assert.deepEqual(plain(result), []);
});
