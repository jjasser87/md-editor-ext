// Adds an "Edit in Markdown Editor" button on local file://*.md pages.
// Works once "Allow access to file URLs" is enabled for the extension in chrome://extensions.
(() => {
  if (document.getElementById('__mdwe_btn')) return;
  const b = document.createElement('button');
  b.id = '__mdwe_btn';
  b.textContent = '✎ Edit in Markdown Editor';
  b.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;padding:8px 12px;font:600 13px system-ui,sans-serif;background:#2563eb;color:#fff;border:0;border-radius:8px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)';
  b.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'open-in-editor', url: location.href }));
  document.body.appendChild(b);
})();
