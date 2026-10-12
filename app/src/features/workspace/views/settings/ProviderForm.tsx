// Adding or changing an AI provider. It starts from a service (Anthropic,
// OpenAI, OpenRouter, a local server) that fills in the kind and address.
// The model can be picked from the provider's own list, and the connection
// tested before anything is saved. The key goes to the system keychain
// through the backend and never comes back: the form says only whether one
// is stored. An empty key field keeps the stored key; "Remove key" deletes
// it. A key typed here is sent with a model list or test only for that
// request.

import { useState, type ReactNode } from "react";

import { useChat } from "../../../chat/store";
import type { KeyedProvider, ProviderCheck, ProviderKind } from "../../../chat/types";
import { Segmented } from "./parts";
import { CheckResult } from "./providers/CheckResult";
import { ModelField } from "./providers/ModelField";
import { freeName, presetById, presetOf, type PresetId } from "./providers/presets";
import { ServicePicker } from "./providers/ServicePicker";

export const DEFAULT_URLS: Record<ProviderKind, string> = { anthropic: "https://api.anthropic.com", openai: "https://api.openai.com/v1" };

const KINDS: { id: ProviderKind; label: string }[] = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI-compatible" },
];

const MODEL_HINTS: Record<ProviderKind, string> = { anthropic: "The model's ID, from the provider's list", openai: "The model's ID, or the one your server serves" };
const URL_HINTS: Record<ProviderKind, string> = { anthropic: DEFAULT_URLS.anthropic, openai: "http://local-server:8000/v1" };

const INPUT = "ui-field";
const BUTTON = "ui-btn";
const PRIMARY = "ui-btn is-primary";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const isUrl = (url: string) => /^https?:\/\/\S+$/.test(url.trim());

/** A labelled input, its hint after the label so the input's name stays short. */
function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className="text-13 font-medium text-muted">{label}</span>
        {children}
      </label>
      {hint && <div className="text-12 text-muted">{hint}</div>}
    </div>
  );
}

interface Props {
  /** The provider to change; null for a new one. */
  provider: KeyedProvider | null;
  /** Names other providers have. */
  taken: string[];
  onDone(): void;
}

