// Settings → AI providers: "Continue with ChatGPT". The person's ChatGPT plan
// pays for chats, AI writing, brainstorms and suggestions, with no API key.
// Starting opens ChatGPT's own page in the system browser (never in the app);
// the app hears back through an event when the sign-in ends. The browser
// preview shows the button switched off.

import { useEffect, useState } from "react";

import { openUrl } from "../../../../lib/api";
import {
  CHATGPT_NAME,
  CHATGPT_USAGE_URL,
  canSignInWithChatGpt,
  chatgptAccount,
  chatgptProblem,
  chatgptSignInCancel,
  chatgptSignInStart,
  chatgptSignOut,
  onChatGptSignIn,
  type ChatGptAccount,
} from "../../../chat/chatgpt";
import { Button } from "../../../../ui/Button";
import { useChat } from "../../../chat/store";
import type { ChatProvider } from "../../../chat/types";
import { useWorkspace } from "../../store";
import { Row } from "./parts";
import { ModelField } from "./providers/ModelField";
import { freeName } from "./providers/presets";

const BUTTON = "ui-btn";
const PRIMARY = "ui-btn is-primary";
/** The model a ChatGPT provider starts with when the account lists none. */
const DEFAULT_MODEL = "gpt-6.1-sol";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

type Phase = { is: "idle" } | { is: "waiting"; url: string } | { is: "problem"; text: string; retry: boolean };

/** Makes the ChatGPT provider in this vault's settings, if it has none: the
 * account's first model, else a documented name. */
async function addProvider(): Promise<void> {
  const chat = useChat.getState();
  if (chat.providers === null) await chat.loadProviders();
  const known = useChat.getState().providers ?? [];
  if (known.some((p) => p.kind === "chatgpt")) return;
  const draft = { name: freeName(CHATGPT_NAME, known.map((p) => p.name)), kind: "chatgpt" as const, baseUrl: "", model: "" };
  const models = await chat.ensure().listProviderModels(draft, null).catch(() => [] as string[]);
  await useChat.getState().saveProvider({ ...draft, model: models[0] ?? DEFAULT_MODEL }, null);
}

