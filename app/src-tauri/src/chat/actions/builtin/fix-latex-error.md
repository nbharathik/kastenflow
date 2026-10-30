---
type: ai-action
title: Fix this problem
icon: wand
needs: [sources]
optional: []
writes: propose
where: [latex]
version: 1
---
Fix only the one problem quoted after these words, in the attached LaTeX file or the file it names. The attached text shows the lines near it and what TeX printed where it stopped; if that is not enough, read more with latex_read (around_line gives numbered lines). Find the cause and fix it with the smallest change, using latex_edit: search is the exact text to replace, without the line numbers, and base_hash is the hash latex_read gave. Leave everything else as it is. Then call latex_build with wait set to true, and tell me whether this problem is gone and how many errors the build has now, such as “3 errors → 2”. If there is no engine to build with, say so plainly. Say in two sentences what was wrong and what you changed. This is a suggestion and may be wrong, for example when the problem comes from a macro I wrote myself; if you are not sure, say what you would try instead of guessing.
