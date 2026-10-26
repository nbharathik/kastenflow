---
type: ai-action
title: Improve this smart page's layout
icon: layout
needs: [page]
writes: propose
where: [smart]
version: 1
---
Improve the layout of the attached smart page without changing what data it shows. If the attached page is not a smart page, say so and change nothing. Read it first with smart_read, which gives each file and its hash. Change only how things are arranged, in index.html and in app.js, using smart_edit: put the most important section first, group related components, give every component a label and every section a heading, use the kit's components instead of hand-made markup, show a plain message when there are no notes, and set a size that fits so nothing scrolls inside the page. Never write data into the code and never add network use. Run smart_check when you are done and fix what it reports. Then say in two sentences what you moved. If the layout is already good, say so and change nothing.
