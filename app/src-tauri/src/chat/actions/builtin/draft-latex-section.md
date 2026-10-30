---
type: ai-action
title: Draft a section from a page
icon: layout
needs: [sources]
optional: [page, selection]
writes: propose
where: [latex]
version: 1
---
Draft a section of the attached LaTeX document from a page of my notes. If I have not named or attached the page, ask which one. Read the page with read_note, and the document's file with latex_read to see its class, packages, labels and the way its sections are written. Write the section in LaTeX that matches the document: the same heading level and style, a \label on the section and on each figure and table, and \cite only for a reference whose key is in my References (list_references). Keep my meaning and my numbers, and add no claim the page does not make. Put it in the right place with latex_append (after is the text it should follow), then call latex_build with wait set to true to check it. Say what you drafted and anything you left out. This is a draft and may be wrong.
