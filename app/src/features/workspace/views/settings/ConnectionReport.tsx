// Settings → AI providers → Connection report: the last requests to the AI
// providers, for finding out why a chat or a sign-in does not work. How far
// each got, how it ended, the tries it took and how long. It holds no key,
// token, prompt or answer, so it can be copied into a message as it is.

import "./report.css";

import { useEffect, useState } from "react";

import { Button } from "../../../../ui/Button";
import type { RequestOutcome } from "../../../chat/agent-types";
import { useChat } from "../../../chat/store";
import { Block, Group } from "./parts";
import { clockOf, reportText, resultOf, speedOf, stageOf, triesOf } from "./report";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function ConnectionReport() {
  const [rows, setRows] = useState<RequestOutcome[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const read = () =>
    useChat
      .getState()
      .ensure()
      .diagnostics()
      .then(
        (found) => {
          setRows(found);
          setProblem(null);
        },
        (err) => setProblem(message(err)),
      );
  useEffect(() => {
    void read();
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reportText(rows ?? []));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      setProblem(message(err));
    }
  };
  const clear = async () => {
    try {
      await useChat.getState().ensure().clearDiagnostics();
      setRows([]);
    } catch (err) {
      setProblem(message(err));
    }
  };

  return (
    <Group
      title="Connection report"
      sub
      help="The last requests to your AI providers: how far each got, how it ended, the tries it took and how long. It holds no keys, tokens, prompts or answers, so you can copy it into a message when a chat or a sign-in does not work."
    >
      <Block id="ai.report">
        {problem && (
          <p role="alert" className="kasten-set-report-note is-danger">
            {problem}
          </p>
        )}
        {rows === null && !problem && <p className="kasten-set-report-note">Reading the report…</p>}
        {rows?.length === 0 && <p className="kasten-set-report-note">No requests yet. The last ones are listed here once a chat has asked a model.</p>}
        {rows && rows.length > 0 && (
          <div className="kasten-set-report" tabIndex={0} role="region" aria-label="Recent requests">
            <table>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Model</th>
                  <th scope="col">Reached</th>
                  <th scope="col">Result</th>
                  <th scope="col">Tries</th>
                  <th scope="col">Speed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={`${row.at}:${i}`} data-ok={row.ok}>
                    <td>{clockOf(row.at)}</td>
                    <td title={row.route}>
                      {row.provider} · {row.model}
                    </td>
                    <td>{stageOf(row.stage)}</td>
                    <td>{resultOf(row)}</td>
                    <td>{triesOf(row)}</td>
                    <td>{speedOf(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="kasten-set-foot">
          <Button size="sm" icon="refresh" onClick={() => void read()}>
            Refresh
          </Button>
          <Button size="sm" icon="copy" disabled={!rows || rows.length === 0} onClick={() => void copy()}>
            {copied ? "Copied" : "Copy report"}
          </Button>
          <Button size="sm" icon="trash" disabled={!rows || rows.length === 0} onClick={() => void clear()}>
            Clear
          </Button>
        </div>
      </Block>
    </Group>
  );
}
