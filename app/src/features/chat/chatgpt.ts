// Sign in with ChatGPT, through the desktop app's commands
// (app/src-tauri/src/chat/chatgpt): the person's ChatGPT plan pays for chats
// and AI writing, with no API key. The browser preview has none of this.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { inTauri } from "../../lib/api";

/** Whether Kasten is signed in with ChatGPT on this computer. */
export interface ChatGptAccount {
  signedIn: boolean;
  email: string | null;
  /** False when the system keychain would not keep the sign-in, so it lasts
   * until Kasten quits. */
  remembered: boolean;
}

export interface ChatGptSignInStart {
  /** The sign-in page, for when the browser did not come forward. */
  url: string;
}

/** How a sign-in ended (the `kasten://chatgpt-sign-in` event). */
export type ChatGptSignInEnd =
  | { state: "signed"; email: string | null; remembered: boolean }
  | { state: "expired" }
  | { state: "denied" }
  | { state: "failed"; message: string };

/** The provider name Settings gives the ChatGPT plan, the kind the backend calls it. */
export const CHATGPT_NAME = "ChatGPT";

/** Where ChatGPT shows and sets how much of the plan apps may use. */
export const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

/** Whether this window can sign in: the desktop app. */
export const canSignInWithChatGpt = () => inTauri();

export const chatgptAccount = () => invoke<ChatGptAccount>("chatgpt_account");
/** Opens ChatGPT's sign-in page in the system browser. `fixedPort` listens on
 * the one port OpenAI's examples use, for when a random one was not accepted. */
export const chatgptSignInStart = (fixedPort = false) => invoke<ChatGptSignInStart>("chatgpt_sign_in_start", { fixedPort });
export const chatgptSignInCancel = () => invoke<void>("chatgpt_sign_in_cancel");
/** Signs out here; `revoked` says whether OpenAI ended the sign-in too. */
export const chatgptSignOut = () => invoke<{ revoked: boolean }>("chatgpt_sign_out");

/** Calls `then` once a sign-in ends; returns how to stop listening. */
export function onChatGptSignIn(then: (end: ChatGptSignInEnd) => void): () => void {
  const stop = listen<ChatGptSignInEnd>("kasten://chatgpt-sign-in", (e) => then(e.payload));
  return () => void stop.then((fn) => fn(), () => {});
}

/** What an ended sign-in says, when it did not sign in. */
export function chatgptProblem(end: ChatGptSignInEnd): string | null {
  switch (end.state) {
    case "signed":
      return null;
    case "expired":
      return "Nobody finished signing in with ChatGPT in time. Try again";
    case "denied":
      return "Signing in with ChatGPT was cancelled";
    case "failed":
      return end.message;
  }
}
