// The research dialogs, mounted by the app shell when one is asked for: "Add a
// paper" and "Compare papers". They load only then.

import { CompareHost } from "../sources/compare/CompareHost";
import AddPaperHost from "./AddPaperHost";

export default function ResearchOverlays() {
  return (
    <>
      <AddPaperHost />
      <CompareHost />
    </>
  );
}
