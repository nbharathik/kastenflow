import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemoryVault } from "../workspace/preview/memory-vault";
import { usePrefs } from "../workspace/prefs";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout } from "../workspace/tabs";
import { GraphView } from "./GraphView";
import { LocalGraph } from "./LocalGraph";

const SEED = {
  "library/alpha.md": "---\ntitle: Alpha\ntags: [paper]\n---\nSee [[Beta]] and [[Not made yet]].\n",
  "library/beta.md": "---\ntitle: Beta\n---\nBack to [[Alpha]].\n",
  "library/lonely.md": "---\ntitle: Lonely\n---\nNothing links here.\n",
  "projects/trip/_project.md": "---\ntitle: Trip\ntype: project\n---\nA trip.\n",
  "projects/trip/pages/plan.md": "---\ntitle: Plan\n---\nSee [[Alpha]].\n",
  "projects/trip/boards/map.canvas": JSON.stringify({ nodes: [{ id: "n1", type: "file", file: "projects/trip/pages/plan.md", x: 0, y: 0, width: 300, height: 100 }], edges: [] }),
};

let vault: MemoryVault;
const state = () => useWorkspace.getState();
const status = () => screen.getByText(/things? ·/).textContent ?? "";
/** Waits for the graph to arrive: the count starts at none. */
const loaded = () => waitFor(() => expect(status()).toMatch(/^[1-9]\d* things?/));

