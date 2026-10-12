// Settings for AI agents: how to connect one, and the guardrail limits
// after which its changes wait for review.

import { useEffect, useState } from "react";

import { appInfo, mcpToken } from "../../../../lib/api";
import type { VaultConfig } from "../../../../lib/vault/types";
import { Button } from "../../../../ui/Button";
import { useWorkspace } from "../../store";
import { appServer, BARE, claudeCodeCommand, httpCommand, httpUrl, mcpConfig, tokenPath, urlConfig, type Server } from "./connect";
import { entryById } from "./index";
import { Group, Row } from "./parts";

interface Limit {
  key: string;
  unit: string;
  /** From the stored value to the one shown, and back. */
  show: (value: number) => number;
  store: (value: number) => number;
}

const same = (v: number) => v;

/** The labels and explanations of these are in the index, by `agents.limit.<key>`. */
const LIMITS: Limit[] = [
  { key: "max_removed_fraction", unit: "%", show: (v) => Math.round(v * 100), store: (v) => v / 100 },
  { key: "max_notes_per_session_10min", unit: "notes", show: same, store: same },
  { key: "max_trash_per_session", unit: "notes", show: same, store: same },
  { key: "max_board_nodes_removed", unit: "cards", show: same, store: same },
  { key: "max_slides_removed", unit: "slides", show: same, store: same },
  { key: "max_write_bytes", unit: "KB", show: (v) => Math.round(v / 1024), store: (v) => v * 1024 },
  { key: "max_asset_bytes", unit: "MB", show: (v) => Math.round(v / 1048576), store: (v) => v * 1048576 },
  { key: "max_assets_per_session_10min", unit: "pictures", show: same, store: same },
  { key: "max_asset_bytes_per_session_10min", unit: "MB", show: (v) => Math.round(v / 1048576), store: (v) => v * 1048576 },
];

export function AgentSettings() {
  const client = useWorkspace((s) => s.client);
  const toast = useWorkspace((s) => s.toast);
  const [config, setConfig] = useState<VaultConfig | null>(null);

  // The installed app serves MCP itself; the browser preview shows kasten-mcp.
  const [server, setServer] = useState<Server>(BARE);
  useEffect(() => {
    client?.getConfig().then(setConfig, () => {});
  }, [client]);
  useEffect(() => {
    appInfo().then((info) => info?.exe && setServer(appServer(info.exe)), () => {});
  }, []);

  const save = async (key: string, value: number) => {
    if (!client || !config || !Number.isFinite(value) || value < 0 || config.guardrails[key] === value) return;
    try {
      // Read again first: the AI providers live in the same file and
      // may have changed since this section loaded it.
      const current = await client.getConfig();
      const next = { ...current, guardrails: { ...current.guardrails, [key]: value } };
      await client.setConfig(next);
      setConfig(next);
      toast("Saved the new limit");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  };

  const vault = client?.kind === "preview" ? "~/Notes" : (client?.label ?? "~/Notes");
  const { go } = useWorkspace.getState();
  const limits = config ? LIMITS.filter((limit) => config.guardrails[limit.key] !== undefined) : [];

  return (
    <>
      <Group title="AI agents">
        <Row id="agents.claude">
          <CopyButton text={claudeCodeCommand(vault, server)} label="Copy command" />
        </Row>
        <Row id="agents.config">
          <CopyButton text={mcpConfig(vault, server)} label="Copy the config" />
        </Row>
        <Row
          id="agents.url"
          help={`Start the server with the command, then connect to ${httpUrl()} with the token as a bearer. It answers this computer only; the token is kept in ${tokenPath(vault)}.`}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <CopyButton text={httpCommand(vault, server)} label="Copy the command" />
            <CopyButton text={urlConfig()} label="Copy the URL config" />
            <TokenButton />
          </div>
        </Row>
        <Row id="agents.review">
          <div className="flex gap-1.5">
            <Button size="sm" icon="review" onClick={() => go({ view: "review" })}>
              Review
            </Button>
            <Button size="sm" icon="history" onClick={() => go({ view: "history" })}>
              History
            </Button>
          </div>
        </Row>
      </Group>
      {limits.length > 0 && (
        <Group title="Review limits" sub help="Past these, an agent's changes wait for your review, or are refused outright.">
          {limits.map((limit) => (
            <Row key={limit.key} id={`agents.limit.${limit.key}`}>
              <label className="flex items-center gap-1.5 text-13 text-muted">
                <input
                  type="number"
                  min={0}
                  aria-label={limitLabel(limit.key)}
                  defaultValue={limit.show(config!.guardrails[limit.key]!)}
                  className="ui-field kasten-set-number"
                  onBlur={(e) => void save(limit.key, limit.store(Number(e.currentTarget.value)))}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
                {limit.unit}
              </label>
            </Row>
          ))}
        </Group>
      )}
    </>
  );
}

/** The name of a limit's field, from its entry in the index. */
const limitLabel = (key: string) => entryById(`agents.limit.${key}`)?.label ?? key;

/** Copies the HTTP server's token, which is never shown. */
function TokenButton() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const { toast } = useWorkspace.getState();
    try {
      const token = await mcpToken();
      if (!token) return toast("The browser preview serves no MCP, so it has no token");
      await navigator.clipboard?.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <Button size="sm" icon={copied ? "check" : "copy"} onClick={() => void copy()}>
      {copied ? "Copied" : "Copy the token"}
    </Button>
  );
}

/** A button that copies `text` when clicked; the text itself is its tooltip. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      icon={copied ? "check" : "copy"}
      title={`Copy: ${text}`}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true));
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}
