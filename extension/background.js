// Toolbar icon: every click opens a NEW editor tab with its own empty note (Untitled-N.md); a content script asks us to open a file:// .md.
const EDITOR = chrome.runtime.getURL('editor/index.html');
const PENDING_KEY = 'mdwe.untitledPending'; // chrome.storage.session: numbers handed out whose tab has not taken its lock yet
const PENDING_MS = 30000;

// Lowest free Untitled-N: not held by an open tab (Web Lock), not used by a stored draft with real text, not just handed to a tab that is still loading.
// Closed empty notes leave nothing behind, so with no editor tabs and no drafts the next note is Untitled-1.md.
// Serialized so two quick clicks never get the same number.
let chain = Promise.resolve();
function nextNoteNumber() {
  const run = chain.then(async () => {
    const used = new Set();
    const all = await chrome.storage.local.get(null);
    for (const [k, v] of Object.entries(all)) {
      const m = k.indexOf('mdwe.draft') === 0 && v && typeof v.text === 'string' && v.text.trim() && typeof v.name === 'string' && /^Untitled-(\d+)\.md$/i.exec(v.name);
      if (m) used.add(Number(m[1]));
    }
    try { for (const l of (await navigator.locks.query()).held || []) { const m = /^mdwe-num-(\d+)$/.exec(l.name); if (m) used.add(Number(m[1])); } } catch { /* locks unavailable: pending list still prevents duplicates */ }
    const now = Date.now();
    const pending = (await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY] || {};
    for (const [k, t] of Object.entries(pending)) { if (now - t > PENDING_MS) delete pending[k]; else used.add(Number(k)); }
    let n = 1;
    while (used.has(n)) n++;
    pending[n] = now;
    await chrome.storage.session.set({ [PENDING_KEY]: pending });
    return n;
  });
  chain = run.catch(() => {});
  return run;
}
async function openNewNote(nextToTab) {
  let n = 1;
  try { n = await nextNoteNumber(); } catch { n = 1 + (Date.now() % 900000); }
  const props = { url: EDITOR + '?new=' + n };
  if (nextToTab && nextToTab.index != null) props.index = nextToTab.index + 1;
  if (nextToTab && nextToTab.windowId != null) props.windowId = nextToTab.windowId;
  chrome.tabs.create(props);
}

chrome.action.onClicked.addListener((tab) => { openNewNote(tab); });

// A tab that has taken its number lock no longer needs the pending reservation (so a note closed right away frees its number at once).
function releasePending(n) {
  chain = chain.then(async () => {
    const pending = (await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY] || {};
    if (pending[n] != null) { delete pending[n]; await chrome.storage.session.set({ [PENDING_KEY]: pending }); }
  }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'note-number-held' && Number.isInteger(msg.n) && msg.n >= 1 && msg.n <= 999999) { releasePending(msg.n); return; }
  if (msg.type === 'alloc-number') { nextNoteNumber().then((n) => sendResponse({ n }), () => sendResponse({ n: 1 + (Date.now() % 900000) })); return true; }
  if (msg.type === 'new-note') openNewNote(sender.tab);
  else if (msg.type === 'open-in-editor' && typeof msg.url === 'string' && /^file:\/\//.test(msg.url)) {
    const target = EDITOR + '?src=' + encodeURIComponent(msg.url);
    if (sender.tab && sender.tab.id != null) chrome.tabs.update(sender.tab.id, { url: target });
    else chrome.tabs.create({ url: target });
  }
});
