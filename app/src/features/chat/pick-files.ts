// Two small helpers the page editor has too (pages/editor/paste-files.ts),
// kept here so the chat does not load the editor's code to use them.

/** Opens the system's file picker; `chosen` gets the files picked, if any. */
export function pickFiles(chosen: (files: File[]) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.addEventListener("change", () => {
    const files = Array.from(input.files ?? []);
    if (files.length) chosen(files);
  });
  input.click();
}

/** Whether copied HTML is only a picture, as a browser's "Copy image" makes.
 * Office and web pages also put a picture of the selection next to its
 * HTML; that paste is the text, not the picture. */
export function onlyPicture(html: string): boolean {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  return !body.textContent?.trim() && body.querySelectorAll("img").length === 1 && !body.querySelector("table, video, iframe");
}
