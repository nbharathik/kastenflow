// What the hub says when there is nothing to list: one sentence and one way on.

import { Button } from "../../../ui/Button";
import { Icon } from "../../../ui/Icon";

export type EmptyKind = "none" | "archived" | "matches" | "error";

interface Props {
  kind: EmptyKind;
  /** Why the projects could not be read, for `error`. */
  error?: string | null;
  onNew(): void;
  onClear(): void;
  onRetry(): void;
}

export function HubEmpty({ kind, error, onNew, onClear, onRetry }: Props) {
  if (kind === "none") {
    return (
      <div className="kasten-hub-empty" role="status">
        <span className="kasten-hub-empty-mark" aria-hidden="true">
          <Icon name="project" className="size-7" />
        </span>
        <h2>No projects yet</h2>
        <p>A project keeps the pages, whiteboards and decks of one piece of work together, with a status you can see at a glance.</p>
        <Button tone="primary" icon="plus" onClick={onNew}>
          Create your first project
        </Button>
      </div>
    );
  }
  if (kind === "error") {
    return (
      <div className="kasten-hub-empty" role="alert">
        <h2>The projects could not be read</h2>
        <p>{error}</p>
        <Button onClick={onRetry}>Try again</Button>
      </div>
    );
  }
  return (
    <div className="kasten-hub-empty is-small" role="status">
      <p>{kind === "archived" ? "No project is archived." : "No project matches."}</p>
      <Button onClick={onClear}>{kind === "archived" ? "Show the projects" : "Clear filters"}</Button>
    </div>
  );
}
