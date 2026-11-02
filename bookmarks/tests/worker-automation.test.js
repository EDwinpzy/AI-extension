const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'worker.js'),
  'utf8'
);
const DEDUPE_ALARM = 'codex-bookmarks-dedupe';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createHarness(bookmarkSettings) {
  const storage = bookmarkSettings === undefined
    ? {}
    : { bookmarkSettings: clone(bookmarkSettings) };
  const alarms = new Map();
  const listeners = {};
  let allBookmarksReads = 0;

  const chrome = {
    storage: {
      local: {
        async get(keys) {
          const bag = {};
          for (const key of [].concat(keys || [])) {
            if (key in storage) bag[key] = clone(storage[key]);
          }
          return bag;
        },
        async set(patch) {
          Object.assign(storage, clone(patch));
        },
      },
    },
    alarms: {
      async clear(name) {
        alarms.delete(name);
        return true;
      },
      create(name, options) {
        alarms.set(name, clone(options));
      },
      onAlarm: {
        addListener(listener) {
          listeners.alarm = listener;
        },
      },
    },
    bookmarks: {
      onCreated: {
        addListener(listener) {
          listeners.created = listener;
        },
      },
      onRemoved: {
        addListener(listener) {
          listeners.removed = listener;
        },
      },
    },
    runtime: {
      onConnect: {
        addListener(listener) {
          listeners.connect = listener;
        },
      },
      onStartup: {
        addListener(listener) {
          listeners.startup = listener;
        },
      },
      onInstalled: {
        addListener(listener) {
          listeners.installed = listener;
        },
      },
      async getPlatformInfo() {
        return {};
      },
    },
  };

  const bookmarks = {
    async getAllBookmarks() {
      allBookmarksReads++;
      return [];
    },
    findDuplicates() {
      return [];
    },
  };

  const context = vm.createContext({
    chrome,
    clearInterval,
    clearTimeout,
    console,
    readTranslateSettings: async () => ({ models: [] }),
    self: { CodexBookmarks: bookmarks },
    setInterval,
    setTimeout,
  });
  vm.runInContext(SOURCE, context, { filename: 'worker.js' });

  return {
    alarms,
    listeners,
    storage,
    getAllBookmarksReads: () => allBookmarksReads,
  };
}

function connectWorker(harness) {
  let receive;
  let pending = null;
  let nextId = 1;
  const port = {
    name: 'codex-bookmarks',
    postMessage(message) {
      if (!pending || !message || message.id !== pending.id) return;
      const job = pending;
      pending = null;
      if (message.ok) job.resolve(message.data);
      else job.reject(new Error(message.error || '操作失败'));
    },
    onMessage: {
      addListener(listener) {
        receive = listener;
      },
    },
  };
  harness.listeners.connect(port);
  return {
    ask(type, extra) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending = { id, resolve, reject };
        receive(Object.assign({ id, type }, extra || {}));
      });
    },
  };
}

test('migrates a fully enabled legacy setup to the master switch', async () => {
  const harness = createHarness({
    autoClassify: true,
    autoRename: true,
    autoDedupe: true,
    autoDedupeInterval: 6,
  });
  await settle();

  const settings = await connectWorker(harness).ask('settings', { patch: {} });

  assert.equal(settings.autoEnabled, true);
  assert.equal('autoClassify' in settings, false);
  assert.equal('autoRename' in settings, false);
  assert.equal('autoDedupe' in settings, false);
  assert.equal(harness.alarms.get(DEDUPE_ALARM).periodInMinutes, 360);
});

test('a partial legacy setup stays off instead of enabling new actions', async () => {
  const harness = createHarness({
    autoClassify: false,
    autoRename: true,
    autoDedupe: true,
    autoDedupeInterval: 1,
  });
  await settle();

  const settings = await connectWorker(harness).ask('settings', { patch: {} });

  assert.equal(settings.autoEnabled, false);
  assert.equal(harness.alarms.has(DEDUPE_ALARM), false);
});

test('turning the master switch off clears and blocks scheduled dedupe', async () => {
  const harness = createHarness({
    autoEnabled: true,
    autoDedupeInterval: 1,
  });
  await settle();
  assert.equal(harness.alarms.has(DEDUPE_ALARM), true);

  const worker = connectWorker(harness);
  const settings = await worker.ask('settings', { patch: { autoEnabled: false } });
  assert.equal(settings.autoEnabled, false);
  assert.equal(harness.alarms.has(DEDUPE_ALARM), false);

  harness.listeners.alarm({ name: DEDUPE_ALARM });
  await settle();
  assert.equal(harness.getAllBookmarksReads(), 0);
});
