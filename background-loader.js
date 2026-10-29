/*
 * Standalone service worker for the settings extension.
 *
 * The action listener is registered before importScripts so a failure inside
 * one of the imported modules can never take the toolbar button down with it.
 */
chrome.runtime.onMessage.addListener((m, s, send) => {
  if (m && m.type === '__ping') { send({ pong: true, from: 'top' }); }
  return false;
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

/*
 * Order matters: the translation settings and engine register their message and
 * context-menu listeners first, the bookmark worker needs those settings (its
 * classifier reuses the model list), and the Darkling engine loads last with
 * its own glue, which adds the dark-mode menu and shortcut entry points.
 */
importScripts(
  'translate/settings.js',
  'translate/engine.js',
  'bookmarks/lib/bookmark-utils.js',
  'bookmarks/lib/deduplicator.js',
  'bookmarks/lib/classifier.js',
  'bookmarks/worker.js',
  'darkling/js/background.js',
  'darkling/glue.js'
);