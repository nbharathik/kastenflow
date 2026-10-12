// Settings → Search by meaning: which OpenAI-compatible provider and model
// make notes' vectors (kept in the vault's config, ai.embeddings), and
// making them, with how far it got. The vectors stay on this computer in
// .kasten/cache; each note's text goes to the provider chosen to make one.

import { useEffect, useState } from "react";

import { Button } from "../../ui/Button";
import { useChat } from "../chat/store";
import { Group, Note, Row } from "../workspace/views/settings/parts";
import { useWorkspace } from "../workspace/store";
import { meaningApi, type MeaningApi, type MeaningStatus } from "./client";

/** OpenAI's small embedding model: cheap, and good at notes. */
export const DEFAULT_MODEL = "text-embedding-3-small";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function MeaningSettings({ api = meaningApi }: { api?: MeaningApi }) {
  const client = useWorkspace((s) => s.client);
  const providers = useChat((s) => s.providers);
  const [status, setStatus] = useState<MeaningStatus | null>(null);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [problem, setProblem] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const available = api.available();

  useEffect(() => {
    if (!available) return;
    if (providers === null) void useChat.getState().loadProviders();
    api.status().then(
      (found) => {
        setStatus(found);
        if (found.provider) setProvider(found.provider);
        if (found.model) setModel(found.model);
      },
      (err: unknown) => setProblem(message(err)),
    );
    return api.onProgress(setProgress);
  }, [api, available, providers]);

  if (!available) {
    return (
      <Group title="Search by meaning">
        <Row id="search.unavailable" />
      </Group>
    );
  }

  const makers = (providers ?? []).filter((p) => p.kind === "openai");
  const save = async () => {
    if (!client) return;
    setProblem(null);
    try {
      const config = await client.getConfig();
      const embeddings = provider ? { provider, model: model.trim() || DEFAULT_MODEL } : null;
      await client.setConfig({ ...config, ai: { ...config.ai, embeddings } });
      setStatus(await api.status());
    } catch (err) {
      setProblem(message(err));
    }
  };
  const make = async () => {
    setProblem(null);
    setStatus((s) => (s ? { ...s, running: true } : s));
    try {
      setStatus(await api.make());
    } catch (err) {
      setProblem(message(err));
      setStatus(await api.status().catch(() => null));
    } finally {
      setProgress(null);
    }
  };

  const chosen = status?.provider && status.model;
  const shown = progress ?? status;
  return (
    <Group title="Search by meaning">
      <Row id="search.provider" detail={makers.length ? undefined : "Add an OpenAI-compatible provider under AI providers first"}>
        <select aria-label="Provider for search by meaning" className="ui-field kasten-set-select" value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="">None</option>
          {makers.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      </Row>
      <Row id="search.model">
        <div className="flex gap-2">
          <input aria-label="Embedding model" className="ui-field w-56" value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
          <Button size="sm" icon="check" onClick={() => void save()}>
            Save
          </Button>
        </div>
      </Row>
      {chosen && shown && (
        <Row id="search.vectors" detail={`${shown.done} of ${shown.total} notes have vectors`}>
          {status?.running ? (
            <Button size="sm" icon="stop" onClick={() => void api.stop()}>
              Stop
            </Button>
          ) : (
            <Button size="sm" icon="sparkle" disabled={shown.done === shown.total} onClick={() => void make()}>
              Make vectors
            </Button>
          )}
        </Row>
      )}
      {problem && <Note tone="danger">{problem}</Note>}
    </Group>
  );
}
