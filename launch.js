// The action popup exists only to launch the settings page. Using a popup
// instead of action.onClicked keeps the toolbar button working even when the
// service worker has not started yet.
chrome.runtime.openOptionsPage();
window.close();