// "Use an existing private repo": the account's private repositories, the ones
// KastenFlow made first, searchable and paged. Choosing one looks at it
// before anything is written (choose.ts).

import { useEffect, useRef, useState } from "react";

import { relativeTime } from "../../../lib/dates";
import { Button } from "../../../ui/Button";
import type { RepoRow } from "../../../lib/vault/backup-types";
import { call, sentence } from "./api";

const SEARCH_AFTER_MS = 300;

type Load = { state: "loading" } | { state: "ready"; repos: RepoRow[]; hasMore: boolean; page: number } | { state: "failed"; message: string };

export function ExistingRepo({ onChoose, onCreateNew, busy }: { onChoose: (repo: RepoRow) => void; onCreateNew: () => void; busy: boolean }) {
  const [query, setQuery] = useState("");
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [more, setMore] = useState(false);
  const asked = useRef(0);

  const fetchPage = (text: string, page: number) => {
    const turn = ++asked.current;
    return call("github_repos", { query: text, page }).then(
      (found) => (turn === asked.current ? found : null),
      (err) => {
        if (turn === asked.current) setLoad({ state: "failed", message: sentence(err) });
        return null;
      },
    );
  };

  useEffect(() => {
    setLoad({ state: "loading" });
    const timer = setTimeout(() => {
      void fetchPage(query.trim(), 1).then((found) => found && setLoad({ state: "ready", repos: found.repos, hasMore: found.hasMore, page: 1 }));
    }, query ? SEARCH_AFTER_MS : 0);
    return () => clearTimeout(timer);
  }, [query]);

  const showMore = async () => {
    if (load.state !== "ready") return;
    setMore(true);
    const found = await fetchPage(query.trim(), load.page + 1);
    setMore(false);
    if (found) setLoad({ state: "ready", repos: [...load.repos, ...found.repos], hasMore: found.hasMore, page: load.page + 1 });
  };

  return (
    <div className="kasten-wiz-stack">
      <label className="kasten-wiz-label">
        Search your private repositories
        <input className="ui-field" type="search" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} autoComplete="off" />
      </label>
      {load.state === "loading" && (
        <p role="status" className="kasten-wiz-note">
          Looking at your repositories…
        </p>
      )}
      {load.state === "failed" && (
        <p role="alert" className="kasten-wiz-problem">
          {load.message}
        </p>
      )}
      {load.state === "ready" && load.repos.length === 0 && (
        <div className="kasten-wiz-stack">
          <p className="kasten-wiz-note">{query.trim() ? "No private repository matches that." : "You have no private repositories yet."}</p>
          <div className="kasten-wiz-row">
            <Button onClick={onCreateNew}>Create a new one</Button>
          </div>
        </div>
      )}
      {load.state === "ready" && load.repos.length > 0 && (
        <ul className="kasten-wiz-list" aria-label="Private repositories">
          {load.repos.map((repo) => (
            <li key={repo.fullName}>
              <button type="button" className="kasten-wiz-repo" disabled={busy} onClick={() => onChoose(repo)}>
                <span className="kasten-wiz-repo-name">{repo.fullName}</span>
                {repo.isBackup && <span className="kasten-wiz-badge">KastenFlow backup</span>}
                {repo.updatedAt && <span className="kasten-wiz-repo-when">{relativeTime(Date.parse(repo.updatedAt))}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {load.state === "ready" && load.hasMore && (
        <div className="kasten-wiz-row">
          <Button disabled={more} onClick={() => void showMore()}>
            {more ? "Loading…" : "Show more"}
          </Button>
        </div>
      )}
    </div>
  );
}
