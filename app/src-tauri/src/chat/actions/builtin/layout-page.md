---
type: ai-action
title: Lay out this page
icon: layout
needs: [page]
writes: propose
where: [editor, chat]
version: 1
---
Lay out the attached page so it is easier to scan, without changing its words. Read it first with read_page_blocks, then make one edit_page call that holds all your steps. Use the steps that fit: wrap_columns to set short neighbouring blocks, or two embedded views, side by side; callout for a summary or a warning; toggle to fold long details the reader does not need first; embed to show a live view; move to bring the most important block to the top. Leave headings, code, tables and every block you do not name as they are. Do not change the page's words, only how it is arranged. If a step is refused as changed since you read it, read the page again and redo it with the new ids. Then say in two sentences what you arranged. If the page is already well laid out, say so and change nothing. If no page is attached, ask which one.
