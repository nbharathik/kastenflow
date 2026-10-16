// The dialogs of Slides that are not in a deck's view, shown over whatever is open: the storyboard of a page, and turning slide numbers off in
// every deck. The shell loads this file only when one of them is asked for (they bring the slide engine with them).

import { StoryboardHost } from "../pages/present/storyboard/StoryboardDialog";
import { SlideNumbersHost } from "./SlideNumbersDialog";

export default function SlidesOverlays() {
  return (
    <>
      <StoryboardHost />
      <SlideNumbersHost />
    </>
  );
}
