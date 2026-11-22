/*
 * SalonAgent chat widget. Add ONE line to any website, before </body>:
 *
 *   <script src="https://YOUR-SALONAGENT-DOMAIN/widget.js" data-salon="demo-barber" async></script>
 *
 * Optional: data-color="#1f4d3a" (button colour), data-label="Запази час" (button text).
 * It adds a floating button; clicking it opens the chat in an iframe.
 */
(function () {
  var script = document.currentScript;
  if (!script || window.__salonAgentLoaded) return;
  window.__salonAgentLoaded = true;
  var origin = new URL(script.src).origin;
  var salon = script.getAttribute('data-salon') || 'demo-barber';
  var color = script.getAttribute('data-color') || '#1f4d3a';
  var label = script.getAttribute('data-label') || 'Запази час';

  var css =
    '.sa-btn{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;align-items:center;gap:8px;' +
    'padding:0 18px;height:52px;border:0;border-radius:26px;background:' + color + ';color:#fff;' +
    'font:600 16px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25);cursor:pointer}' +
    '.sa-frame{position:fixed;right:16px;bottom:80px;z-index:2147483001;width:380px;height:600px;' +
    'max-height:calc(100dvh - 100px);border:0;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.3);' +
    'background:#fff;display:none}' +
    '.sa-open .sa-frame{display:block}' +
    '@media (max-width:480px){.sa-frame{inset:0;width:100%;height:100%;max-height:none;border-radius:0}' +
    '.sa-open .sa-btn{display:none}}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var root = document.createElement('div');
  var btn = document.createElement('button');
  btn.className = 'sa-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', label);
  btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
  btn.appendChild(document.createTextNode(label));
  var frame = null;

  function toggle(open) {
    if (open && !frame) {
      frame = document.createElement('iframe');
      frame.className = 'sa-frame';
      frame.title = 'Чат със салона';
      frame.src = origin + '/embed?salon=' + encodeURIComponent(salon);
      root.appendChild(frame);
    }
    root.classList.toggle('sa-open', open);
  }
  btn.addEventListener('click', function () { toggle(!root.classList.contains('sa-open')); });
  window.addEventListener('message', function (e) {
    if (e.origin === origin && e.data && e.data.type === 'salonagent:close') toggle(false);
  });
  root.appendChild(btn);
  document.body.appendChild(root);
})();
