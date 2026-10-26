---
type: ai-action
title: Fix LaTeX errors
icon: wand
needs: [sources]
optional: [selection]
writes: propose
where: [latex]
version: 1
---
Fix the errors in the attached LaTeX file. The last build's errors are listed with it, each with its file and line. If what is attached is not enough, read the build with latex_build and the file with latex_read. Start with the first error, because later ones often come from it. Fix each error with the smallest change, using latex_edit: search is the exact text to replace, and base_hash is the hash latex_read gave. Read the build again when you are done. If a selection is attached, fix only the errors inside it. Leave the wording, the packages and the class as they are unless an error needs them changed, and never take text out just to make an error go away. Then say in a few sentences what was wrong and what you changed. If an error needs a decision from me, say what you would suggest instead of guessing. If the build has no errors, say so and change nothing.
