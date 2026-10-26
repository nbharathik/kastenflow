---
type: ai-action
title: Make a smart page from this
icon: layout
needs: [page]
optional: [selection]
writes: propose
where: [editor, chat]
version: 1
---
Make a smart page from the attached page or selection: a live page that reads the user's notes and shows them as a dashboard, tracker, map, timeline, calendar, board or gallery. First decide what it should show and which tag of notes it reads, and look at those notes with query_tag so you use the properties they really have. If what is attached is prose rather than data to show, say that a normal page fits better and change nothing. Read the kit reference in the resource kasten://smart/kit, start from its nearest example, and make the page in one smart_create call. Never write the data into the page: dates, places and statuses come from notes, and the page has no network. Then run smart_check and fix every error with smart_edit. Finish with two sentences: what the page shows and which tag and properties it reads, and that you could not run it yourself. If nothing is attached, ask what the page should show.
