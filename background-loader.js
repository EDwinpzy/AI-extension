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

importScripts(
  'translate/settings.js',
  'translate/engine.js',
  'darkling/js/background.js',
  'darkling/glue.js'
);