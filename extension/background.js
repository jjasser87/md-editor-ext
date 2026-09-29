// Toolbar icon opens the full-tab editor; content script asks us to open a file:// .md in it.
const EDITOR = chrome.runtime.getURL('editor/index.html');

chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: EDITOR }));

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'open-in-editor' && typeof msg.url === 'string' && /^file:\/\//.test(msg.url)) {
    const target = EDITOR + '?src=' + encodeURIComponent(msg.url);
    if (sender.tab && sender.tab.id != null) chrome.tabs.update(sender.tab.id, { url: target });
    else chrome.tabs.create({ url: target });
  }
});
