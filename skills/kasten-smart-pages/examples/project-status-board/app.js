// Project status board: the notes tagged #task as a board by status, the three due
// next, and a sortable table. Each note has the properties "status" (Todo, Doing or
// Done), "due" (a date) and "owner". Nothing is written in here.
(function () {
  "use strict";
  const TAG = "task";
  const COLUMNS = ["Todo", "Doing", "Done"];

  const prop = (n, key) => {
    const p = (n && n.props) || {};
    return p[key] !== undefined ? p[key] : n ? n[key] : undefined;
  };
  const statusOf = (n) => String(prop(n, "status") || COLUMNS[0]);
  const dueOf = (n) => kit.dates.dateInfo(prop(n, "due")).iso;

  const next = kit.components.countdown("#next", { label: "Due next", data: [], empty: "Nothing is due soon." });
  const board = kit.components.kanban("#board", {
    label: "Tasks by status",
    columns: COLUMNS,
    data: [],
    onMove: (item, status) => kasten.update({ id: item.id, props: { status } }).catch((err) => kasten.log("move failed", err.message)),
  });
  const table = kit.components.table("#table", {
    label: "Tasks",
    columns: [{ key: "title", label: "Task" }, "status", { key: "owner", label: "Owner" }, { key: "due", label: "Due" }],
    onRowClick: (row) => kasten.open(row.id).catch(() => {}),
    data: [],
  });

  const content = document.getElementById("content");
  const empty = document.getElementById("empty");
  function show(text, role) {
    empty.textContent = text || "";
    empty.hidden = !text;
    empty.setAttribute("role", role || "status");
    content.hidden = !!text;
  }

  function render(notes) {
    if (!notes.length) return show("Nothing here yet. Tag a note #" + TAG + " and give it a status, an owner and a due date to see it here.");
    show("");
    const open = notes.filter((n) => statusOf(n).toLowerCase() !== "done" && dueOf(n));
    const today = kit.dates.isoDate(new Date());
    next.update(
      open
        .filter((n) => kit.dates.compareDates(dueOf(n), today) >= 0)
        .sort((a, b) => kit.dates.compareDates(dueOf(a), dueOf(b)))
        .slice(0, 3)
        .map((n) => ({ id: n.id, title: n.title, date: dueOf(n), note: prop(n, "owner") || undefined })),
    );
    board.update(notes.map((n) => ({ id: n.id, title: n.title, status: statusOf(n), note: prop(n, "owner") || undefined })));
    table.update(notes.map((n) => ({ id: n.id, title: n.title, status: statusOf(n), owner: prop(n, "owner") || "", due: kit.dates.formatDate(dueOf(n)) })));
  }

  kasten.watch(
    { tag: TAG },
    (notes) => render(Array.isArray(notes) ? notes : []),
    (err) => show("Could not read your notes: " + (err && err.message ? err.message : "unknown problem") + ". Reopen the page to try again.", "alert"),
  );
})();
