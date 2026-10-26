// Gallery: the notes with one tag as a grid of pictures. Change TAG to follow
// another tag. Each note can have the properties "image" (a picture in this
// page's assets folder, for example assets/sketch.png) and "caption".
(function () {
  "use strict";
  const TAG = "picture";

  const prop = (n, key) => {
    const p = (n && n.props) || {};
    return p[key] !== undefined ? p[key] : n ? n[key] : undefined;
  };

  const gallery = kit.components.gallery("#gallery", { label: "Pictures", data: [] });
  const empty = document.getElementById("empty");
  const host = document.getElementById("gallery");
  function show(text, role) {
    empty.textContent = text || "";
    empty.hidden = !text;
    empty.setAttribute("role", role || "status");
    host.hidden = !!text;
  }

  kasten.watch(
    { tag: TAG },
    (notes) => {
      const list = Array.isArray(notes) ? notes : [];
      if (!list.length) return show("Nothing here yet. Tag a note #" + TAG + " and set its image property to a picture in this page's assets folder.");
      show("");
      gallery.update(list.map((n) => ({ id: n.id, title: n.title, src: prop(n, "image") || undefined, caption: prop(n, "caption") || undefined })));
    },
    (err) => show("Could not read your notes: " + (err && err.message ? err.message : "unknown problem") + ". Reopen the page to try again.", "alert"),
  );
})();
