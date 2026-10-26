// Reading dashboard: the notes tagged #reading as numbers, a board by status and a
// chart. Each note has the properties "status" (To read, Reading or Done) and
// "pages" (a number). Nothing is written in here: moving a card changes the note.
(function () {
  "use strict";
  const TAG = "reading";
  const COLUMNS = ["To read", "Reading", "Done"];

  const prop = (n, key) => {
    const p = (n && n.props) || {};
    return p[key] !== undefined ? p[key] : n ? n[key] : undefined;
  };
  const statusOf = (n) => String(prop(n, "status") || COLUMNS[0]);
  const pagesOf = (n) => Number(prop(n, "pages")) || 0;

  const stats = kit.components.stat("#stats", { label: "Summary", data: [] });
  const board = kit.components.kanban("#board", {
    label: "Reading list",
    columns: COLUMNS,
    data: [],
    // The page decides what a move does: here it sets the note's status.
    onMove: (item, status) => kasten.update({ id: item.id, props: { status } }).catch((err) => kasten.log("move failed", err.message)),
  });
  const chart = kit.components.bar("#chart", { label: "Pages by status", data: [] });

  const content = document.getElementById("content");
  const empty = document.getElementById("empty");
  function show(text, role) {
    empty.textContent = text || "";
    empty.hidden = !text;
    empty.setAttribute("role", role || "status");
    content.hidden = !!text;
  }

  function render(notes) {
    if (!notes.length) return show("Nothing here yet. Tag a note #" + TAG + " and give it a status and a number of pages to see it here.");
    show("");
    const isDone = (n) => statusOf(n).toLowerCase() === "done";
    const readPages = notes.filter(isDone).reduce((sum, n) => sum + pagesOf(n), 0);
    stats.update([
      { label: "Books and papers", value: notes.length },
      { label: "Finished", value: notes.filter(isDone).length, hint: kit.format.percent(notes.filter(isDone).length / notes.length) },
      { label: "Pages read", value: readPages },
    ]);
    board.update(notes.map((n) => ({ id: n.id, title: n.title, status: statusOf(n), note: pagesOf(n) ? pagesOf(n) + " pages" : undefined })));
    chart.update(COLUMNS.map((c) => ({ label: c, value: notes.filter((n) => statusOf(n).toLowerCase() === c.toLowerCase()).reduce((sum, n) => sum + pagesOf(n), 0) })));
  }

  kasten.watch(
    { tag: TAG },
    (notes) => render(Array.isArray(notes) ? notes : []),
    (err) => show("Could not read your notes: " + (err && err.message ? err.message : "unknown problem") + ". Reopen the page to try again.", "alert"),
  );
})();
