// Timeline: the dated notes with one tag, in lanes, with a line for today.
// Change TAG to follow another tag. Each note needs the property "date", or
// "date" and "end" for a range, and can have "lane" and "announced" (false for
// an estimate).
(function () {
  "use strict";
  const TAG = "event";

  const prop = (n, key) => {
    const p = (n && n.props) || {};
    return p[key] !== undefined ? p[key] : n ? n[key] : undefined;
  };
  const isFalse = (v) => v === false || String(v).toLowerCase() === "false";

  const timeline = kit.components.timeline("#timeline", { label: "Events by lane", data: [] });
  const empty = document.getElementById("empty");
  const host = document.getElementById("timeline");
  function show(text, role) {
    empty.textContent = text || "";
    empty.hidden = !text;
    empty.setAttribute("role", role || "status");
    host.hidden = !!text;
  }

  kasten.watch(
    { tag: TAG },
    (notes) => {
      const dated = (Array.isArray(notes) ? notes : []).filter((n) => kit.dates.dateInfo(prop(n, "date")).iso);
      if (!dated.length) return show("Nothing here yet. Tag a note #" + TAG + " and give it a date (for example 2027-03-01) to see it here.");
      show("");
      timeline.update(
        dated.map((n) => {
          const item = { id: n.id, title: n.title, lane: prop(n, "lane") || "Events" };
          if (isFalse(prop(n, "announced"))) item.announced = false;
          if (prop(n, "end")) {
            item.start = prop(n, "date");
            item.end = prop(n, "end");
          } else item.date = prop(n, "date");
          return item;
        }),
      );
    },
    (err) => show("Could not read your notes: " + (err && err.message ? err.message : "unknown problem") + ". Reopen the page to try again.", "alert"),
  );
})();
