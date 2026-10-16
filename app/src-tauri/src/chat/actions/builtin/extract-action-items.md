---
type: ai-action
title: Extract action items
icon: todo
needs: [page]
optional: [selection]
writes: insert
where: [editor, chat]
version: 1
---
Find what someone has to do in the text and list each item as a Markdown to-do, starting with a verb. Add an owner or a date only where the text names one. If the text holds no action items, say so in one sentence instead of inventing any. If a selection is given, look only there.
