// Map: the notes with one tag as pins on a world map, with their countries
// highlighted. Change TAG to follow another tag. Each note needs the properties
// "lat" and "lon" (degrees) and can have "country" (a country or continent to
// highlight) and "when" (a line shown beside the place).
(function () {
  "use strict";
  const TAG = "place";

  const prop = (n, key) => {
    const p = (n && n.props) || {};
    return p[key] !== undefined ? p[key] : n ? n[key] : undefined;
  };
  const number = (v) => (v === undefined || v === null || v === "" ? NaN : Number(v));

  const map = kit.components.map("#map", { label: "Places", data: { pins: [], highlight: [] } });
  const empty = document.getElementById("empty");
  const host = document.getElementById("map");
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
      const pins = list
        .map((n) => ({ id: n.id, label: n.title, lat: number(prop(n, "lat")), lon: number(prop(n, "lon")), note: prop(n, "when") || undefined }))
        .filter((p) => isFinite(p.lat) && isFinite(p.lon));
      if (!pins.length) return show("Nothing here yet. Tag a note #" + TAG + " and give it the properties lat and lon (for example 38.7 and -9.1) to pin it.");
      show("");
      const countries = [];
      list.forEach((n) => {
        const c = prop(n, "country");
        if (c && !countries.includes(String(c))) countries.push(String(c));
      });
      map.update({ pins, highlight: countries });
    },
    (err) => show("Could not read your notes: " + (err && err.message ? err.message : "unknown problem") + ". Reopen the page to try again.", "alert"),
  );
})();
