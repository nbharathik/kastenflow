// A long thread while an answer streams: each frame's text redraws the answer
// under way, not the finished messages above it (memoised rows), measured
// with React's Profiler.

import { Profiler, type ProfilerOnRenderCallback } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { parseWork } from "../markdown/blocks";
import { flushStream, useChat } from "../store";
import { resetChat, scriptedChat } from "../test-kit";
import { newId, type Message } from "../thread";
import { Conversation } from "./Conversation";

// The model picker sits in the message box and draws whenever the box does,
// so its draws say how often the box was drawn.
const renders = vi.hoisted(() => ({ picker: 0 }));
vi.mock("./ModelPicker", async (importActual) => {
  const actual = await importActual<typeof import("./ModelPicker")>();
  return {
    ...actual,
    ModelPicker: (props: Parameters<typeof actual.ModelPicker>[0]) => {
      renders.picker++;
      return actual.ModelPicker(props);
    },
  };
});

const EXCHANGES = 60;
const ANSWER = [
  "Here is what I found in **your notes**, with a few [[Seaside trip]] links:",
  "",
  "- the first point, with `code` and *emphasis*",
  "- the second point, which runs a little longer to wrap in the column",
  "  - and a nested one",
  "",
  "```ts",
  "const total = items.reduce((sum, item) => sum + item.size, 0);",
  "```",
  "",
  "| Day | Place |",
  "|-----|-------|",
  "| Mon | Hilltown |",
].join("\n");

function history(): Message[] {
  return Array.from({ length: EXCHANGES }, (_, i): Message[] => [
    { id: newId("m"), role: "user", text: `Question ${i}: what about the trip?`, context: [] },
    { id: newId("m"), role: "assistant", turn: `old-${i}`, provider: "Claude", model: "model-small", parts: [{ kind: "text", text: ANSWER }], status: "done", error: null, pinned: null },
  ]).flat();
}

afterEach(cleanup);

it("redraws only the streaming answer in a thread of 120 messages", async () => {
  const chat = scriptedChat();
  resetChat(chat);
  await useWorkspace.getState().connect({ client: new MemoryVault({}) });
  await useChat.getState().loadProviders();
  const id = useChat.getState().start({ open: true });
  useChat.setState((s) => ({ threads: { ...s.threads, [id]: { ...s.threads[id]!, messages: history() } } }));

  const commits: { actual: number; base: number }[] = [];
  const onRender: ProfilerOnRenderCallback = (_id, _phase, actual, base) => void commits.push({ actual, base });
  const start = performance.now();
  render(
    <Profiler id="chat" onRender={onRender}>
      <Conversation id={id} variant="full" page={null} />
    </Profiler>,
  );
  const drawn = performance.now() - start;
  expect(screen.getAllByRole("article", { name: "Answer" })).toHaveLength(EXCHANGES);
  // jsdom and React's development build are slow; a real window is many times quicker.
  expect(drawn).toBeLessThan(15_000);
  await act(async () => void (await useChat.getState().send(id, "And one more thing?")));

  commits.length = 0;
  for (let i = 0; i < 30; i++) {
    act(() => {
      for (const piece of ["Some ", "more ", "**words** "]) chat.emit({ chat: id, turn: "turn-1", kind: "text", text: piece });
      flushStream();
    });
  }
  // One commit per frame's worth of text, together a small share of full
  // redraws. Totals and the median, not each commit: a pause in a busy
  // test run can land on any one of them.
  expect(commits).toHaveLength(30);
  const shares = commits.map((c) => c.actual / c.base).sort((a, b) => a - b);
  const sum = (key: "actual" | "base") => commits.reduce((total, c) => total + c[key], 0);
  expect(sum("actual")).toBeLessThan(sum("base") / 4);
  expect(shares[15]!).toBeLessThan(0.15);
  const last = useChat.getState().threads[id]!.messages.at(-1)!;
  expect(last.role === "assistant" && last.parts[0]).toMatchObject({ kind: "text", text: "Some more **words** ".repeat(30) });
});

it("reads only the new end of a long answer and leaves the message box alone while it streams", async () => {
  const chat = scriptedChat();
  resetChat(chat);
  await useWorkspace.getState().connect({ client: new MemoryVault({}) });
  await useChat.getState().loadProviders();
  const id = useChat.getState().start({ open: true });
  render(<Conversation id={id} variant="full" page={null} />);
  await act(async () => void (await useChat.getState().send(id, "Write a long answer")));

  const FRAMES = 200;
  // Paragraphs of a few lines, a list and a fenced block now and then: what a long answer is.
  const piece = (n: number) => (n % 10 === 9 ? "- one item\n- another item\n\n```js\nlet a = 1;\n```\n\n" : "A line of the answer, with **bold**.\nAnd one more line of it.\n\n");
  parseWork.lines = 0;
  renders.picker = 0;
  let total = 0;
  for (let i = 0; i < FRAMES; i++) {
    const text = piece(i);
    total += text.split("\n").length - 1;
    act(() => {
      chat.emit({ chat: id, turn: "turn-1", kind: "text", text });
      flushStream();
    });
  }
  // Read in full each frame this is about total * frames / 2 lines; read in pieces, a small multiple of total.
  console.info(`stream cost: ${parseWork.lines} lines read for ${total} lines streamed in ${FRAMES} frames; message box drawn ${renders.picker} times`);
  expect(parseWork.lines).toBeLessThan(total * 4);
  expect(renders.picker).toBeLessThanOrEqual(2);
});
