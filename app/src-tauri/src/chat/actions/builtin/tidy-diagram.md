---
type: ai-action
title: Tidy this diagram
icon: layout
needs: [sources]
writes: propose
where: [chat]
version: 1
---
Tidy the layout of the attached diagram without changing what it says. Call diagram_edit once with a single layout step, in the diagram's own direction (LR for a flow that runs left to right, TB for one that runs top to bottom), and with no other step. Then say in one sentence what moved. If the diagram is already tidy, say so and change nothing. Do not rename, add or remove anything.
