---
type: ai-action
title: Find missing citations
icon: book
needs: [sources]
optional: [selection]
writes: propose
where: [latex]
version: 1
---
Find the claims in the attached LaTeX document that need a citation, and the citations that have no entry. Start from the map at the end of the attached text: the keys cited and the keys in the bibliography. Then look through my References with list_references for entries that fit a claim. For a reference that fits, add it with latex_cite (it writes the \cite and keeps the entry in the bibliography once). Never invent a reference, an author or a key. If nothing in my References fits a claim, say which claim it is and what kind of source it needs. Do not change the text around a citation. If a selection is attached, look only there. Finish with a short list: what you cited, what is still missing, and cited keys that have no entry.
