import { Icon, type IconName } from "../../ui/Icon";

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: "plus", title: "Pick a start", text: "A blank deck, a template, a page of your notes or a PowerPoint file: the cards above make one in a press." },
  { icon: "text", title: "Write the slides", text: "Type on a slide, or write an outline and let the slides follow. The assistant can draft a first version." },
  { icon: "present", title: "Present or share", text: "Slideshow in the corner, or Ctrl+Enter, plays it. File, Download saves PowerPoint, PDF and more." },
];

/** What the Slides home says when there is no deck yet: the three steps from nothing to a talk. */
export function EmptyDecks() {
  return (
    <section aria-label="Your first deck" className="mt-10 rounded-xl border border-dashed border-line-strong p-6">
      <h2 className="text-16 font-semibold">No decks yet</h2>
      <p className="mt-1 text-13 text-muted">Decks you make are kept here as plain files in your vault. Three steps to the first one.</p>
      <ol className="sh-steps mt-5">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-well text-muted">
              <Icon name={step.icon} className="size-[18px]" />
            </span>
            <span className="min-w-0">
              <span className="block text-14 font-semibold">
                {i + 1}. {step.title}
              </span>
              <span className="mt-0.5 block text-13 text-muted">{step.text}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
