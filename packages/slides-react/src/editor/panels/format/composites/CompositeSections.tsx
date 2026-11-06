import type { Element } from "@kasten-slides/wasm";
import type { JSX } from "react";

import type { SectionProps } from "../types.ts";
import { AudioSection } from "./AudioSection.tsx";
import { CardsSection } from "./CardsSection.tsx";
import { ChartSection } from "./ChartSection.tsx";
import { ChatSection } from "./ChatSection.tsx";
import { CitationSection } from "./CitationSection.tsx";
import { CodeSection } from "./CodeSection.tsx";
import { EmbedSection } from "./EmbedSection.tsx";
import { MathSection } from "./MathSection.tsx";
import { QrSection } from "./QrSection.tsx";
import { StepLabelSection } from "./StepLabelSection.tsx";
import { TimerSection } from "./TimerSection.tsx";
import { TokenProbsSection } from "./TokenProbsSection.tsx";
import { VideoSection } from "./VideoSection.tsx";

const SECTIONS: Record<string, (props: SectionProps) => JSX.Element> = {
  code: CodeSection,
  math: MathSection,
  chat: ChatSection,
  "token-probs": TokenProbsSection,
  "card-grid": CardsSection,
  citation: CitationSection,
  "step-label": StepLabelSection,
  embed: EmbedSection,
  video: VideoSection,
  chart: ChartSection,
  timer: TimerSection,
  qr: QrSection,
  audio: AudioSection,
};

/** Whether an element has a section of its own in the format options. */
export const hasCompositeSection = (element: Element): boolean => element.type in SECTIONS;

/** A section for each kind of composite among the selected elements, each for the elements of its kind. */
export function CompositeSections(props: SectionProps) {
  const kinds = Object.keys(SECTIONS).filter((kind) => props.elements.some((element) => element.type === kind));
  return (
    <>
      {kinds.map((kind) => {
        const Section = SECTIONS[kind] as (props: SectionProps) => JSX.Element;
        return <Section key={kind} {...props} />;
      })}
    </>
  );
}
