// The store's small actions that change one field of one thread: its images
// setting, context chips, name, pinned answer, undo mark and staged changes.

import { MAX_KEPT } from "./selection/chip";
import type { ChatState } from "./store";
import { keptCount } from "./store-selection";
import { chipKey, followChips, type Answer, type Thread } from "./thread";

type Update = (id: string, change: (thread: Thread) => Thread) => void;

type Fields = Pick<
  ChatState,
  "setAllowImages" | "addChip" | "removeChip" | "followPage" | "setFollow" | "pinChip" | "rename" | "pinned" | "undone" | "setDirect" | "setChanges" | "applied"
>;

/** The field actions for the store's `update`. */
export function fieldActions(update: Update): Fields {
  return {
    setAllowImages(id, allow) {
      update(id, (t) => ((t.allowImages ?? false) === allow ? t : { ...t, allowImages: allow }));
    },

    addChip(id, chip) {
      const key = chipKey(chip);
      // A chip the person adds stays; one that is followed says so.
      update(id, (t) => (t.context.some((c) => chipKey(c) === key) ? t : { ...t, context: [...t.context, { ...chip, origin: chip.origin ?? "added" }] }));
    },

    removeChip(id, key) {
      update(id, (t) => ({ ...t, context: t.context.filter((c) => chipKey(c) !== key) }));
    },

    followPage(id, chip) {
      update(id, (t) => {
        if (t.follow === false) return t;
        const context = followChips(t.context, chip);
        return context === t.context ? t : { ...t, context };
      });
    },

    setFollow(id, follow) {
      update(id, (t) => (t.follow === follow || (follow && t.follow === undefined) ? t : { ...t, follow }));
    },

    pinChip(id, key, pinned) {
      update(id, (t) => {
        // Only five snippets are kept for one question.
        const full = pinned && t.context.some((c) => chipKey(c) === key && c.kind === "selection") && keptCount(t) >= MAX_KEPT;
        return full ? t : { ...t, context: t.context.map((c) => (chipKey(c) === key && (c.origin ?? "added") !== "added" ? { ...c, origin: pinned ? "pinned" : "auto" } : c)) };
      });
    },

    rename(id, title) {
      const name = title.trim().slice(0, 120);
      update(id, (t) => (name ? { ...t, title: name } : { ...t, title: undefined }));
    },

    pinned(id, messageId, path) {
      update(id, (t) => ({ ...t, messages: t.messages.map((m) => (m.id === messageId && m.role === "assistant" ? ({ ...m, pinned: path } satisfies Answer) : m)) }));
    },

    undone(id, undone = true) {
      update(id, (t) => ({ ...t, undone }));
    },

    setDirect(id, direct) {
      update(id, (t) => ((t.direct ?? false) === direct ? t : { ...t, direct }));
    },

    setChanges(id, changes) {
      update(id, (t) => (t.changes?.id === changes?.id && t.changes?.count === changes?.count ? t : { ...t, changes }));
    },

    applied(id) {
      update(id, (t) => ({ ...t, changes: undefined, changed: true, undone: false }));
    },
  };
}
