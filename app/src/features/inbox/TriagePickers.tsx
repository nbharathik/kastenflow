// The two pickers triage adds to the Inbox's tag and board ones: a saved
// collection to add the card to, and a time to put it off to.

import { useEffect, useRef, useState } from "react";

import { dayFrom, isDay, shortDay } from "../../lib/dates";
import type { Collection } from "../../lib/vault/collection-types";
import type { NoteMeta } from "../../lib/vault/types";
import { Picker, type PickerOption } from "../library/Picker";
import { useWorkspace } from "../workspace/store";
import { joinCollection, deferCard } from "./triage-actions";
import { joinTags, whyNotJoin } from "./join";
import { laterDay, type Later } from "./queue";

interface PickerProps {
  card: NoteMeta;
  open: boolean;
  onOpen(): void;
  onClose(): void;
  /** The key that opens it, shown on the button. */
  hint: string;
}

function Opener({ label, hint, open, onClick }: { label: string; hint: string; open: boolean; onClick(): void }) {
  return (
    <button type="button" className="ui-btn" aria-expanded={open} aria-keyshortcuts={hint} onClick={onClick}>
      <kbd className="rounded bg-line/70 px-1.5 font-sans text-11">{hint}</kbd>
      {label}
    </button>
  );
}

/** Adds the card to a saved collection that is only tags: it gains them. */
export function CollectionAction({ card, open, onOpen, onClose, hint }: PickerProps) {
  const client = useWorkspace((s) => s.client);
  const [list, setList] = useState<Collection[] | null>(null);
  const within = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open || !client) return;
    setList(null);
    client.collections().then(setList, () => setList([]));
  }, [open, client]);

  const options: PickerOption[] | null =
    list?.map((collection) => {
      const why = whyNotJoin(collection);
      const tags = joinTags(collection);
      return { key: collection.path, label: collection.name, icon: collection.icon ?? undefined, detail: why ?? tags?.map((t) => `#${t}`).join(" "), disabled: why !== null };
    }) ?? null;

  return (
    <span ref={within} className="relative">
      <Opener label="Collection" hint={hint} open={open} onClick={open ? onClose : onOpen} />
      {open && (
        <Picker
          label="Add to collection"
          placeholder="Find a collection…"
          options={options}
          empty="No saved collections yet"
          within={within}
          onClose={onClose}
          onPick={(path) => {
            const found = list?.find((c) => c.path === path);
            onClose();
            if (found) void joinCollection(card, found);
          }}
        />
      )}
    </span>
  );
}

const LATER: readonly { key: Later; label: string }[] = [
  { key: "tomorrow", label: "Tomorrow" },
  { key: "week", label: "In a week" },
  { key: "month", label: "In a month" },
];

/** Puts the card off: tomorrow, a week or a month on, or a day typed in. */
export function LaterAction({ card, open, onOpen, onClose, hint }: PickerProps) {
  const within = useRef<HTMLSpanElement>(null);
  const today = dayFrom(0);
  const options: PickerOption[] = LATER.map(({ key, label }) => ({ key, label, detail: shortDay(laterDay(key, today)) }));
  const pick = (day: string) => {
    onClose();
    void deferCard(card, day);
  };
  return (
    <span ref={within} className="relative">
      <Opener label="Later" hint={hint} open={open} onClick={open ? onClose : onOpen} />
      {open && (
        <Picker
          label="Put off until"
          placeholder="Pick a time, or type a day like 2026-10-20…"
          options={options}
          within={within}
          onClose={onClose}
          onPick={(key) => pick(laterDay(key as Later, today))}
          create={{
            label: (text) => (isDay(text) && text > today ? `Put off until ${shortDay(text)}` : null),
            run: (text) => pick(text),
          }}
        />
      )}
    </span>
  );
}
