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
Fix the errors of the attached LaTeX document, in the attached file and in any other file the build names. The attached text shows the lines near each problem, with its file and line and what TeX printed where it stopped. If that is not enough, read more with latex_read (around_line or lines gives numbered lines) and the build with latex_build. Start with the first error, because later ones often come from it. Fix each with the smallest change, using latex_edit: search is the exact text to replace, without the line numbers, and base_hash is the hash latex_read gave. Then check your work: call latex_build with wait set to true and compare the error counts. If errors remain that your changes did not cause, try once more, then stop. If there is no engine to build with, say so plainly and stop. Leave the wording, the packages and the class as they are unless an error needs them changed, and never take text out just to make an error go away. If a selection is attached, fix only the errors inside it. End with one line such as “3 errors → 0” (before and after; say it is a preview if my changes still wait for review), then a few sentences on what was wrong and what you changed. These are suggestions and may be wrong, for example with macros I wrote myself; if an error needs a decision from me, say what you would suggest. If the build has no errors, say so and change nothing.
