# Pages: columns, width, folded properties and order

A few ways to shape a page and its place in the sidebar. The basics of writing are in
[A tour of the app](guide.md#a-tour-of-the-app).

- [Columns](#columns)
- [Page width](#page-width)
- [Fold a page's properties](#fold-a-pages-properties)
- [Order of sub-pages](#order-of-sub-pages)
- [The page menu](#the-page-menu)

## Columns

Put blocks side by side.

1. On an empty line type `/columns` and press Enter, or `/columns 2` or `/columns 3`
   to choose the number. You get that many columns with the cursor in the first.
2. Write in each column as usual. Lists, tables, toggles, callouts, code, maths and
   embedded pages all work inside a column.

To move things around:

- **Move a block to another column:** drag its block handle into the other column,
  or put the cursor in it and press **Alt+Left** or **Alt+Right** (Cmd+Option on a
  Mac).
- **Change the widths:** drag the thin divider between two columns. It takes one
  undo step, and Escape cancels the drag. From the keyboard, Tab to a divider and
  press Left or Right (5 % each), or Home for equal widths.
- Below about 640 pixels of width (a narrow pane) the columns stack, one under the
  other, and the dividers hide.

Limits: columns do not nest (you cannot put columns inside a column), the number of
columns is chosen when you make them (to change it, edit the block's text, below),
and **Present this page** treats a set of columns as one block.

In the file, the columns are plain comments, so any other editor shows your text in
order and the page stays readable without KastenFlow:

```markdown
<!-- columns 30/70 -->

Left column.

<!-- column -->

Right column.

<!-- /columns -->
```

KastenFlow never changes a byte of a page that has no columns, and when you edit one
column only that column is rewritten. [The vault format](vault-format.md#columns)
has the details.

## Page width

A page can be **Normal**, **Wide** or **Full** width.

- **For one page:** open its ••• menu and choose Normal, Wide or Full in the Style
  group (two clicks). The group works with the arrow keys.
- **For every page:** Settings → Pages → *Page width*. A page's own choice wins; **Use
  the default style** in its menu clears it.
- **From the palette:** *Wide pages* and *Full width pages* switch between that width
  and normal.

Wide suits tables and code while keeping paragraphs readable; Full uses the whole
pane. A blank journal day follows the same setting. The choice is kept in the page's
header as `width: wide` (or `full` or `normal`).

## Fold a page's properties

A page with a lot of tags and properties can fold them into one line.

- Click the arrow above the properties (open it reads "Properties"; folded it is one
  quiet line such as "7 properties · #paper #idea"), or press **Ctrl+Alt+P**, to fold
  or unfold.
- By default a page with more than five properties starts folded; fewer start open.
  Your choice for a page is remembered for that page on this computer.
- Settings → Pages → *Properties on pages* sets the default for every page: **Shown**,
  **Folded** or **Folded when more than 5**.
- In the palette: *Fold properties*, *Unfold properties*, and *Fold properties on
  every page* (which clears every page's own choice). The page's ••• menu has the same
  under View.
- **Add property** unfolds the line so you see what you are adding.

Folding only changes how the page looks. The file is not touched, so nothing is
written and Undo has nothing to take back.

## Order of sub-pages

A page's sub-pages are listed alphabetically until you put them in your own order.
This applies to pages inside another page.

- **Drag** a sub-page to the top or bottom edge of a sibling in the sidebar. A line
  shows where it will land. Dropping on the middle of a row puts it inside that
  page instead; dropping on the edge of a top-level row takes it out to a page of its
  own.
- **Keyboard:** focus a row and press **Alt+Up** or **Alt+Down**.
- **Menu:** the row's menu has *Move up* and *Move down*, and the palette has *Move
  this page up* and *Move this page down*.

Each move says what it did, with **Undo** in the notice. At the top or bottom, or for
a page that is not inside another page, you get one sentence saying why nothing
moved. The order is stored in the parent page's header, and the page footer's
sub-page list follows it.

## The page menu

The ••• menu groups the actions: the most used ones (copy link, duplicate, lock for
agents, ask AI, trash) first, then Style (font, size and width), then submenus:
**View** (fold sections, the sections layout, folding properties, turning a page into
a smart page) and **Present & export** (present, turn sections into a deck, Send to
LaTeX, export a smart page as HTML, and so on). Every action is also in the command
palette.
