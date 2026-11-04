// Settings → Agents → Coding agents in the chat: Claude Code and OpenCode, the
// programs the person already installed and signed in to. KastenFlow starts
// them for a chat; it holds no key for them and signs in to nothing. A missing
// one gets the commands that install it, and "Test" asks the program itself
// for its version and whether it is signed in.

import { useEffect, useState } from "react";

import { Button } from "../../../../ui/Button";
import { listAgents, testAgent } from "../../../chat/agents/client";
import type { AgentCheck, AgentInfo } from "../../../chat/agents/types";
import { Block, Row } from "./parts";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function CodingAgents() {
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, AgentCheck | "busy">>({});

  useEffect(() => {
    let live = true;
    listAgents().then(
      (list) => live && setAgents(list),
      (err) => live && setProblem(message(err)),
    );
    return () => {
      live = false;
    };
  }, []);

  const test = async (agent: AgentInfo) => {
    setChecks((c) => ({ ...c, [agent.id]: "busy" }));
    try {
      const result = await testAgent(agent.id);
      setChecks((c) => ({ ...c, [agent.id]: result }));
    } catch (err) {
      setChecks((c) => ({ ...c, [agent.id]: { ok: false, version: null, signedIn: null, message: message(err) } }));
    }
  };

  return (
    <Block id="agents.cli">
      {problem && (
        <Row label="The agents could not be looked for" detail={problem}>
          {null}
        </Row>
      )}
      {agents === null && !problem && <Row label="Looking for the agents…">{null}</Row>}
      {agents?.map((agent) => {
        const check = checks[agent.id];
        const detail = agent.found ? [agent.version ?? "Installed", agent.path].filter(Boolean).join(" · ") : "Not found on this computer";
        return (
          <div key={agent.id} data-agent={agent.id}>
            <Row label={agent.label} detail={detail}>
              <Button size="sm" icon="check" disabled={!agent.found || check === "busy"} onClick={() => void test(agent)} aria-label={`Test ${agent.label}`}>
                {check === "busy" ? "Testing…" : "Test"}
              </Button>
            </Row>
            {!agent.found && (
              <p className="px-3 pb-2 text-12 text-muted" role="note">
                {agent.install} {agent.signIn}
              </p>
            )}
            {check && check !== "busy" && (
              <p className="px-3 pb-2 text-12 text-muted" role="status" data-ok={check.ok}>
                {check.message}
              </p>
            )}
          </div>
        );
      })}
    </Block>
  );
}
