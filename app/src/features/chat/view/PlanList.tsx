// The assistant's plan for a long task, as a small checklist above its answer.
// It folds away (and stays folded), and is kept with the thread.

import "../harness.css";

import { Disclosure } from "../../../ui/Disclosure";
import { Icon } from "../../../ui/Icon";
import type { IconName } from "../../../ui/icons";
import type { PlanItem, PlanStatus } from "../agent-types";

const ICONS: Record<PlanStatus, IconName> = { todo: "circle", doing: "circle-dot", done: "circle-check" };
const WORDS: Record<PlanStatus, string> = { todo: "to do", doing: "in progress", done: "done" };

export function PlanList({ plan }: { plan: PlanItem[] }) {
  const done = plan.filter((p) => p.status === "done").length;
  return (
    <Disclosure id="chat-plan" title="Plan" meta={`${done} of ${plan.length} done`} defaultOpen className="kasten-chat-plan">
      <ol aria-label="Plan">
        {plan.map((item) => (
          <li key={item.id} data-status={item.status} aria-current={item.status === "doing" ? "step" : undefined}>
            <Icon name={ICONS[item.status]} className="size-3.5" />
            <span>
              {item.text}
              <span className="sr-only"> ({WORDS[item.status]})</span>
            </span>
          </li>
        ))}
      </ol>
    </Disclosure>
  );
}
