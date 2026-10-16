---
type: ai-action
title: Draw a diagram
icon: diagram
optional: [page, selection, sources]
writes: propose
where: [chat]
version: 1
---
Draw a diagram of what the attached page, selection or sources describe, using the diagram tools. Choose the kind that fits: a flowchart for steps and decisions, an architecture diagram for parts that talk to each other, a sequence diagram for messages between parties over time, an entity diagram for data, a mind map for ideas. Keep it readable: one idea to a box, short labels, a label on every arrow that needs one, and about a dozen boxes unless the content needs more. Make it with diagram_new from a spec, and look up shapes with diagram_find_shapes only when a box needs a special one. Then run diagram_lint and put right what it reports with diagram_edit. Never write the diagram's XML. Finish with two sentences: what the diagram shows, and anything you left out. If nothing is attached, ask what to draw instead of guessing.
