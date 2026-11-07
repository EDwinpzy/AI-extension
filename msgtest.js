window.__msgResult = {started:true};
try {
  chrome.runtime.sendMessage({type:'__ping'}).then(r=>{window.__msgResult={ok:true,r};}).catch(e=>{window.__msgResult={err:String(e)};});
} catch(e) { window.__msgResult = {syncThrow:String(e)}; }
