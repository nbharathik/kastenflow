// "An agent wrote code that draws a picture": shown before agent-written code runs for a deck that has not been allowed. The code
// is shown, the places it can reach are said (none but the inputs named), and the person decides: allow it for this deck, run it
// this once, or not run it. The app waits for the answer and keeps the code from running without it.

import { useState } from "react";

import { Button } from "../../../ui/Button";
import { Modal } from "../../../ui/Modal";
import { allowGenerator, answerApp } from "./backend";
import { type AskRequest, useGeneratorAsk } from "./ask-state";

/** What a person's choice does. */
export type Choice = "always" | "once" | "no";

/** Carries out a choice: remembers the deck for "always", and tells the app. Never throws. */
export async function decide(request: AskRequest, choice: Choice): Promise<string | null> {
  try {
    if (choice === "always") await allowGenerator(request.deck, request.hash);
    await answerApp(request.id, { text: choice === "no" ? "deny" : "allow" });
    return null;
  } catch (err) {
    // The app is told not to run it, and the person is told why their choice was not kept.
    await answerApp(request.id, { text: "deny" }).catch(() => {});
    return err instanceof Error ? err.message : String(err);
  }
}

function Question({ request }: { request: AskRequest }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const choose = async (choice: Choice) => {
    setBusy(true);
    const failed = await decide(request, choice);
    setBusy(false);
    if (failed) setProblem(failed);
    else useGeneratorAsk.getState().next();
  };
  const cut = request.codeBytes > request.code.length;
  return (
    <Modal label="An agent wants to run code" onClose={() => void choose("no")} className="w-[min(640px,94vw)] p-5">
      <h2 className="text-16 font-semibold">An agent wants to run code</h2>
      <p className="mt-3 text-13">
        <strong>{request.agent}</strong> wrote code that draws a picture in <strong>{request.deck || "a deck"}</strong>. It runs in a sandbox: no network, no
        files, no access to your vault{request.inputs.length > 0 ? `, only what it was given (${request.inputs.join(", ")})` : ""}.
      </p>
      <pre aria-label="The code" className="mt-3 max-h-[min(300px,40vh)] overflow-auto rounded-lg border border-line p-3 text-12">
        {request.code}
        {cut ? `\n… (${request.codeBytes - request.code.length} more characters)` : ""}
      </pre>
      <p className="mt-2 text-12 text-muted">
        Code hash (SHA-256): <code className="break-all">{request.hash}</code>
      </p>
      {problem && (
        <p role="alert" className="mt-3 text-13 text-danger">
          {problem}
        </p>
      )}
      <div className="mt-4 flex items-center justify-end gap-2">
        <Button disabled={busy} onClick={() => void choose("no")}>
          Do not run
        </Button>
        <Button disabled={busy} onClick={() => void choose("once")}>
          Run once
        </Button>
        {request.deck && (
          <Button tone="primary" disabled={busy} onClick={() => void choose("always")}>
            Allow to run
          </Button>
        )}
      </div>
      <p className="mt-2 text-12 text-muted">
        {request.deck
          ? "Allow to run keeps the choice for this code in this deck. Code that is changed asks again."
          : "This picture is in no deck, so the choice cannot be kept: each time asks."}
      </p>
    </Modal>
  );
}

/** The question at the front of the queue, if there is one. */
export default function AllowDialog() {
  const request = useGeneratorAsk((state) => state.queue[0]);
  return request ? <Question key={request.id} request={request} /> : null;
}
