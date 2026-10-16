// Settings → AI providers → Agent limits: how much the chat's assistant may do
// in one go (steps, tool calls, minutes) before it pauses and waits for
// Continue. A pause is not a failure: it keeps everything it has done.

import { useEffect, useState } from "react";

import { BUDGET_LIMITS, DEFAULT_BUDGETS, type ChatBudgets } from "../../../chat/agent-types";
import { useChat } from "../../../chat/store";
import { useWorkspace } from "../../store";
import { Group, resetOf, Row } from "./parts";

type Key = keyof ChatBudgets;

const ROWS: { key: Key; id: string; unit: string }[] = [
  { key: "rounds", id: "ai.budgetRounds", unit: "steps" },
  { key: "calls", id: "ai.budgetCalls", unit: "tool calls" },
  { key: "minutes", id: "ai.budgetMinutes", unit: "minutes" },
];

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function AgentLimits() {
  const [budgets, setBudgets] = useState<ChatBudgets | null>(null);
  const toast = useWorkspace((s) => s.toast);

  useEffect(() => {
    let live = true;
    useChat
      .getState()
      .ensure()
      .budgets()
      .then(
        (found) => live && setBudgets(found),
        () => {},
      );
    return () => {
      live = false;
    };
  }, []);

  const save = async (key: Key, typed: number) => {
    if (!budgets || !Number.isFinite(typed)) return;
    const { min, max } = BUDGET_LIMITS[key];
    const value = Math.min(max, Math.max(min, Math.round(typed)));
    if (value === budgets[key]) return;
    try {
      const next = { ...budgets, [key]: value };
      await useChat.getState().ensure().setBudgets(next);
      setBudgets(next);
      toast("Saved the new limit");
    } catch (err) {
      toast(message(err));
    }
  };

  return (
    <Group title="Agent limits" sub help="How much the assistant may do in one go before it pauses. A pause keeps everything it has done: press Continue to let it go on with a fresh allowance.">
      {ROWS.map(({ key, id, unit }) => {
        const shown = budgets?.[key] ?? DEFAULT_BUDGETS[key];
        return (
          <Row key={key} id={id} {...(budgets ? resetOf(shown, DEFAULT_BUDGETS[key], (usual) => void save(key, usual)) : {})}>
            <label className="flex items-center gap-1.5 text-13 text-muted">
              <input
                // Drawn again once the saved value is read, or after a reset.
                key={`${budgets ? "read" : "reading"}:${shown}`}
                type="number"
                min={BUDGET_LIMITS[key].min}
                max={BUDGET_LIMITS[key].max}
                disabled={!budgets}
                aria-label={ROW_LABELS[key]}
                defaultValue={shown}
                className="ui-field kasten-set-number"
                onBlur={(event) => {
                  // An empty box keeps what was there.
                  if (event.currentTarget.value.trim() === "") event.currentTarget.value = String(shown);
                  else void save(key, Number(event.currentTarget.value));
                }}
                onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
              />
              {unit}
            </label>
          </Row>
        );
      })}
    </Group>
  );
}

/** The names of the fields, as the index has them. */
const ROW_LABELS: Record<Key, string> = { rounds: "Steps in one go", calls: "Tool calls in one go", minutes: "Minutes in one go" };
