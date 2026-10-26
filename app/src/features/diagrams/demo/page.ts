// The demo's stand-in for the diagram editor: a page that speaks the editor's
// embed protocol (JSON messages) and draws the diagram it is given as boxes
// and arrows, so the real diagram screen, its autosave and its pictures run
// over a stored drawing. Boxes can be dragged and renamed with a double-click.
// It is handed to the frame as a data address; the frame appends its settings
// after the page, so the page ends inside a comment that swallows them.

const STYLE = `
:root{--bg:#f4f4f1;--panel:#ffffff;--ink:#1d1d1b;--muted:#6b6b66;--line:#d9d9d3;--dot:#cfcfc8;--accent:#2563eb}
body.dark{--bg:#232322;--panel:#2c2c2a;--ink:#ecece8;--muted:#a3a39c;--line:#444441;--dot:#3d3d3a;--accent:#7aa2ff}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{display:flex;flex-direction:column;font:13px system-ui,sans-serif;background:var(--bg);color:var(--ink)}
header{display:flex;gap:18px;align-items:center;padding:7px 14px;background:var(--panel);border-bottom:1px solid var(--line);color:var(--muted)}
header b{color:var(--ink);font-weight:600}
header span:last-child{margin-left:auto}
.main{flex:1;display:flex;min-height:0}
aside{width:46px;background:var(--panel);border-right:1px solid var(--line);display:flex;flex-direction:column;align-items:center;gap:14px;padding-top:14px}
aside i{display:block;width:22px;height:16px;border:1.6px solid var(--muted);border-radius:4px}
aside i:nth-child(2){border-radius:50%}
aside i:nth-child(3){transform:rotate(45deg) scale(.8);border-radius:2px}
aside i:nth-child(4){height:0;border-width:1.6px 0 0}
main{flex:1;position:relative;background-image:radial-gradient(var(--dot) 1px,transparent 1px);background-size:20px 20px;min-width:0}
svg{width:100%;height:100%}
g.box{cursor:grab}
g.box rect{fill:#fff;stroke:#333;stroke-width:1.6}
g.box:hover rect{stroke:var(--accent)}
input.edit{position:absolute;font:inherit;text-align:center;border:1.5px solid var(--accent);border-radius:6px;padding:2px 4px;background:#fff;color:#111}
`;

