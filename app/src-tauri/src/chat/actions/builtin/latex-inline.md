---
type: ai-action
title: Write LaTeX in place
icon: wand
needs: []
optional: [selection, nearby, sources]
writes: insert
where: [latex]
version: 1
---
Write LaTeX for the request that comes after these words. If a selection is attached, your answer replaces it; if not, your answer is put at the cursor, so write only what belongs there. Use the text around it to match the document's style, macros and packages. The attached file lists its labels and citation keys: use them, and invent none. Escape special characters and close every environment you open. Add no \documentclass, no \begin{document} and no package unless the request needs one; if it does, put the \usepackage line in a % comment on its own line above the code. Answer with the LaTeX only: no greeting, no explanation and no code fence.
