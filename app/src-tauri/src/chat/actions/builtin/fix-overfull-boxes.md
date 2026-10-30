---
type: ai-action
title: Fix overfull boxes
icon: wand
needs: [sources]
optional: [selection]
writes: propose
where: [latex]
version: 1
---
Fix the overfull boxes of the attached LaTeX document: lines that stick out into the margin. The last build lists them (read it with latex_build if it is not attached), each with its file and the lines of its paragraph. For each one read those lines with latex_read (around_line gives numbered lines) and choose the gentlest cure: let a long word or web address break (\url, \allowbreak, a hyphenation hint such as \-), reword a few words only if the meaning stays the same, or for a wide table or equation use a smaller font, a narrower column or a split. Make each change with latex_edit: search is the exact text, without the line numbers, and base_hash is the hash latex_read gave. Do not change the margins, the class or the packages to hide them. Then call latex_build with wait set to true and finish with the count, such as “7 overfull boxes → 2”. Say what you left and why. These are suggestions and may be wrong.
