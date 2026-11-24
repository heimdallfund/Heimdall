/*! Heimdall Token Check embed. Put <div data-heimdall-token="0x…"></div> where the card should go, then load this
    script once. Optional: data-theme="dark", data-width="420". Each card is an iframe served by heimdall.fund that
    sizes itself; nothing on your page is read or sent anywhere. */
(function () {
  var ORIGIN = "https://heimdall.fund";
  try { var s = document.currentScript && new URL(document.currentScript.src); if (s && (/heimdall/.test(s.host) || /^localhost(:|$)/.test(s.host))) ORIGIN = s.origin; } catch (e) {}
  var frames = {};
  function mount(el) {
    if (el.getAttribute("data-heimdall-mounted")) return;
    var token = (el.getAttribute("data-heimdall-token") || "").trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(token)) return;
    el.setAttribute("data-heimdall-mounted", "1");
    var f = document.createElement("iframe");
    f.src = ORIGIN + "/embed/token/" + token + (el.getAttribute("data-theme") === "dark" ? "?theme=dark" : "");
    f.title = "Heimdall Token Check";
    f.loading = "lazy";
    f.setAttribute("scrolling", "no");
    f.style.cssText = "border:0;width:100%;max-width:" + (parseInt(el.getAttribute("data-width"), 10) || 420) + "px;height:196px;display:block;background:transparent";
    el.appendChild(f);
    (frames[token.toLowerCase()] = frames[token.toLowerCase()] || []).push(f);
  }
  function scan() { var els = document.querySelectorAll("[data-heimdall-token]"); for (var i = 0; i < els.length; i++) mount(els[i]); }
  window.addEventListener("message", function (e) {
    if (e.origin !== ORIGIN || !e.data || e.data.heimdall !== "token-check") return;
    var list = frames[e.data.token] || [];
    for (var i = 0; i < list.length; i++) if (list[i].contentWindow === e.source) list[i].style.height = Math.min(600, e.data.height + 2) + "px";
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan); else scan();
  // pages that render tokens later (single-page apps) can call HeimdallTokenCheck.scan()
  window.HeimdallTokenCheck = { scan: scan };
  if (window.MutationObserver) new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
})();
