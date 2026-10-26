// Choosing a repository that exists: look at it first, then use it, hold it
// back (public) or refuse it (it holds something else).

import type { RepoRow } from "../../../lib/vault/backup-types";
import { call, sentence } from "./api";
import { linkBackup } from "./job";
import { useBackupWizard } from "./state";

/** A repository known only by its `owner/name`. */
export const rowFor = (fullName: string): RepoRow => ({
  name: fullName.split("/").pop() ?? fullName,
  fullName,
  cloneUrl: `https://github.com/${fullName}.git`,
  htmlUrl: `https://github.com/${fullName}`,
  updatedAt: null,
  visibility: "private",
  isBackup: false,
});

/** Looks at `repo`, then uses it. Answers a sentence when it cannot go on here;
 * a public or unrelated repository goes to the store as a choice to make. */
export async function chooseRepo(repo: RepoRow): Promise<string | null> {
  const { patch } = useBackupWizard.getState();
  try {
    const found = await call("github_repo_check", { repo: repo.fullName });
    if (!found.exists) return "GitHub shows no repository by that name to this sign-in.";
    const seen = { ...repo, visibility: found.visibility };
    if (found.visibility === "public") {
      patch({ verdict: { kind: "public", repo: seen, protection: found.protection } });
    } else if (found.content === "unrelated") {
      patch({ verdict: { kind: "refused", repo: seen, choices: ["pickAnother", "createNew", "restoreIntoNewFolder"] } });
    } else {
      void linkBackup(seen, found.protection);
    }
    return null;
  } catch (err) {
    return sentence(err);
  }
}
