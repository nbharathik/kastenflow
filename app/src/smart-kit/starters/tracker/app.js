// Tracker: a timeline, countdowns and status cards from the notes with one tag.
// Change TAG to follow another tag. Each note can have the properties "date"
// (a deadline) or "date" and "end" (a range), "event" (the lane), "announced"
// (false for an estimate), "aoe" (true for anywhere on Earth) and "status".
(function () {
  "use strict";
  const TAG = "deadline";
  const NEXT_UP = 6;

  const prop = (n, key) => {
    const p = (n && n.props) || {};
    return p[key] !== undefined ? p[key] : n ? n[key] : undefined;
  };
  const isFalse = (v) => v === false || String(v).toLowerCase() === "false";
  const isTrue = (v) => v === true || String(v).toLowerCase() === "true";

  /** A note as a kit item: dated, in a lane, maybe an estimate. */
  function toItem(n) {
    const item = { id: n.id, title: n.title, lane: prop(n, "event") || "Deadlines", aoe: isTrue(prop(n, "aoe")) };
    if (isFalse(prop(n, "announced"))) item.announced = false;
    if (prop(n, "end") !== undefined && prop(n, "end") !== null) {
      item.start = prop(n, "date");
      item.end = prop(n, "end");
    } else item.date = prop(n, "date");
    return item;
  }

  const timeline = kit.components.timeline("#timeline", { label: "Dates by lane", data: [] });
  const next = kit.components.countdown("#countdowns", { label: "Next up", data: [], empty: "Nothing coming up." });
  const cards = kit.components.kanban("#cards", { label: "Status", data: [] });

  const content = document.getElementById("content");
  const empty = document.getElementById("empty");
  const statusSection = document.getElementById("status-section");
  function show(text) {
    empty.textContent = text || "";
    empty.hidden = !text;
    content.hidden = !!text;
    empty.setAttribute("role", "status");
  }

  function render(notes) {
    const dated = notes.filter((n) => kit.dates.dateInfo(prop(n, "date")).iso);
    if (!dated.length) return show("Nothing here yet. Tag a note #" + TAG + " and give it a date (for example 2027-03-01) to see it here.");
    show("");
    const items = dated.map(toItem);
    timeline.update(items);
    next.update(items.filter((it) => !it.end && kit.dates.daysUntil(it.date) >= 0).sort((a, b) => kit.dates.compareDates(a.date, b.date)).slice(0, NEXT_UP));
    const withStatus = dated.filter((n) => prop(n, "status")).map((n) => ({ id: n.id, title: n.title, status: String(prop(n, "status")), note: kit.dates.formatDate(prop(n, "date")) }));
    statusSection.hidden = !withStatus.length;
    cards.update(withStatus);
  }

  kasten.watch(
    { tag: TAG },
    (notes) => render(Array.isArray(notes) ? notes : []),
    (err) => {
      show("Could not read your notes: " + (err && err.message ? err.message : "unknown problem") + ". Reopen the page to try again.");
      empty.setAttribute("role", "alert");
    },
  );
})();
