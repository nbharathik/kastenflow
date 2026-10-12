// "Sign in with GitHub": the code to type at GitHub's own page, shown until
// GitHub says it was typed, refused or ran out. Kasten never sees the
// person's password; GitHub hands it a token for this computer.

import { openUrl } from "../../lib/api";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Modal";
import type { SignInCode } from "./api";

export function SignInDialog({ code, onCancel }: { code: SignInCode; onCancel: () => void }) {
  const go = () => {
    void navigator.clipboard?.writeText(code.userCode).catch(() => {});
    void openUrl(code.verificationUri);
  };
  return (
    <Modal label="Sign in with GitHub" onClose={onCancel} className="ui-dialog">
      <h2 className="ui-dialog-title">Sign in with GitHub</h2>
      <div className="ui-dialog-body">
        <p>Type this code on GitHub's page to let KastenFlow back up this vault to a private repository in your account.</p>
        <output aria-label="Sign-in code" className="kasten-sign-in-code">
          {code.userCode}
        </output>
        <p role="status">Waiting for you to finish on GitHub…</p>
      </div>
      <footer className="ui-dialog-foot">
        <Button onClick={onCancel}>Cancel</Button>
        <Button tone="primary" onClick={go}>
          Copy code and open GitHub
        </Button>
      </footer>
    </Modal>
  );
}
