---
type: ai-action
title: Figure from a diagram
icon: diagram
needs: [sources]
optional: [selection]
writes: propose
where: [latex]
version: 1
---
Put a diagram of mine into the attached LaTeX document as a figure. The words quoted after these, if any, name the diagram; if they do not, or the name matches several, look with list_diagrams and ask me which one. Make the figure with diagram_to_latex_figure: the app draws the diagram as a PNG, keeps it in the document's figures folder and gives back the \includegraphics line, with the width you ask for (use \linewidth or a fraction of it). Wrap it in a figure environment with \centering, a short \caption taken from what the diagram shows and a \label, and put it where the text refers to it, or at the cursor line if a selection is attached, using latex_edit (search is the exact text, base_hash the hash latex_read gave). Never write the picture's bytes yourself. Then call latex_build with wait set to true to check it. Say what you added. This may be wrong: check the caption.
