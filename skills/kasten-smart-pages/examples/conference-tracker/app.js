// Conference tracker: the notes tagged #conference as three countdown tiles, a map,
// a pipeline (abstract deadline to paper deadline, one lane per area) and a card for
// every venue. Nothing is written in here: every date, place and status is read from
// the notes, so editing a note moves its pin, bar, tile and card.
(function () {
  "use strict";
  const TAG = "conference";
  const NEXT_UP = 3;

  const prop = (n, key) => {
    const p = (n && n.props) || {};
    return p[key] !== undefined ? p[key] : n ? n[key] : undefined;
  };
  const number = (v) => (v === undefined || v === null || v === "" ? NaN : Number(v));
  const isEstimate = (n) => String(prop(n, "deadline_status") || "").toLowerCase() === "est";
  const paperOf = (n) => kit.dates.dateInfo(prop(n, "paper_deadline")).iso;

  /** A note as a pipeline item: abstract to paper as a bar (a dot when there is no earlier abstract date). */
  function toBar(n) {
    const item = { id: n.id, title: n.title, lane: prop(n, "area") || "Other" };
    if (isEstimate(n)) item.announced = false;
    const abstract = kit.dates.dateInfo(prop(n, "abstract_deadline")).iso;
    const paper = paperOf(n);
    if (abstract && kit.dates.compareDates(abstract, paper) < 0) {
      item.start = abstract;
      item.end = paper;
    } else item.date = paper;
    return item;
  }

  /** A note as a countdown tile for its paper deadline. */
  function toTile(n) {
    const tile = { id: n.id, title: n.title, date: paperOf(n), note: prop(n, "city") || undefined };
    if (isEstimate(n)) tile.announced = false;
    return tile;
  }

  /** A note as a card: the city, then the paper deadline (marked "est." for an estimate). */
  function toCard(n) {
    const paper = paperOf(n);
    const when = paper ? kit.dates.dateInfo({ date: paper, announced: !isEstimate(n) }).label : "No paper deadline yet";
    return { id: n.id, title: n.title, caption: [prop(n, "city"), when].filter(Boolean).join(" · ") };
  }

  const countdowns = kit.components.countdown("#countdowns", { label: "Next paper deadlines", data: [], empty: "No paper deadline is coming up." });
  const map = kit.components.map("#map", { label: "Host cities", data: { pins: [], highlight: [] } });
  const pipeline = kit.components.timeline("#pipeline", { label: "Abstract to paper by area", data: [] });
  const venues = kit.components.gallery("#venues", { label: "Venues", data: [] });

  const content = document.getElementById("content");
  const empty = document.getElementById("empty");
  function show(text, role) {
    empty.textContent = text || "";
    empty.hidden = !text;
    empty.setAttribute("role", role || "status");
    content.hidden = !!text;
  }

  function render(notes) {
    if (!notes.length) return show("Nothing here yet. Tag a note #" + TAG + " and give it the properties paper_deadline, lat and lon to see it here.");
    show("");
    const dated = notes.filter(paperOf);
    const today = kit.dates.isoDate(new Date());
    const upcoming = dated
      .filter((n) => kit.dates.compareDates(paperOf(n), today) >= 0)
      .sort((a, b) => kit.dates.compareDates(paperOf(a), paperOf(b)))
      .slice(0, NEXT_UP);
    countdowns.update(upcoming.map(toTile));
    pipeline.update(dated.map(toBar));
    venues.update(notes.map(toCard));
    map.update({
      pins: notes
        .map((n) => ({ id: n.id, label: n.title, lat: number(prop(n, "lat")), lon: number(prop(n, "lon")), note: prop(n, "city") || undefined }))
        .filter((p) => isFinite(p.lat) && isFinite(p.lon)),
      highlight: [],
    });
  }

  kasten.watch(
    { tag: TAG },
    (notes) => render(Array.isArray(notes) ? notes : []),
    (err) => show("Could not read your notes: " + (err && err.message ? err.message : "unknown problem") + ". Reopen the page to try again.", "alert"),
  );
})();
