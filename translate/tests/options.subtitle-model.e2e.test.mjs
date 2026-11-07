/* End-to-end behaviour test for the settings page.
 *
 * Scenario (mirrors the user report): add a model in the models pane, then
 * check the subtitle model <select> for it without reloading the page.
 *
 * Needs jsdom (not vendored): npm install jsdom
 * Run: node translate/tests/options.subtitle-model.e2e.test.mjs
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const html = readFileSync(join(root, 'options.html'), 'utf8');
const settingsSrc = readFileSync(join(root, 'settings.js'), 'utf8');
const optionsSrc = readFileSync(join(root, 'options.js'), 'utf8');

/* ---- chrome API stand-ins ---- */
const storageData = {};
const sent = [];
const chrome = {
  storage: {
    local: {
      /* settings.js reads the whole translateSettings bag: get(key) -> { key: value } */
      get: async (keys) => {
        const bag = {};
        for (const k of [].concat(keys || [])) if (k in storageData) bag[k] = storageData[k];
        return bag;
      },
      set: async (patch) => {
        /* chrome.storage.local.set expects values JSON-serializable; the
         * storage bag is what readTranslateSettings merges from. */
        for (const [k, v] of Object.entries(patch)) storageData[k] = v;
      },
    },
  },
  runtime: {
    sendMessage: async (msg) => { sent.push(msg); return null; },
    connect: () => ({ postMessage() {}, onMessage: { addListener() {} }, disconnect() {} }),
    getURL: (p) => 'chrome-extension://test/' + p,
  },
  bookmarks: { getTree: async () => [] },
};

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.chrome = chrome;
window.alert = () => {};

/* Script tags concatenate into one classic script: const/let share the page
 * global scope. eval them joined, in the same order as options.html. */
window.eval(settingsSrc + '\n;\n' + optionsSrc);

const $ = (id) => window.document.getElementById(id);
const assert = (cond, label) => {
  if (!cond) { console.error('FAIL: ' + label); process.exitCode = 1; }
  else console.log('ok  : ' + label);
};
const storedSettings = () => storageData.translateSettings;

await new Promise((r) => setTimeout(r, 150));

/* 1. Baseline: the subtitle select holds "same as translation" + shipped model. */
const sub = $('subtitleModel');
assert(!!sub, 'subtitleModel select exists');
const before = [...sub.options].map((o) => o.value);
assert(before.length === 2 && before[1] === 'local-translategemma',
  'baseline options = [same-as-translation, TranslateGemma-4B] (got ' + JSON.stringify(before) + ')');

/* 2. Add a custom cloud model through the real modal flow. */
$('addModel').click();
assert(!$('modelModal').hidden, 'model modal opened');
$('fieldCloudService').value = 'custom';
$('fieldCloudService').dispatchEvent(new window.Event('change', { bubbles: true }));
assert(!$('cloudCustomFields').hidden, 'custom cloud fields visible');
$('fieldBaseUrl').value = 'https://api.example.com/v1';
$('fieldApiKey').value = 'sk-test-123';
$('fieldModel').value = 'my-new-model-7b';
$('fieldName').value = 'Example 7B';
$('saveModel').click();
assert($('modelModal').hidden, 'modal closed after save');

/* 3. The new model must be inside the subtitle dropdown, same session. */
const newModelOption = [...sub.options].find(
  (o) => o.value !== '' && o.value !== 'local-translategemma'
);
assert(!!newModelOption, 'new model appears in subtitle dropdown');
assert(newModelOption && newModelOption.text === 'Example 7B',
  'new option label is the model name (got ' + (newModelOption && newModelOption.text) + ')');

/* 4. Picking it persists subtitleModelId through the real storage path. */
sub.value = newModelOption.value;
sub.dispatchEvent(new window.Event('change', { bubbles: true }));
await new Promise((r) => setTimeout(r, 80));
assert(String(storedSettings().subtitleModelId) === String(newModelOption.value),
  'subtitleModelId persisted to storage (got ' + storedSettings().subtitleModelId + ')');
assert(storedSettings().models.length === 2, 'models array persisted with 2 entries');

/* 5. Removing a model updates the dropdown too (regression guard). */
const cards = window.document.querySelectorAll('#modelList .card');
assert(cards.length === 2, 'model cards = 2 after add (got ' + cards.length + ')');
const removeBtn = cards[cards.length - 1].querySelector('button.danger');
assert(!!removeBtn, 'remove button rendered on the new card');
removeBtn.click(); // first tap arms it
removeBtn.click(); // second tap deletes
await new Promise((r) => setTimeout(r, 80));
const afterRemove = [...sub.options].map((o) => o.value);
assert(afterRemove.length === 2, 'dropdown back to baseline after remove (got ' + afterRemove.length + ')');
assert(!afterRemove.includes(newModelOption.value), 'removed model gone from dropdown');

console.log(process.exitCode ? 'RESULT: FAILURES' : 'RESULT: ALL PASS');
