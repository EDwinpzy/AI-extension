/*
 * Standalone service worker for the settings extension.
 */
importScripts(
  'translate/settings.js',
  'translate/engine.js',
  'darkling/js/background.js',
  'darkling/glue.js'
);

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});