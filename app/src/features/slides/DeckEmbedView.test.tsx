// A deck inside a page: the current slide, arrows and a count, Present and
// Open. The slide engine's drawing is stood in for; what is checked is which
// slide is shown and what the buttons do.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VaultClient } from "../../lib/vault/types";
import { useWorkspace } from "../workspace/store";
import { DeckEmbedView } from "./DeckEmbedView";
import { presentFrom } from "./embed-present";
import { useDecks } from "./store";

const present = vi.hoisted(() => ({ openPresentation: vi.fn(), willPresent: vi.fn(), fillScreen: vi.fn() as unknown }));

vi.mock("@kasten-slides/react", () => ({
  SlideView: ({ slide, number, count }: { slide: { id: string }; number: number; count: number }) => (
    <div data-testid="slide">
      {slide.id} {number}/{count}
    </div>
  ),
  openPresentation: present.openPresentation,
}));
vi.mock("./kasten-host", () => ({
  kastenHost: () => ({ imageUrl: (path: string) => `asset://${path}`, willPresent: present.willPresent, fillScreen: present.fillScreen }),
}));

const text = (slides: number) => JSON.stringify({ size: { w: 1280, h: 720 }, slides: Array.from({ length: slides }, (_, i) => ({ id: `s${i + 1}` })) });

function vault(slides: number) {
  const deck = vi.fn(async (path: string) => ({ path, text: text(slides), hash: "h", modified: 1 }));
  return { client: { deck } as unknown as VaultClient, deck };
}

const info = (slides: number, modified: number) => ({ path: "talks/pitch.deck", title: "Pitch", project: null, slides, modified, size: 1, problem: null });
const shown = () => screen.getByTestId("slide").textContent;
const button = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => {
  // The slide is scaled to the width of its box.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 640 });
  useDecks.setState({ list: [] });
});

afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  vi.clearAllMocks();
});

describe("a deck in a page", () => {
  it("shows the first slide and looks through the deck with the arrows and the keys", async () => {
    const { client, deck } = vault(3);
    useWorkspace.setState({ client });
    render(<DeckEmbedView path="talks/pitch.deck" />);
    await screen.findByTestId("slide");
    expect(shown()).toBe("s1 1/3");
    expect(deck).toHaveBeenCalledWith("talks/pitch.deck");
    expect(screen.getByText("1 / 3")).toBeTruthy();
    expect(button("Previous slide").disabled).toBe(true);
    fireEvent.click(button("Next slide"));
    expect(shown()).toBe("s2 2/3");
    const view = screen.getByTestId("slide").closest(".kasten-deck-view")!;
    fireEvent.keyDown(view, { key: "ArrowRight" });
    expect(screen.getByText("3 / 3")).toBeTruthy();
    expect(button("Next slide").disabled).toBe(true);
    fireEvent.keyDown(view, { key: "ArrowLeft" });
    expect(shown()).toBe("s2 2/3");
  });

  it("reads the deck again when its file changes, and keeps within the slides that are left", async () => {
    const { client, deck } = vault(3);
    useWorkspace.setState({ client });
    useDecks.setState({ list: [info(3, 1)] });
    render(<DeckEmbedView path="talks/pitch.deck" />);
    await screen.findByTestId("slide");
    fireEvent.click(button("Next slide"));
    fireEvent.click(button("Next slide"));
    expect(shown()).toBe("s3 3/3");
    deck.mockImplementation(async (path: string) => ({ path, text: text(2), hash: "h2", modified: 2 }));
    act(() => useDecks.setState({ list: [info(2, 2)] }));
    await waitFor(() => expect(screen.getByText("2 / 2")).toBeTruthy());
    expect(deck).toHaveBeenCalledTimes(2);
  });

  it("opens the deck, and presents it from the slide on show", async () => {
    const { client } = vault(3);
    const openPath = vi.fn();
    useWorkspace.setState({ client, openPath });
    render(<DeckEmbedView path="talks/pitch.deck" />);
    await screen.findByTestId("slide");
    fireEvent.click(button("Next slide"));
    fireEvent.click(button(/Open/));
    expect(openPath).toHaveBeenCalledWith("talks/pitch.deck");
    fireEvent.click(button(/Present/));
    await waitFor(() => expect(present.openPresentation).toHaveBeenCalledTimes(1));
    expect(present.openPresentation).toHaveBeenCalledWith(expect.objectContaining({ start: 1, deck: expect.objectContaining({ slides: expect.any(Array) }) }));
  });

  it("says when the deck is empty or cannot be read", async () => {
    const { client, deck } = vault(0);
    useWorkspace.setState({ client });
    const { unmount } = render(<DeckEmbedView path="talks/empty.deck" />);
    expect(await screen.findByText("An empty deck.")).toBeTruthy();
    unmount();
    deck.mockRejectedValue(new Error("Gone"));
    render(<DeckEmbedView path="talks/gone.deck" />);
    expect(await screen.findByText("Gone")).toBeTruthy();
  });
});

describe("presenting from a page", () => {
  it("lets the desktop app permit what the deck embeds, fills its screen, and tidies up when it closes", async () => {
    const { client } = vault(2);
    const finished = vi.fn();
    const leave = vi.fn();
    const fillScreen = vi.fn().mockResolvedValue(leave);
    present.willPresent.mockResolvedValue(finished);
    present.fillScreen = fillScreen;
    const deck = JSON.parse(text(2));
    await presentFrom(client, "talks/pitch.deck", deck, 1, vi.fn());
    expect(present.willPresent).toHaveBeenCalledWith(deck);
    const request = present.openPresentation.mock.calls[0]![0] as { start: number; imageUrl(path: string): string; fullscreen(): void; onClosed(): void };
    expect(request.start).toBe(1);
    expect(request.imageUrl("a.png")).toBe("asset://a.png");
    // F gives the screen, and again gives it back.
    request.fullscreen();
    await waitFor(() => expect(fillScreen).toHaveBeenCalledTimes(1));
    await act(async () => {});
    request.fullscreen();
    expect(leave).toHaveBeenCalledTimes(1);
    request.onClosed();
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it("opens a plain presentation where the app has no screen of its own", async () => {
    const { client } = vault(1);
    present.willPresent.mockReset();
    present.fillScreen = undefined;
    await presentFrom(client, "talks/pitch.deck", JSON.parse(text(1)), 0, vi.fn());
    expect(present.openPresentation.mock.calls[0]![0]).not.toHaveProperty("fullscreen");
  });
});
