---
type: ai-action
title: Check references and labels
icon: circle-check
needs: [sources]
optional: []
writes: propose
where: [latex]
version: 1
---
Check that every \ref, \eqref, \cref and \cite of the attached LaTeX document has something to point at, and say which labels are never used. The attached text ends with a map of the document: its files, labels, bibliography keys, and the references and citations that point at nothing. If the map is missing or cut, read the files with latex_read. For a reference that points at nothing, look for a label that is nearly the same (a typo, or a prefix such as fig: or eq:) and fix the reference with latex_edit when one match is clear: search is the exact text, base_hash is the hash latex_read gave. If there is no match, tell me instead of inventing a label. Do not add or remove labels, and do not change a citation key unless one entry in the bibliography is clearly the one meant. Finish with a short list: what you fixed, what is left for me, and the labels never used.
