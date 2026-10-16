// Mounts "Add a paper" wherever the window is, when something asked for it.
// The app shell loads this file only then.

import { usePaperDialog } from "./add-state";
import { AddPaperDialog } from "./AddPaperDialog";

export default function AddPaperHost() {
  const request = usePaperDialog((s) => s.request);
  const close = usePaperDialog((s) => s.close);
  // A new request is a new dialog: a draft from a page does not reuse the paste box of the last one.
  return request ? <AddPaperDialog key={JSON.stringify([request.text ?? "", request.draft?.key ?? "", request.draft?.fields.title ?? ""])} request={request} onClose={close} /> : null;
}