const SCRIPT = `
(function () {
  var NS = "http://www.w3.org/2000/svg";
  var href = location.href;
  if (/dark=1/.test(href)) document.body.classList.add("dark");
  var doc = null, autosave = false, drag = null;
  var svg = document.getElementById("canvas");
  var main = document.getElementById("stage");
  function send(m) { parent.postMessage(JSON.stringify(m), "*"); }
  function parse(xml) { var d = new DOMParser().parseFromString(xml, "application/xml"); return d.getElementsByTagName("parsererror").length ? null : d; }
  function cells(kind) { return doc ? Array.prototype.filter.call(doc.getElementsByTagName("mxCell"), function (c) { return c.getAttribute(kind) === "1"; }) : []; }
  function geo(c) { var g = c.getElementsByTagName("mxGeometry")[0]; var n = function (k, d) { return Number(g && g.getAttribute(k) || d); }; return { x: n("x", 0), y: n("y", 0), w: n("width", 120), h: n("height", 60) }; }
  function byId(id) { return cells("vertex").filter(function (c) { return c.getAttribute("id") === id; })[0]; }
  function xml() { return new XMLSerializer().serializeToString(doc); }
  function el(name, attrs, text) { var e = document.createElementNS(NS, name); for (var k in attrs) e.setAttribute(k, String(attrs[k])); if (text != null) e.textContent = text; return e; }
  function edgeEnd(a, b) {
    var cx = a.x + a.w / 2, cy = a.y + a.h / 2, dx = b.x + b.w / 2 - cx, dy = b.y + b.h / 2 - cy;
    var s = Math.min(dx === 0 ? Infinity : a.w / 2 / Math.abs(dx), dy === 0 ? Infinity : a.h / 2 / Math.abs(dy));
    return [cx + dx * s, cy + dy * s];
  }
  function draw() {
    svg.replaceChildren();
    var boxes = cells("vertex"), all = boxes.map(geo);
    if (!all.length) return;
    var x0 = Math.min.apply(null, all.map(function (b) { return b.x; })) - 40, y0 = Math.min.apply(null, all.map(function (b) { return b.y; })) - 40;
    var x1 = Math.max.apply(null, all.map(function (b) { return b.x + b.w; })) + 40, y1 = Math.max.apply(null, all.map(function (b) { return b.y + b.h; })) + 40;
    svg.setAttribute("viewBox", x0 + " " + y0 + " " + (x1 - x0) + " " + (y1 - y0));
    var defs = el("defs", {}); var mk = el("marker", { id: "arrow", markerWidth: 10, markerHeight: 10, refX: 9, refY: 5, orient: "auto", markerUnits: "userSpaceOnUse" });
    mk.appendChild(el("path", { d: "M0,0 L10,5 L0,10 z", fill: "#444" })); defs.appendChild(mk); svg.appendChild(defs);
    cells("edge").forEach(function (e) {
      var a = byId(e.getAttribute("source")), b = byId(e.getAttribute("target"));
      if (!a || !b) return;
      var ga = geo(a), gb = geo(b), p = edgeEnd(ga, gb), q = edgeEnd(gb, ga);
      svg.appendChild(el("line", { x1: p[0], y1: p[1], x2: q[0], y2: q[1], stroke: "#444", "stroke-width": 1.6, "marker-end": "url(#arrow)" }));
      var word = e.getAttribute("value");
      if (word) svg.appendChild(el("text", { x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2 - 8, "text-anchor": "middle", "font-size": 12, fill: "#666", "font-family": "sans-serif" }, word));
    });
    boxes.forEach(function (c) {
      var g = geo(c), grp = el("g", { class: "box" });
      grp.appendChild(el("rect", { x: g.x, y: g.y, width: g.w, height: g.h, rx: 10 }));
      grp.appendChild(el("text", { x: g.x + g.w / 2, y: g.y + g.h / 2, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 15, fill: "#1d1d1b", "font-family": "sans-serif" }, c.getAttribute("value") || ""));
      grp.addEventListener("mousedown", function (ev) { drag = { cell: c, at: ev.clientX, atY: ev.clientY, g: g, moved: false }; });
      grp.addEventListener("dblclick", function () { rename(c, g); });
      svg.appendChild(grp);
    });
  }
  function changed() { draw(); if (autosave) send({ event: "autosave", xml: xml() }); }
  function rename(c, g) {
    var box = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal, k = Math.min(box.width / vb.width, box.height / vb.height);
    var ox = box.left + (box.width - vb.width * k) / 2 - vb.x * k, oy = box.top + (box.height - vb.height * k) / 2 - vb.y * k, host = main.getBoundingClientRect();
    var input = document.createElement("input"); input.className = "edit"; input.value = c.getAttribute("value") || "";
    input.style.left = ox + g.x * k - host.left + "px"; input.style.top = oy + (g.y + g.h / 2) * k - 14 - host.top + "px"; input.style.width = g.w * k + "px";
    main.appendChild(input); input.focus(); input.select();
    var done = function (keep) { if (!input.parentNode) return; if (keep) c.setAttribute("value", input.value); input.remove(); changed(); };
    input.addEventListener("keydown", function (ev) { if (ev.key === "Enter") done(true); else if (ev.key === "Escape") done(false); });
    input.addEventListener("blur", function () { done(true); });
  }
  window.addEventListener("mousemove", function (ev) {
    if (!drag) return;
    var vb = svg.viewBox.baseVal, box = svg.getBoundingClientRect(), k = Math.min(box.width / vb.width, box.height / vb.height);
    var dx = (ev.clientX - drag.at) / k, dy = (ev.clientY - drag.atY) / k;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    drag.moved = true;
    var geom = drag.cell.getElementsByTagName("mxGeometry")[0];
    geom.setAttribute("x", String(Math.round(drag.g.x + dx))); geom.setAttribute("y", String(Math.round(drag.g.y + dy)));
    draw();
  });
  window.addEventListener("mouseup", function () { var was = drag; drag = null; if (was && was.moved) changed(); });
  function picture() {
    var b = cells("vertex").map(geo), w = Math.max.apply(null, b.map(function (g) { return g.x + g.w; })) + 20, h = Math.max.apply(null, b.map(function (g) { return g.y + g.h; })) + 20;
    var shapes = cells("vertex").map(function (c) { var g = geo(c); return '<rect x="' + g.x + '" y="' + g.y + '" width="' + g.w + '" height="' + g.h + '" rx="10" fill="#fff" stroke="#333"/><text x="' + (g.x + g.w / 2) + '" y="' + (g.y + g.h / 2) + '" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size="15" fill="#111">' + (c.getAttribute("value") || "").replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</text>"; }).join("");
    var content = xml().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\\n/g, "&#xa;");
    return '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="' + w + 'px" height="' + h + 'px" viewBox="0 0 ' + w + " " + h + '" content="' + content + '"><defs/><rect width="' + w + '" height="' + h + '" fill="#fff"/><g>' + shapes + "</g></svg>";
  }
  function b64(text) { var bin = ""; new TextEncoder().encode(text).forEach(function (n) { bin += String.fromCharCode(n); }); return btoa(bin); }
  function exportAs(a) {
    var s = picture();
    if (a.format === "png") {
      var img = new Image();
      img.onload = function () {
        var k = a.scale || 1, c = document.createElement("canvas"); c.width = img.width * k; c.height = img.height * k;
        var x = c.getContext("2d"); x.fillStyle = a.background || "#fff"; x.fillRect(0, 0, c.width, c.height); x.scale(k, k); x.drawImage(img, 0, 0);
        send({ event: "export", format: "png", data: c.toDataURL("image/png"), xml: xml() });
      };
      img.src = "data:image/svg+xml;base64," + b64(s);
      return;
    }
    if (a.format === "xml") return send({ event: "export", format: "xml", xml: xml() });
    send({ event: "export", format: a.format === "xmlsvg" ? "svg" : a.format, data: "data:image/svg+xml;base64," + b64(s), xml: xml() });
  }
  window.addEventListener("message", function (ev) {
    if (ev.source !== parent || typeof ev.data !== "string") return;
    var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.action === "configure") send({ event: "init" });
    else if (m.action === "load") {
      var d = parse(m.xml || ""); if (!d) return;
      doc = d; autosave = m.autosave === 1; if (m.dark === 1) document.body.classList.add("dark");
      draw(); send({ event: "load", bounds: { x: 0, y: 0, width: 800, height: 400 }, scale: 1 });
    } else if (m.action === "export") exportAs(m);
    else if (m.action === "layout") { if (doc) send({ event: "autosave", xml: xml() }); }
    else if (m.action === "textContent") send({ event: "textContent", data: cells("vertex").map(function (c) { return c.getAttribute("value") || ""; }).join(" ") });
  });
  send({ event: /configure=1/.test(href) ? "configure" : "init" });
})();
`;

const MENU = ["File", "Edit", "View", "Arrange", "Extras", "Help"];

/** The stand-in page's markup. */
export const EDITOR_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Diagram editor</title><style>${STYLE}</style></head><body>
<header><b>Diagrams</b>${MENU.map((m) => `<span>${m}</span>`).join("")}<span>100%</span></header>
<div class="main"><aside aria-hidden="true"><i></i><i></i><i></i><i></i></aside><main id="stage"><svg id="canvas" role="img" aria-label="Diagram"></svg></main></div>
<script>${SCRIPT}</script>
<!--`;

/** The address the frame loads. Whatever the frame adds after it is read as the comment's text. */
export const editorAddress = (): string => `data:text/html;charset=utf-8,${encodeURIComponent(EDITOR_HTML)}`;
