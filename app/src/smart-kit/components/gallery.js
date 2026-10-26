/* KastenFlow smart kit: gallery. Load after kit.js, lib/dom.js, lib/keys.js. */
(function (root) {
  "use strict";
  const kit = root.kit;
  const h = kit.h;

  function open(item, index, opts) {
    if (opts.onSelect) return opts.onSelect(item, index);
    const bridge = opts.kasten || root.kasten;
    if (item.id && bridge) bridge.open(item.id).catch(() => {});
  }

  function figure(item, index, opts) {
    const alt = item.alt !== undefined ? item.alt : item.title || "";
    const picture = item.src ? h("img.kit-gallery-img", { src: item.src, alt, loading: "lazy" }) : h("div.kit-gallery-blank", { role: "img", "aria-label": alt || "No picture" });
    const caption = h("figcaption", {}, item.title ? h("strong", {}, item.title) : null, item.caption ? h("div.kit-gallery-cap", {}, item.caption) : null);
    const clickable = !!opts.onSelect || !!item.id;
    const shown = clickable
      ? h("button.kit-gallery-btn", { type: "button", "data-roving": "", "aria-label": item.title || alt || "Open item " + (index + 1), onClick: () => open(item, index, opts) }, picture)
      : picture;
    return h("li", { key: item.id }, h("figure.kit-gallery-item", {}, shown, caption));
  }

  kit.defineComponent("gallery", {
    view(data, opts) {
      const list = (Array.isArray(data) ? data : []).filter((x) => x && typeof x === "object");
      if (!list.length) return kit.emptyView(opts.empty || "No pictures yet.");
      const style = opts.columns ? { "--kit-cols": String(opts.columns) } : null;
      return h("ul.kit-grid", { role: "list", "aria-label": opts.label || "Gallery", style }, list.map((x, i) => figure(x, i, opts)));
    },
    after(el, opts, api) {
      if (api._roving) api._roving.refresh();
      else api._roving = kit.keys.roving(el, { orientation: "both" });
    },
    teardown(api) {
      if (api._roving) api._roving.destroy();
    },
  });
})(window);