export function ProviderForm({ provider, taken, onDone }: Props) {
  const [preset, setPreset] = useState<PresetId>(provider ? presetOf(provider.kind, provider.baseUrl).id : "anthropic");
  const [name, setName] = useState(provider?.name ?? freeName(presetById("anthropic").label, taken));
  // A name you typed stays when the service changes.
  const [named, setNamed] = useState(Boolean(provider));
  const [kind, setKind] = useState<ProviderKind>(provider?.kind ?? "anthropic");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? DEFAULT_URLS.anthropic);
  const [model, setModel] = useState(provider?.model ?? "");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<{ asked: string; result: ProviderCheck } | null>(null);

  const clash = !provider && taken.some((t) => t.toLowerCase() === name.trim().toLowerCase());
  const problem = !name.trim()
    ? "Give it a name"
    : clash
      ? "Another provider has this name"
      : !isUrl(baseUrl)
        ? "The base URL starts with http:// or https://"
        : !model.trim()
          ? "Name the model new chats start with"
          : null;

  const service = presetById(preset);
  const draft = () => ({ name: name.trim() || service.label, kind, baseUrl: baseUrl.trim(), model: model.trim() });
  const typedKey = () => (key.trim() ? key.trim() : null);
  // What a model list and a test depend on: a new address or key asks again.
  const source = `${kind}|${baseUrl.trim()}|${key.trim() ? "typed" : "stored"}`;
  const asked = `${source}|${model.trim()}`;

  const pickService = (id: PresetId) => {
    const next = presetById(id);
    setPreset(id);
    if (id !== "custom") {
      setKind(next.kind);
      setBaseUrl(next.baseUrl);
    } else if (presetOf(kind, baseUrl).id !== "custom") {
      // A service's own address is no start for your own server.
      setKind("openai");
      setBaseUrl("");
    }
    if (!named) setName(id === "custom" ? "" : freeName(next.label, taken));
  };

  const changeUrl = (url: string) => {
    setBaseUrl(url);
    setPreset(presetOf(kind, url).id);
  };

  const changeKind = (next: ProviderKind) => {
    setKind(next);
    // A default address follows the kind; one you typed stays.
    if (!baseUrl.trim() || Object.values(DEFAULT_URLS).includes(baseUrl.trim())) setBaseUrl(DEFAULT_URLS[next]);
  };

  const test = async () => {
    setChecking(true);
    setCheck(null);
    const current = draft();
    try {
      setCheck({ asked, result: await useChat.getState().ensure().testProviderDraft(current, typedKey()) });
    } catch (err) {
      setCheck({ asked, result: { ok: false, model: current.model, millis: 0, reply: "", message: message(err) } });
    } finally {
      setChecking(false);
    }
  };

  const save = async () => {
    if (problem) return;
    setBusy(true);
    setError(null);
    try {
      await useChat.getState().saveProvider({ name: name.trim(), kind, baseUrl: baseUrl.trim(), model: model.trim() }, key.trim() ? key.trim() : null);
      onDone();
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };

  const removeKey = async () => {
    if (!provider) return;
    setBusy(true);
    setError(null);
    try {
      const { name, kind, baseUrl, model } = provider;
      await useChat.getState().saveProvider({ name, kind, baseUrl, model }, "");
    } catch (err) {
      setError(message(err));
    }
    setBusy(false);
  };

  return (
    <form
      aria-label={provider ? `Change ${provider.name}` : "New AI provider"}
      className="@container flex flex-col gap-3 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      onKeyDown={(event) => event.key === "Escape" && onDone()}
    >
      {/* Not a <label>: it would name the first choice after itself. */}
      <div className="flex flex-col gap-1">
        <span className="text-13 font-medium text-muted">Service</span>
        <ServicePicker value={preset} onChange={pickService} />
      </div>
      <div className="grid gap-3 @lg:grid-cols-2">
        <Field label="Name" hint={provider ? "To rename a provider, add it again under the new name." : undefined}>
          <input
            className={INPUT}
            value={name}
            autoFocus={!provider}
            readOnly={Boolean(provider)}
            aria-label="Name"
            placeholder="Claude, or Local server"
            onChange={(e) => {
              setName(e.target.value);
              setNamed(true);
            }}
          />
        </Field>
        {preset === "custom" && (
          <div className="flex flex-col gap-1">
            <span className="text-13 font-medium text-muted">Kind</span>
            <Segmented label="Kind" value={kind} options={KINDS} onChange={changeKind} />
          </div>
        )}
        <Field label="Base URL" hint={service.local ? "Its usual port on this computer." : undefined}>
          <input className={INPUT} value={baseUrl} aria-label="Base URL" placeholder={URL_HINTS[kind]} spellCheck={false} onChange={(e) => changeUrl(e.target.value)} />
        </Field>
        <ModelField
          value={model}
          onChange={setModel}
          placeholder={MODEL_HINTS[kind]}
          autoFocus={Boolean(provider)}
          source={source}
          ready={isUrl(baseUrl)}
          list={() => useChat.getState().ensure().listProviderModels(draft(), typedKey())}
        />
      </div>
      <Field
        label="API key"
        hint={
          <span className="flex flex-wrap items-center gap-x-2">
            <span>
              {provider?.hasKey ? "Stored in your system keychain for this address. Leave this empty to keep it." : `No key stored for this address. ${service.keyHint}`} A key is only sent to the address it was saved
              for, over https or to this computer.
            </span>
            {provider?.hasKey && (
              <button type="button" className="text-accent underline-offset-2 hover:underline disabled:opacity-50" disabled={busy} onClick={() => void removeKey()}>
                Remove key
              </button>
            )}
          </span>
        }
      >
        <input
          className={INPUT}
          type="password"
          value={key}
          aria-label="API key"
          autoComplete="off"
          spellCheck={false}
          placeholder={provider?.hasKey ? "A new key replaces the stored one" : "Paste the key"}
          onChange={(e) => setKey(e.target.value)}
        />
      </Field>
      {(error || problem) && (
        <p role={error ? "alert" : undefined} className={`text-13 ${error ? "text-danger" : "text-muted"}`}>
          {error ?? problem}
        </p>
      )}
      {checking && <p className="text-13 text-muted">Asking the model for one word…</p>}
      {check?.asked === asked && <CheckResult check={check.result} className="text-13" />}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={`${BUTTON} mr-auto`} disabled={busy || checking || !isUrl(baseUrl) || !model.trim()} onClick={() => void test()}>
          {checking ? "Testing…" : "Test connection"}
        </button>
        <button type="button" className={BUTTON} onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className={PRIMARY} disabled={busy || Boolean(problem)}>
          {busy ? "Saving…" : provider ? "Save" : "Add provider"}
        </button>
      </div>
    </form>
  );
}
