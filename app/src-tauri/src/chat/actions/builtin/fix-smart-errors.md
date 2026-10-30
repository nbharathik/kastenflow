---
type: ai-action
title: Fix its errors
icon: wand
needs: [page]
writes: propose
where: [smart]
version: 1
---
Fix the errors of the attached smart page. If the attached page is not a smart page, say so and change nothing. Call smart_read: it lists the problems with the page and the errors the page reported when the app ran it, each with its file and line, and gives each file's hash. Run smart_check as well. Start with the first error, because later ones often come from it. Fix each error with the smallest change, using smart_edit: the text to replace must be in the file once, and base_hash is the hash smart_read gave. Run smart_check again when you are done. Never take a component or its data out just to make an error go away, and never write data into the code or add network use. If an error needs a decision from me, say what you would suggest instead of guessing. Then say in a few sentences what was wrong and what you changed. If there are no errors, say so and change nothing.
