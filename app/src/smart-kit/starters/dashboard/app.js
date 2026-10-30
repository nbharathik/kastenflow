// Dashboard: numbers, a chart and a table from the notes with one tag.
// Change TAG to follow another tag. Each note can have the properties
// "status" (for example todo, doing, done) and "due" (a date).
(function () {
  "use strict";
  const TAG = "tracked";
  const DONE = ["done", "complete", "completed", "finished"];

  const prop = (n, key) => {
    const p = (n && n.props) || {};
    return p[key] !== undefined ? p[key] : n ? n[key] : undefined;
  };
  const statusOf = (n) => String(prop(n, "status") || "No status");
  const dueOf = (n) => kit.dates.dateInfo(prop(n, "due")).iso;

  const stats = kit.components.stat("#stats", { label: "Summary", data: [] });
  const chart = kit.components.donut("#chart", { label: "Notes by status", data: [] });
  const table = kit.components.table("#table", {
    label: "Notes",
    columns: [{ key: "title", label: "Note" }, "status", { key: "due", label: "Due" }],
    onRowClick: (row) => kasten.open(row.id).catch(() => {}),
    data: [],
  });

  const content = document.getElementById("content");
  const empty = document.getElementById("empty");
  function show(text) {
    empty.textContent = text || "";
    empty.hidden = !text;
    content.hidden = !!text;
    empty.setAttribute("role", "status");
  }

  function render(notes) {
    if (!notes.length) return show("Nothing here yet. Tag a note #" + TAG + " and give it a status to see it here.");
    show("");
    const counts = {};
    notes.forEach((n) => {
      const s = statusOf(n);
      counts[s] = (counts[s] || 0) + 1;
    });
    const done = notes.filter((n) => DONE.includes(statusOf(n).toLowerCase())).length;
    const soon = notes.filter((n) => {
      const d = dueOf(n);
      const days = d === null ? null : kit.dates.daysUntil(d);
      return days !== null && days >= 0 && days <= 7 && !DONE.includes(statusOf(n).toLowerCase());
    }).length;
    stats.update([
      { label: "Notes", value: notes.length },
      { label: "Done", value: done, hint: kit.format.percent(done / notes.length) },
      { label: "Due this week", value: soon },
    ]);
    chart.update(Object.keys(counts).map((k) => ({ label: k, value: counts[k] })));
    table.update(
      notes.map((n) => ({ id: n.id, title: n.title, status: statusOf(n), due: kit.dates.formatDate(dueOf(n)) })),
    );
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
