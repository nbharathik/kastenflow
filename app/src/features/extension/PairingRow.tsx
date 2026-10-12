import { useEffect, useState } from "react";

import { relativeTime } from "../../lib/dates";
import { Button } from "../../ui/Button";
import { Block, Row } from "../workspace/views/settings/parts";
import { secondsLeft, useExtension } from "./store";

/** `ABCD2345` as `ABCD-2345`, which is how it is read out and typed. */
export const spaced = (code: string): string => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code);

/** 105 seconds as `1:45`. */
export const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** Pairing: Pair makes a code that is shown here for a couple of minutes, which
 * the extension asks for once; while it waits, the app is asked now and then
 * whether the extension took it. Then the extensions that are paired, each
 * with a way to revoke it. */
export function PairingRow({ pollMs }: { pollMs: number }) {
  const status = useExtension((s) => s.status);
  const at = useExtension((s) => s.at);
  const waiting = status?.pairing ?? null;
  const [now, setNow] = useState(() => Date.now());
  const left = secondsLeft(status, at, now);

  useEffect(() => {
    if (!waiting) return undefined;
    const tick = setInterval(() => setNow(Date.now()), 500);
    const poll = setInterval(() => void useExtension.getState().refresh(), pollMs);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [waiting !== null, pollMs]);

  // The time ran out here: ask the app, which has forgotten the code too.
  useEffect(() => {
    if (waiting && left === 0) void useExtension.getState().refresh();
  }, [waiting !== null, left === 0]);

  const change = useExtension.getState().change;
  const paired = status?.paired ?? [];
  const open = status?.running === true;

  return (
    <>
      <Row
        id="extension.pair"
        detail={waiting ? "In the extension, press Pair and type this code." : open ? "Make a code, then type it into the extension." : "Turn the extension on first."}
        help={waiting ? "In the extension's popup, press Pair and type this code. It works once." : undefined}
      >
        {waiting ? (
          <div className="flex flex-col items-end gap-1.5">
            <output aria-label="Pairing code" className="kasten-extension-code">
              {spaced(waiting.code)}
            </output>
            <span className="text-13 text-muted">
              {left > 0 ? `${clock(left)} left` : "Out of time"} · {waiting.triesLeft} {waiting.triesLeft === 1 ? "try" : "tries"}
            </span>
            <Button size="sm" tone="quiet" onClick={() => void change((b) => b.pairCancel())}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button size="sm" icon="plug" disabled={!open} onClick={() => void change((b) => b.pairStart())}>
            Pair
          </Button>
        )}
      </Row>
      <Block id="extension.paired" titled>
        {paired.length === 0 ? (
          <p className="kasten-set-quiet">None yet.</p>
        ) : (
          <ul aria-label="Paired extensions" className="kasten-set-list-plain">
            {paired.map((extension) => (
              <li key={extension.id} className="flex items-center gap-2 py-0.5">
                <span className="font-medium">{extension.label}</span>
                <span className="min-w-0 flex-1 truncate text-muted" title={extension.origin}>
                  {extension.origin.replace(/^[a-z-]+:\/\//, "")} · paired {relativeTime(extension.pairedAt)}
                </span>
                <Button size="sm" tone="quiet" aria-label={`Revoke ${extension.label}`} onClick={() => void change((b) => b.revoke(extension.id))}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Block>
    </>
  );
}
