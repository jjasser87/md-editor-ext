// File I/O: File System Access API with graceful fallbacks (input/download).
const PICKER_TYPES = [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdown'], 'text/plain': ['.txt'] } }];
export const hasFSA = () => typeof window.showOpenFilePicker === 'function';

export async function openWithPicker() {
  const [handle] = await window.showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
  const file = await handle.getFile();
  return { handle, name: file.name, text: await file.text() };
}

export async function openWithInput(inputEl) {
  return new Promise((resolve, reject) => {
    inputEl.onchange = async () => {
      const f = inputEl.files && inputEl.files[0];
      inputEl.value = '';
      if (!f) return reject(new DOMException('No file', 'AbortError'));
      resolve({ handle: null, name: f.name, text: await f.text() });
    };
    inputEl.click();
  });
}

export async function readFileObject(file) {
  return { handle: null, name: file.name, text: await file.text() };
}

// Drag-drop: prefer a handle (so Save writes back to the same file).
export async function readDropItem(dt) {
  const item = dt.items && dt.items[0];
  if (item && item.getAsFileSystemHandle) {
    try {
      const h = await item.getAsFileSystemHandle();
      if (h && h.kind === 'file') {
        const file = await h.getFile();
        return { handle: h, name: file.name, text: await file.text() };
      }
    } catch { /* fall through */ }
  }
  const f = dt.files && dt.files[0];
  return f ? readFileObject(f) : null;
}

export async function fetchFileUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const text = await res.text();
  let name = url.split('/').pop().split('?')[0].split('#')[0];
  try { name = decodeURIComponent(name); } catch { /* keep raw */ }
  name = name || 'Untitled.md';
  return { handle: null, name, text };
}

async function ensureWritable(handle) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

export async function writeHandle(handle, text) {
  if (!(await ensureWritable(handle))) throw new Error('Write permission denied');
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}

export async function pickSaveHandle(suggestedName) {
  return window.showSaveFilePicker({ suggestedName, types: PICKER_TYPES });
}

export function downloadText(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
