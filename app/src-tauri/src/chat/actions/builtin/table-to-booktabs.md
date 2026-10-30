---
type: ai-action
title: Page table to booktabs
icon: list
needs: [sources]
optional: [page, selection]
writes: propose
where: [latex]
version: 1
---
Turn a table of a page of my notes into a LaTeX table in the attached document. If I have not named or attached the page and the table, ask. Read the page with read_note. Write a table environment with \centering, a \caption and a \label, and a tabular that uses the booktabs rules (\toprule, \midrule, \bottomrule) and no vertical lines; align numbers to the right and text to the left; escape the special characters (& % $ # _ { } ~ ^). Make sure the document loads the booktabs package, and add \usepackage{booktabs} with latex_edit if it does not (search is the exact text, base_hash the hash latex_read gave). Put the table in with latex_append (after is the text it should follow), then call latex_build with wait set to true. Do not change the table's values. Say what you added.
