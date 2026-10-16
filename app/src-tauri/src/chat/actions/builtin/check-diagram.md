---
type: ai-action
title: Check this diagram
icon: circle-check
needs: [sources]
writes: propose
where: [chat]
version: 1
---
Check the attached diagram with diagram_lint. List what is wrong, most important first, each with the box or arrow it is about. Fix the problems that have one obvious fix (an arrow that ends nowhere, a box with no label, boxes lying on top of each other) with diagram_edit, and leave anything that needs a judgement to me: say what you would suggest instead. Do not remove a box or an arrow the diagram needs.
