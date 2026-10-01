// Toolbar icon: every click opens a NEW editor tab with its own empty note (Untitled-N.md); a content script asks us to open a file:// .md.
const EDITOR = chrome.runtime.getURL('editor/index.html');
const COUNTER_KEY = 'mdwe.untitledNext'; // chrome.storage.session: resets when the browser restarts, so numbers stay small

// Next free Untitled-N number. Serialized so two quick clicks never get the same number; numbers already used by a stored draft are skipped.
let chain = Promise.resolve();
function nextNoteNumber() {
  const run = chain.then(async () => {
    const used = new Set();
    const all = await chrome.storage.local.get(null);
    for (const [k, v] of Object.entries(all)) {
      const m = k.indexOf('mdwe.draft') === 0 && v && typeof v.name === 'string' && /^Untitled-(\d+)\.md$/i.exec(v.name);
      if (m) used.add(Number(m[1]));
    }
    try { for (const l of (await navigator.locks.query()).held || []) { const m = /^mdwe-num-(\d+)$/.exec(l.name); if (m) used.add(Number(m[1])); } } catch { /* locks unavailable: fall back to the counter */ }
    let n = Number((await chrome.storage.session.get(COUNTER_KEY))[COUNTER_KEY]) || 1;
    while (used.has(n)) n++;
    await chrome.storage.session.set({ [COUNTER_KEY]: n + 1 });
    return n;
  });
  chain = run.catch(() => {});
  return run;
}
async function openNewNote(nextToTab) {
  let n = 1;
  try { n = await nextNoteNumber(); } catch { n = Date.now() % 100000; }
  const props = { url: EDITOR + '?new=' + n };
  if (nextToTab && nextToTab.index != null) props.index = nextToTab.index + 1;
  if (nextToTab && nextToTab.windowId != null) props.windowId = nextToTab.windowId;
  chrome.tabs.create(props);
}

chrome.action.onClicked.addListener((tab) => { openNewNote(tab); });

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg) return;
  if (msg.type === 'new-note') openNewNote(sender.tab);
  else if (msg.type === 'open-in-editor' && typeof msg.url === 'string' && /^file:\/\//.test(msg.url)) {
    const target = EDITOR + '?src=' + encodeURIComponent(msg.url);
    if (sender.tab && sender.tab.id != null) chrome.tabs.update(sender.tab.id, { url: target });
    else chrome.tabs.create({ url: target });
  }
});
