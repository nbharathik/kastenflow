import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ChangedFile, CommitInfo, VaultClient } from "../../lib/vault/types";
import { useWorkspace } from "../workspace/store";
import { CommitRow } from "./CommitRow";

afterEach(cleanup);

/** A diagram file with these shapes: [id, label]. */
const diagram = (shapes: [string, string][]): string =>
  `<mxfile><diagram name="Page-1" id="p"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${shapes
    .map(([id, label]) => `<mxCell id="${id}" value="${label}" style="rounded=1" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>`)
    .join("")}</root></mxGraphModel></diagram></mxfile>`;

const commit = (summary: string): CommitInfo => ({ id: "c1", summary, message: "", author: "Bharathi", time: Date.now(), agent: false, session: null, op: null, approvedBy: null, undoes: null, merge: false });

function open(summary: string, files: ChangedFile[]) {
  const client = { kind: "preview", commitChanges: async () => files } as unknown as VaultClient;
  useWorkspace.setState({ client, notes: [] });
  render(
    <ul>
      <CommitRow commit={commit(summary)} undone={false} />
    </ul>,
  );
  fireEvent.click(screen.getByRole("button", { expanded: false }));
}

beforeEach(() => {
  useWorkspace.setState({ client: null, notes: [] });
});

describe("a diagram in a commit", () => {
  it("says what changed to what, in words, in place of lines of XML", async () => {
    open("diagram: edit Login flow", [
      { path: "library/Login-flow.drawio", before: diagram([["a", "Login"], ["b", "Token"]]), after: diagram([["a", "Login"], ["b", "Token"], ["c", "Cache"]]) },
      { path: "library/Login-flow.drawio.svg", before: "<svg>old</svg>", after: "<svg>new</svg>" },
    ]);
    const words = await screen.findByRole("list", { name: "What changed in the diagram" });
    expect(within(words).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Shapes: 2 → 3.", "Added “Cache”."]);
    expect(screen.queryByText(/mxCell/)).toBeNull();
    // The picture beside it is told in a line, as following the diagram.
    expect(screen.getByText("The picture was drawn again to match.")).toBeTruthy();
    // The row itself says it in words too.
    expect(screen.getByText("Login flow").parentElement!.textContent).toContain("Changed a diagram");
  });

  it("keeps the file's text behind a button, for anyone who wants it", async () => {
    open("diagram: edit Login flow", [{ path: "library/Login-flow.drawio", before: diagram([["a", "Login"]]), after: diagram([["a", "Sign in"]]) }]);
    await screen.findByRole("list", { name: "What changed in the diagram" });
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show the file's text" }));
    expect(screen.getByRole("table", { name: "Changes to library/Login-flow.drawio" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide the file's text" })).toBeTruthy();
  });

  it("says a new diagram and a removed one", async () => {
    open("diagram: create Login flow", [{ path: "library/Login-flow.drawio", before: null, after: diagram([["a", "Login"]]) }]);
    expect(await screen.findByText("A new diagram with 1 shape and 0 connectors.")).toBeTruthy();
    cleanup();
    open("diagram: trash Login flow", [{ path: "library/Login-flow.drawio", before: diagram([["a", "Login"]]), after: null }]);
    expect(await screen.findByText(/The diagram was removed/)).toBeTruthy();
  });

  it("says that a picture drawn again changed the picture and not the diagram", async () => {
    open("diagram: preview Login flow", [{ path: "library/Login-flow.drawio.svg", before: "<svg>old</svg>", after: "<svg>new</svg>" }]);
    expect(await screen.findByText("The picture of the diagram was drawn again. The diagram itself is as it was.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says when the diagram's shapes cannot be read, and still offers its text", async () => {
    open("diagram: edit Login flow", [{ path: "library/Login-flow.drawio", before: '<mxfile><diagram id="p">7VhZ</diagram></mxfile>', after: '<mxfile><diagram id="p">7VhZab</diagram></mxfile>' }]);
    expect(await screen.findByText("The diagram's shapes could not be read to say what changed.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show the file's text" })).toBeTruthy();
  });
});
