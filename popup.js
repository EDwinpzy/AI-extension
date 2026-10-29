document.getElementById('open-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
document.getElementById('clear-cache').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'translate:clear-cache' }, () => window.close());
});