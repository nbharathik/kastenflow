// The steps of adding a paper: a paste is read into one or more drafts, each is
// reviewed (its key made for it and checked against every key, the repeats of
// it named) and saved. Everything is read on this computer; the only calls are
// to the vault's own bibliography.

import { useCallback, useEffect, useRef, useState } from "react";

import type { ReferenceMatch } from "../../lib/vault/reference-types";
import { useWorkspace } from "../workspace/store";
import type { AddRequest } from "./add-state";
import { blankDraft, keyHintsOf, newReferenceOf, trimmedFields, type PaperDraft } from "./draft";
import { keyProblem } from "./keys";
import { parsePaperInput } from "./parse-input";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The key a check is made with while the draft has none worth checking. */
const PROBE_KEY = "kasten-draft-check";

export type Stage = "paste" | "review";

export function useAddPaper(request: AddRequest, close: () => void) {
  const client = useWorkspace((s) => s.client);
  const [stage, setStage] = useState<Stage>(request.draft ? "review" : "paste");
  const [text, setText] = useState(request.text ?? "");
  const [queue, setQueue] = useState<PaperDraft[]>(request.draft ? [request.draft] : []);
  const [at, setAt] = useState(0);
  const [draft, setDraft] = useState<PaperDraft>(request.draft ?? blankDraft());
  const [keyTouched, setKeyTouched] = useState(Boolean(request.draft?.key));
  const [matches, setMatches] = useState<ReferenceMatch[]>([]);
  const [free, setFree] = useState<string | null>(null);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const then = useRef(request.then);

  const show = useCallback((list: PaperDraft[], index: number) => {
    const next = list[index] ?? blankDraft();
    setQueue(list);
    setAt(index);
    setDraft(next);
    setKeyTouched(Boolean(next.key));
    setMatches([]);
    setFree(null);
    setAllowDuplicate(false);
    setError(null);
    setStage("review");
  }, []);

  const read = () => {
    const parsed = parsePaperInput(text);
    if (parsed.drafts.length === 0) {
      setError("Paste something to read first, or choose Enter by hand.");
      return;
    }
    show(parsed.drafts, 0);
  };
  const byHand = () => show([blankDraft()], 0);

  // A key is made from the first author, the year and the title until the person writes one.
  const hints = keyHintsOf(draft.fields);
  const hintKey = JSON.stringify(hints);
  useEffect(() => {
    if (!client || stage !== "review" || keyTouched) return;
    if (Object.keys(hints).length === 0) {
      setDraft((d) => (d.key === "" ? d : { ...d, key: "" }));
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      client.suggestKey(hints).then(
        (key) => !cancelled && setDraft((d) => (d.key === key ? d : { ...d, key })),
        () => {
          // A key can still be typed.
        },
      );
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `hintKey` stands for `hints`, which is a new object each render.
  }, [client, stage, keyTouched, hintKey]);

  // What the bibliography already holds that this would repeat, and a free key for it.
  const checkKey = `${draft.type}|${draft.key}|${draft.fields.doi ?? ""}|${draft.fields.eprint ?? ""}`;
  useEffect(() => {
    const valid = keyProblem(draft.key) === null;
    const identified = Boolean((draft.fields.doi ?? "").trim() || (draft.fields.eprint ?? "").trim());
    if (!client || stage !== "review" || (!valid && !identified)) {
      setMatches([]);
      setFree(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      // Before a key is written, the DOI and arXiv number are still checked, with a stand-in key whose matches are ignored.
      const reference = { ...newReferenceOf(draft), key: valid ? draft.key : PROBE_KEY };
      client.checkReference(reference).then(
        (found) => {
          if (cancelled) return;
          const kept = valid ? found : found.filter((m) => m.by !== "key");
          setMatches(kept);
          if (kept.some((m) => m.by === "key")) void client.suggestKey(keyHintsOf(draft.fields)).then((key) => !cancelled && setFree(key.toLowerCase() === draft.key.toLowerCase() ? null : key), () => {});
          else setFree(null);
        },
        () => !cancelled && setMatches([]),
      );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `checkKey` stands for the parts of the draft the check reads.
  }, [client, stage, checkKey]);

  const next = () => {
    if (at + 1 < queue.length) show(queue, at + 1);
    else close();
  };

  const problem = stage === "review" ? keyProblem(draft.key) : null;
  const empty = Object.keys(trimmedFields(draft.fields)).length === 0;
  const keyTaken = matches.some((m) => m.by === "key");
  const canSave = !busy && problem === null && !empty && !keyTaken && (matches.length === 0 || allowDuplicate);

  const save = async () => {
    if (!client || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      const { managed } = await client.bibliography();
      const saved = await client.addReference(newReferenceOf(draft, allowDuplicate), managed.hash);
      const { toast } = useWorkspace.getState();
      const commit = saved.commit;
      toast(`Added “${saved.key}” to your references`, commit ? { label: "Undo", run: () => void client.undoCommit(commit).then(() => toast("Took back the reference"), (err: unknown) => toast(message(err))) } : undefined);
      then.current?.(saved.key);
      next();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return {
    stage,
    text,
    setText,
    read,
    byHand,
    draft,
    setDraft: (d: PaperDraft) => setDraft(d),
    setKey: (key: string) => {
      setKeyTouched(true);
      setDraft((d) => ({ ...d, key }));
    },
    takeFree: () => {
      if (!free) return;
      setKeyTouched(true);
      setDraft((d) => ({ ...d, key: free }));
    },
    free,
    matches,
    allowDuplicate,
    setAllowDuplicate,
    problem,
    keyTaken,
    canSave,
    busy,
    error,
    save,
    skip: next,
    back: () => setStage("paste"),
    position: queue.length > 1 ? { at: at + 1, of: queue.length } : null,
    cameWithDraft: Boolean(request.draft),
    empty,
  };
}
