import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NoteMeta, TagSchema } from "../../../lib/vault/types";
import { useWorkspace } from "../../workspace/store";
import { GalleryView } from "./GalleryView";
import { ListView } from "./ListView";
import type { ViewProps } from "./types";

function note(id: string, title: string, props: Record<string, unknown> = {}): NoteMeta {
  return {
    path: `library/${id}.md`,
    id,
    title,
    kind: "page",
    icon: null,
    cover: null,
    parent: null,
    project: null,
    tags: ["task"],
    modified: 0,
    created: null,
    updated: null,
    excerpt: "",
    words: 0,
    props,
    locked: false,
  };
}

const schema: TagSchema = {
  name: "task",
  color: null,
  path: "tags/task.yaml",
  views: [],
  properties: [
    { key: "blocks", type: "relation", options: [] },
    { key: "status", type: "select", options: ["Todo"] },
  ],
};

const target = note("t1", "Write intro");
const other = note("t2", "Book flights");
const row = note("r", "Plan trip", { blocks: ["t1", "t2", "gone"], status: "Todo" });

function props(notes: NoteMeta[]): ViewProps {
  return { tag: "task", schema, view: { name: "All", type: "list" } as ViewProps["view"], notes, onChange: () => {} };
}

beforeEach(() => {
  useWorkspace.setState({ notes: [target, other, row] });
});
afterEach(cleanup);

describe("relation values in list and gallery views", () => {
  it("shows the titles of the related pages in a list, and the id of one that is missing", () => {
    render(<ListView {...props([row])} />);
    expect(screen.getByText("Write intro, Book flights, gone")).toBeTruthy();
    expect(screen.queryByText(/t1/)).toBeNull();
  });

  it("shows them in a gallery too", () => {
    render(<GalleryView {...props([row])} />);
    expect(screen.getByText("Write intro, Book flights, gone")).toBeTruthy();
  });

  it("leaves other values as they were", () => {
    render(<ListView {...props([row])} />);
    expect(screen.getByText("Todo")).toBeTruthy();
  });
});