export function ChatGptSignIn({ providers }: { providers: ChatProvider[] | null }) {
  const desktop = canSignInWithChatGpt();
  const [account, setAccount] = useState<ChatGptAccount | null>(null);
  const [phase, setPhase] = useState<Phase>({ is: "idle" });
  const [busy, setBusy] = useState(false);
  const { toast } = useWorkspace.getState();

  const load = () => chatgptAccount().then(setAccount, () => {});
  useEffect(() => {
    if (!desktop) return;
    void load();
    return onChatGptSignIn((end) => {
      const problem = chatgptProblem(end);
      setPhase(problem ? { is: "problem", text: problem, retry: end.state !== "denied" } : { is: "idle" });
      void load();
      if (end.state !== "signed") return;
      toast(`Signed in with ChatGPT${end.email ? ` as ${end.email}` : ""}. You're using your ChatGPT plan; manage usage in ChatGPT → Settings → Usage.`);
      void addProvider().catch((err) => toast(message(err)));
    });
    // Once, on showing.
  }, []);

  if (!desktop) {
    return (
      <Row id="ai.chatgpt">
        <div className="flex items-center gap-2">
          <span className="text-12 text-muted">Needs the desktop app</span>
          <Button disabled>Continue with ChatGPT</Button>
        </div>
      </Row>
    );
  }

  const start = async (fixedPort = false) => {
    setBusy(true);
    try {
      setPhase({ is: "waiting", url: (await chatgptSignInStart(fixedPort)).url });
    } catch (err) {
      setPhase({ is: "problem", text: message(err), retry: false });
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    setPhase({ is: "idle" });
    void chatgptSignInCancel();
  };
  const signOut = async () => {
    setBusy(true);
    try {
      const { revoked } = await chatgptSignOut();
      toast(revoked ? "Signed out of ChatGPT" : "Signed out of ChatGPT here. To take KastenFlow's access back, remove it in ChatGPT → Settings.");
    } catch (err) {
      toast(message(err));
    } finally {
      setBusy(false);
      void load();
    }
  };
  const add = () => {
    setBusy(true);
    addProvider()
      .catch((err) => toast(message(err)))
      .finally(() => setBusy(false));
  };

  if (phase.is === "waiting") {
    return (
      <Row id="ai.chatgpt" label="Waiting for ChatGPT" help="Finish signing in in the browser window that opened. Nothing is sent from here until you do." detail={<span role="status">Finish signing in in your browser.</span>}>
        <div className="flex gap-2">
          <Button icon="external" onClick={() => void openUrl(phase.url)}>
            Open the page again
          </Button>
          <button type="button" className={BUTTON} onClick={cancel}>
            Cancel
          </button>
        </div>
      </Row>
    );
  }
  if (phase.is === "problem") {
    return (
      <Row id="ai.chatgpt" label="Signing in with ChatGPT did not finish" detail={<span role="alert" className="text-danger">{phase.text}</span>}>
        <div className="flex gap-2">
          {phase.retry && (
            <button type="button" className={BUTTON} disabled={busy} title="For when the browser said the address was not accepted" onClick={() => void start(true)}>
              Try a fixed port
            </button>
          )}
          <button type="button" className={PRIMARY} disabled={busy} onClick={() => void start()}>
            Try again
          </button>
        </div>
      </Row>
    );
  }
  if (!account) return null;
  if (!account.signedIn) {
    return (
      <Row id="ai.chatgpt">
        <Button tone="primary" icon="user" disabled={busy} onClick={() => void start()}>
          Continue with ChatGPT
        </Button>
      </Row>
    );
  }
  const who = `Signed in as ${account.email ?? "your ChatGPT account"}`;
  return (
    <>
      <Row
        id="ai.chatgpt"
        label="ChatGPT plan"
        help="Usage counts against your ChatGPT plan; the limit is in ChatGPT → Settings → Usage."
        detail={
          <>
            {who}
            {!account.remembered && <span className="block text-warning">This computer's keychain would not keep the sign-in, so it lasts until KastenFlow quits.</span>}
          </>
        }
      >
        <div className="flex gap-2">
          <Button icon="external" onClick={() => void openUrl(CHATGPT_USAGE_URL)}>
            Manage usage
          </Button>
          <button type="button" className={BUTTON} disabled={busy} onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </Row>
      {providers && !providers.some((p) => p.kind === "chatgpt") && (
        <Row label="Use ChatGPT in this vault" help="This vault's settings have no ChatGPT provider yet, so chats and AI writing cannot pick it.">
          <button type="button" className={BUTTON} disabled={busy} onClick={add}>
            Add ChatGPT
          </button>
        </Row>
      )}
    </>
  );
}

/** Changing a ChatGPT provider: only its model, from the account's own list. */
export function ChatGptModelForm({ provider, onDone }: { provider: ChatProvider; onDone(): void }) {
  const [model, setModel] = useState(provider.model);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft = () => ({ name: provider.name, kind: "chatgpt" as const, baseUrl: "", model: model.trim() });
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await useChat.getState().saveProvider(draft(), null);
      onDone();
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };
  return (
    <form
      aria-label={`Change ${provider.name}`}
      className="flex flex-col gap-3 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      onKeyDown={(event) => event.key === "Escape" && onDone()}
    >
      <ModelField
        value={model}
        onChange={setModel}
        placeholder="The model's ID, from your ChatGPT plan's list"
        autoFocus
        source="chatgpt"
        ready
        list={() => useChat.getState().ensure().listProviderModels(draft(), null)}
      />
      {error && (
        <p role="alert" className="text-13 text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className={BUTTON} onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className={PRIMARY} disabled={busy || !model.trim()}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
