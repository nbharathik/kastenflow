---
type: ai-action
title: Explain this problem
icon: bulb
needs: [sources]
optional: []
writes: none
where: [latex]
version: 1
---
Explain the one problem quoted after these words in plain language: what TeX is complaining about, why it happens at that line, and how it is usually put right. Use the attached lines near it, and read more with latex_read (around_line gives numbered lines) if you need to. Point at the exact line, and give one suggested fix as a line of LaTeX. Do not change any file. Keep it to a short paragraph. This is an explanation and may be wrong: if the cause may be a macro or package I wrote myself, or the lines shown do not make it clear, say so.
