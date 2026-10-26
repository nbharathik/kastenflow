# Tables and databases

A tag can carry typed properties and saved views: that is a database. Pages with the
tag are its rows. This page is about working with them in bulk. The basics (what a
tag database is, the table, board, list, gallery and calendar views) are in [A tour of
the app](guide.md#a-tour-of-the-app).

- [Sub-items](#sub-items)
- [Group rows and calculate](#group-rows-and-calculate)
- [Sort, filter and display](#sort-filter-and-display)
- [Select rows and change many at once](#select-rows-and-change-many-at-once)
- [Put rows in your own order](#put-rows-in-your-own-order)
- [Paste from a spreadsheet](#paste-from-a-spreadsheet)
- [Turn a table in a page into a database](#turn-a-table-in-a-page-into-a-database)
- [The timeline view](#the-timeline-view)
- [Formula properties](#formula-properties)

## Sub-items

Rows can have rows inside them. A sub-item is a page inside another page (a
sub-page), so the structure shows in the sidebar too.

- Turn it on with the **Sub-items** menu in the view bar → **Show sub-items**.
  Rows with sub-items get a **▸** that opens them, to any depth. **Expand all** and
  **Collapse all** are in the same menu. Which rows are open is remembered for the
  view on this computer.
- **Make a sub-item:** point at a row and press the **+** in its title, or
  Ctrl+Shift+Enter, or right-click → *Add sub-item*. Type a title and press Enter; the
  field stays for the next one and Escape ends it.
- **Nest and un-nest:** drag a row onto the middle of another to put it inside;
  drop it on the gap between rows to move it to that row's level. Or press **Tab**
  (put it under the row above) and **Shift+Tab** (take it out) on the title cell. Each
  is one change with **Undo** in the notice.
- **Keys:** → opens a closed row and ← closes an open one.
- With a filter on, a row that matches but sits under one that does not still shows,
  with its parents greyed out.
- In the board, list, gallery and timeline views, a sub-item shows a small "↳ Parent"
  chip. Their **Sub-items** menu has *Hide sub-items* if you would rather see only
  top-level rows.

## Group rows and calculate

- **Group by:** the **Group** control in the view bar (choose *No grouping* to undo
  it), or a column's menu → *Group by this column*. A table can be grouped by a select,
  multi-select, checkbox, date or relation property. Rows without a value go in "No
  value" at the end. A row with several values is grouped under its first.
- **Fold a group:** click its header, or Ctrl+Shift+Up for the group of the active row
  and Ctrl+Shift+Down to open all. Right-click a header for *Collapse all groups*.
  Sub-items stay in their parent's group.
- **Calculations:** a column's menu → *Calculate*, or **Display options → Show
  calculations**.
  A row at the foot of the table (and in each group header) shows one value per
  column; click it to choose. A text column offers *Count all*, *Count empty*, *Count
  not empty* and *Count unique values*; a checkbox column adds *Percent checked*; a
  number or formula column adds *Sum*, *Average*, *Median*, *Minimum*, *Maximum* and
  *Range*; a date column adds *Earliest date*, *Latest date* and *Range*. The values
  cover the rows the filters show.

## Sort, filter and display

- **Sort by several things:** each sort is a chip. Once there are two they are
  numbered; drag a chip, or press **Alt+arrow** on it, to change which comes first.
- **Match all or match any:** with two or more filters, the **Match all** button
  switches to **Match any**. (One switch for the whole list, not nested groups.)
- **More filter conditions:** for number and formula properties, *is more than*, *is at
  least*, *is less than* and *is at most*.
- **Display options** (view bar): *Wrap cells* (up to two lines), *Freeze the title
  column* (it stays in place when you scroll sideways; on by default), *Show
  calculations*, and the row height, *Comfortable* or *Compact*.

## Select rows and change many at once

- **Pick rows:** the checkbox in the title cell (it shows when you point at a row),
  **Space** on the title cell, **Shift+click** for a run, **Shift+↑/↓** to extend with the
  keyboard, a group's checkbox for a whole group, **Select all** on the bar, Escape to
  clear. With a filter on, a row the filter hides, or a greyed parent, is not picked
  by "Select all".
- **The bar** that appears under the table:

  | Button | What it does |
  | --- | --- |
  | **Set property** | Pick a property, then a value (a list for select and checkbox, typed text for the rest), or **Clear**. |
  | **Add tag** / **Remove tag** | Adds or removes a tag on every picked page. |
  | **Move to** | Moves the pages to a project or the library. |
  | **Add to board** | Puts them on a whiteboard. |
  | **Duplicate** | Makes a copy of each. |
  | **Trash** | Moves them to the trash. Over five pages it asks first. |

- Set property, tags, Move to and Add to board are **one change**: one **Undo** in the
  notice undoes all of them. Rows that already had the value are skipped and counted
  ("2 already were"). Duplicate and Trash go row by row, with one notice and one Undo
  for the lot.
- One action changes up to **100 rows**. If you picked more, KastenFlow says so and
  offers **Keep the first 100**.

## Put rows in your own order

When a view has **no sort**, is not grouped, and has no sub-items, each title cell has
a grip. Drag a row by it, or press **Alt+↑ / Alt+↓** to move the active row one place.
The order is saved with the view and shown to everyone who opens it; each move has
**Undo**. Add a sort and the order is set aside (and comes back when you remove the
sort).

## Paste from a spreadsheet

Copy cells in Excel, Google Sheets or Numbers (or any tab- or comma-separated text),
click a cell in the table and press **Ctrl+V**. The pasted block lands from that cell.

- Each value is read by its column's type: numbers (even `1,250.75`), dates (`2 Oct
  2026`, `October 2, 2026`, `2026/10/2`), checkboxes (yes, true, x, 1), selects by
  option name, and multi-selects split on commas or semicolons. An empty cell clears the
  value.
- Rows past the end of the table become **new pages** with the tag, the values the
  view's filters imply, and the database's home. The first column is the title.
- A value that does not fit is left empty and named in the notice ("3 values did not
  fit…"). Formula, relation and built-in columns are skipped and named.
- It is **one change** with **Undo**. A paste holds up to 1,000 rows, and at most 100
  changes at a time: if it does not fit, you are asked and **Paste the first 101** (or
  however many fit) does that part.
- Ambiguous dates such as `10/2/2026` are not guessed; they are named instead.

## Turn a table in a page into a database

A plain table in a page can become a real database.

1. Put the cursor in the table and press **Ctrl+/** (or use its block handle).
2. Choose **Turn into database**. A name is asked under the table, filled in from the
   heading above it.
3. Press Enter. The table becomes a tag with one property for each column after the
   first, one page for each row (the first column is the title), and the table in the
   page is replaced by the database view. Numbers, dates (`YYYY-MM-DD`) and
   checkboxes are recognised from the cells; the rest are text.

A table can have up to 98 rows for this. It is one change in the vault, and **Undo** in
the editor puts the table back. The same menu also has **Add row below**, **Add column
to the right**, **Align column** and **Copy as CSV**. Tab in the last cell adds a row.
Changing a column's alignment rewrites only the line under the header.

## The timeline view

Add one with **+ View → Timeline**. It lays notes out in time as bars from a start date
to an end date.

- It starts from the first two date properties the tag has; change them in the view bar
  (*Starts at*, *Ends at*) and group rows into lanes with *Lanes by*. Choose a scale
  (week, month or quarter); **Today** scrolls back to now.
- A note with only a start date is a marker. Notes without dates wait in a **No dates**
  list with a **Set dates** button.
- **Drag a bar** to shift both dates, or an edge to change one. From the keyboard,
  focus a bar and press **Alt+←/→** to shift it a day, or **Alt+Shift+←/→** to move only
  the end; the arrow keys move between bars and Enter opens the page. Each gesture is
  one change with **Undo**.
- A tag needs at least one date property for a timeline.

## Formula properties

A formula property is a column worked out from the others. It is read-only, shown with
a small sigma, and never stored in the page: change what it reads and the value
follows.

1. Open the tag's **Properties**, add a property and choose the type **Formula**.
2. Type the formula, or press **Functions** and pick one. A line under the field says
   what is wrong, and where, as you type.
3. Save.

The functions:

| Function | Gives | Example |
| --- | --- | --- |
| `days_until(date)` | Days from today to a date; negative once it has passed | `days_until(deadline)` |
| `days_since(date)` | Days since a date; negative while it is still ahead | `days_since(created)` |
| `count(list)` | How many items a list property holds | `count(blocks)` |
| `count_backlinks()` | How many notes link to this one | `count_backlinks()` |
| `sum(relation.number)` | The total of a number on each related note | `sum(tasks.points)` |
| `min(relation.number)` | The smallest | `min(tasks.points)` |
| `max(relation.number)` | The largest | `max(tasks.points)` |
| `if_empty(a, b)` | `a`, or `b` when `a` is empty | `if_empty(venue, "TBD")` |

A formula is at most 400 characters. It can use other properties by name (and the
built-in `title`, `created`, `updated` and `modified`), but not another formula. A
cell that cannot be worked out is left empty with a warning chip that says why (for
example, a date that is not a date), and the row stays. You can sort and filter by a
formula and calculate a total of one, but not group by one.