beforeEach(async () => {
  localStorage.clear();
  usePrefs.setState({ pageLinksOpen: "here", rightReplaces: true });
  vault = new MemoryVault(SEED);
  useWorkspace.setState({ ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  await state().connect({ client: vault });
});
afterEach(cleanup);

describe("the Graph view", () => {
  it("draws every note, whiteboard and the pages links name that do not exist, with the counts", async () => {
    render(<GraphView />);
    await loaded();
    // Alpha, Beta, Lonely, Trip, Plan, the board, and one ghost.
    expect(status()).toMatch(/^6 things · 5 links · 1 missing/);
    expect(screen.getByRole("application", { name: /Graph of your pages/ })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Kinds" }).textContent).toContain("Missing pages");
  });

  it("finds a node by its title and brings it forward with a card to open it", async () => {
    render(<GraphView />);
    await loaded();
    const box = screen.getByRole("combobox", { name: "Find a node in the graph" });
    fireEvent.change(box, { target: { value: "bet" } });
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["BetaPages"]);
    fireEvent.keyDown(box, { key: "Enter" });
    const card = await screen.findByRole("complementary", { name: "Selected node" });
    expect(card.textContent).toContain("Beta");
    // Alpha links it and it links Alpha: one neighbour, not two.
    expect(card.textContent).toContain("1 link");
    // Opens to the right when Settings leave links in the same tab.
    fireEvent.click(within(card).getByRole("button", { name: "Open" }));
    await waitFor(() => expect(state().place.path).toBe("library/beta.md"));
    expect(state().layout.panes).toHaveLength(2);
    fireEvent.click(within(card).getByRole("button", { name: "Clear the selection" }));
    expect(screen.queryByRole("complementary", { name: "Selected node" })).toBeNull();
  });

  it("makes the page a missing link names, in the project of the pages that link it, and opens it", async () => {
    render(<GraphView />);
    await waitFor(() => expect(status()).toContain("missing"));
    const box = screen.getByRole("combobox", { name: "Find a node in the graph" });
    fireEvent.change(box, { target: { value: "not made" } });
    fireEvent.keyDown(box, { key: "Enter" });
    const card = await screen.findByRole("complementary", { name: "Selected node" });
    fireEvent.click(within(card).getByRole("button", { name: "Make the page" }));
    await waitFor(() => expect(state().notes.some((n) => n.title === "Not made yet")).toBe(true));
    const made = state().notes.find((n) => n.title === "Not made yet")!;
    expect(made.kind).toBe("page");
    expect(state().place.path).toBe(made.path);
    // The gap is filled: the graph has no ghost left.
    await waitFor(() => expect(screen.queryByText(/missing/)).toBeNull(), { timeout: 4000 });
  });

  it("hides pages with no links, missing pages and kinds from the filters, which are kept", async () => {
    render(<GraphView />);
    await waitFor(() => expect(status()).toContain("6 things"));
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Pages with no links" }));
    // Lonely and the project's page have no links.
    await waitFor(() => expect(status()).toMatch(/^4 things/));
    fireEvent.click(screen.getByRole("checkbox", { name: /Missing pages/ }));
    await waitFor(() => expect(status()).not.toContain("missing"));
    fireEvent.click(screen.getByRole("checkbox", { name: /Whiteboards/ }));
    await waitFor(() => expect(status()).toMatch(/^3 things/));
    expect(JSON.parse(localStorage.getItem("kasten.graph")!).filters).toMatchObject({ orphans: false, ghosts: false, hiddenKinds: ["board"] });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(status()).toMatch(/^6 things/));
  });

  it("shows only the pages tagged with a chosen tag", async () => {
    render(<GraphView />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(screen.getByRole("button", { name: /^Add a tag/ }));
    fireEvent.click(await screen.findByRole("option", { name: /#paper/ }));
    await waitFor(() => expect(status()).toMatch(/^1 thing/));
  });

  it("shows a project's own things with its neighbours, and the pages around one page", async () => {
    render(<GraphView />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "A project" }));
    expect(await screen.findByText("Choose a project to see its graph.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Project:/ }));
    fireEvent.click(await screen.findByRole("option", { name: "Trip" }));
    // Trip's project page, its page and board, and Alpha, which Plan links.
    await waitFor(() => expect(status()).toMatch(/^4 things/));
    fireEvent.click(screen.getByRole("button", { name: "Around a page" }));
    expect(screen.getByRole("group", { name: "Links away" })).toBeTruthy();
  });

  it("opens around the page it is asked about, with how far in the choice kept", async () => {
    render(<GraphView path="library/alpha.md" />);
    // One link from Alpha: Alpha, Beta and Plan, and the page Alpha names that is not made.
    await waitFor(() => expect(status()).toMatch(/^3 things · 4 links · 1 missing/));
    fireEvent.click(screen.getByRole("button", { name: "3 links" }));
    expect(JSON.parse(localStorage.getItem("kasten.graph")!).depth).toBe(3);
  });

  it("opens on a project's own graph from its page, and keeps its look without scope controls when fixed", async () => {
    render(<GraphView scope={{ kind: "project", path: "trip" }} embedded />);
    await loaded();
    expect(screen.queryByRole("button", { name: "Whole vault" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Full screen" })).toBeNull();
  });

  it("turns the colours to projects and back", async () => {
    render(<GraphView />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    expect(screen.getByRole("list", { name: "Projects" }).textContent).toContain("Trip");
    fireEvent.click(screen.getByRole("button", { name: "Kind" }));
    expect(screen.getByRole("list", { name: "Kinds" })).toBeTruthy();
  });
});

describe("the page's own graph", () => {
  const note = { path: "library/alpha.md", title: "Alpha" };

  it("counts the pages one link away and opens the whole graph beside the page", async () => {
    render(<LocalGraph note={note} />);
    const region = await screen.findByRole("region", { name: "Local graph" });
    await waitFor(() => expect(region.querySelector(".kasten-panel-count")?.textContent).toBe("3"));
    expect(within(region).getByRole("application", { name: /Graph of the pages linked with Alpha/ })).toBeTruthy();
    fireEvent.click(within(region).getByRole("button", { name: "Open graph" }));
    expect(state().place).toEqual({ view: "graph", path: "library/alpha.md" });
  });

  it("says when nothing links to or from the page", async () => {
    render(<LocalGraph note={{ path: "library/lonely.md", title: "Lonely" }} />);
    expect(await screen.findByText("Nothing links to or from this page yet.")).toBeTruthy();
  });
});
