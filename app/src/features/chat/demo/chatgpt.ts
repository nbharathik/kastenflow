// Sign in with ChatGPT in the demo: the button works and the sign-in ends a
// moment later, as if the person had approved it in their browser. Only the
// desktop app's four commands are answered; the Settings row is the real one.

import type { DemoClock } from "../../../demo/clock";
import type { Handler } from "../../../demo/ipc";
import type { ChatGptAccount, ChatGptSignInEnd } from "../chatgpt";

export const DEMO_EMAIL = "maya@example.com";
/** How long the pretend approval takes: the row shows "waiting" for a blink. */
export const CHATGPT_SIGN_IN_MS = 150;

export class ChatGptDemo {
  signedIn = false;
  private stop: (() => void) | null = null;

  constructor(
    private readonly clock: DemoClock,
    private readonly emit: (event: string, payload: unknown) => void,
  ) {}

  reset(): void {
    this.stop?.();
    this.stop = null;
    this.signedIn = false;
  }

  account(): ChatGptAccount {
    return { signedIn: this.signedIn, email: this.signedIn ? DEMO_EMAIL : null, remembered: true, reauth: false };
  }

  start(): { url: string } {
    this.stop?.();
    this.stop = this.clock.after(CHATGPT_SIGN_IN_MS, () => {
      this.stop = null;
      this.signedIn = true;
      this.emit("kasten://chatgpt-sign-in", { state: "signed", email: DEMO_EMAIL, remembered: true } satisfies ChatGptSignInEnd);
    });
    return { url: "https://chatgpt.com/auth/kastenflow-demo" };
  }

  cancel(): void {
    this.stop?.();
    this.stop = null;
  }
}

export function chatgptCommands(demo: ChatGptDemo): Record<string, Handler> {
  return {
    chatgpt_account: () => demo.account(),
    chatgpt_sign_in_start: () => demo.start(),
    chatgpt_sign_in_cancel: () => demo.cancel(),
    chatgpt_sign_out: () => {
      demo.reset();
      return { revoked: true };
    },
  };
}
