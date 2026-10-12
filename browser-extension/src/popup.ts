// The toolbar button's popup. Not paired: it asks for the pairing code Kasten's
// Settings shows. Paired: it offers to send the page, the selection or the link
// (`popup-capture.ts`). Written against `PopupEnv` so a stand-in browser runs it.

import { LAST_RESULT } from "./background.js";
import { Kasten } from "./client.js";
import { fill, h } from "./dom.js";
import { DEFAULT_PORT } from "./model.js";
import { captureView } from "./popup-capture.js";
import { noticeLine, words, type Notice, type PopupEnv } from "./popup-env.js";
import { loadSettings, savePairing, savePort, validPort } from "./settings.js";

export type { PopupEnv } from "./popup-env.js";

/** Shows what the popup should: the pairing form, or the capture form. `notice` is said above it. */
export async function show(env: PopupEnv, root: HTMLElement, notice: Notice | null = null): Promise<void> {
  const settings = await loadSettings(env.storage);
  const kept = await env.storage.get([LAST_RESULT]).catch(() => ({}) as Record<string, unknown>);
  const left = kept[LAST_RESULT] as { ok?: boolean; text?: string } | undefined;
  if (left) await env.storage.remove([LAST_RESULT]).catch(() => {});
  // How the last right-click send went is told once, here.
  const said = notice ?? (left?.text ? { text: left.text, bad: left.ok !== true } : null);
  if (!settings.token) return pairingView(env, root, settings.port, said);
  return captureView(env, root, settings, said, (next) => show(env, root, next));
}

/** Starts the popup in `root`. */
export async function startPopup(env: PopupEnv, root: HTMLElement): Promise<void> {
  env.clearBadge();
  await show(env, root);
}

function pairingView(env: PopupEnv, root: HTMLElement, port: number, notice: Notice | null): void {
  const code = h("input", { id: "code", name: "code", autocomplete: "off", spellcheck: "false", maxlength: 12, inputmode: "text", required: true });
  const portField = h("input", { id: "port", name: "port", inputmode: "numeric", value: String(port) });
  const result = h("p", { class: "notice is-bad", role: "alert", hidden: true });
  const go = h("button", { type: "submit", class: "primary" }, "Pair");
  const pair = async () => {
    result.hidden = true;
    const chosen = Number(portField.value);
    if (!validPort(chosen)) {
      result.textContent = "A port is a number from 1024 to 65535.";
      result.hidden = false;
      return;
    }
    go.disabled = true;
    try {
      await savePort(env.storage, chosen);
      const paired = await new Kasten(chosen, null, env.send).pair(code.value, env.browser);
      await savePairing(env.storage, paired.token, paired.vault);
      await show(env, root, { text: `Paired with ${paired.vault || "KastenFlow"}.`, bad: false });
    } catch (error) {
      result.textContent = words(error);
      result.hidden = false;
      go.disabled = false;
    }
  };
  const form = h(
    "form",
    {
      onsubmit: (event) => {
        event.preventDefault();
        void pair();
      },
    },
    h("label", { for: "code" }, "Pairing code"),
    code,
    go,
    result,
    h("details", {}, h("summary", {}, "Advanced"), h("label", { for: "port" }, "Port KastenFlow listens on"), portField, h("p", { class: "hint" }, `KastenFlow's own default is ${DEFAULT_PORT}.`)),
  );
  fill(
    root,
    h("h1", {}, "Send to KastenFlow"),
    noticeLine(notice),
    h("p", {}, "This browser is not paired with KastenFlow yet."),
    h("ol", { class: "steps" }, h("li", {}, "In KastenFlow, open Settings → Browser extension and turn the extension on."), h("li", {}, "Press Pair. A code appears for two minutes."), h("li", {}, "Type it here.")),
    form,
  );
  code.focus();
}
