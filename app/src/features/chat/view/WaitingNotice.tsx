// A chat in line for a free place says so: only so many chats work at once
// (Settings → AI → Chat panel, "Agents working at once"). Stop takes it out of
// the line; the message can be sent again.

import "../history.css";

import type { Thread } from "../thread";

export function WaitingNotice({ thread }: { thread: Thread }) {
  const { waiting } = thread;
  if (!waiting) return null;
  return (
    <p className="kasten-chat-waiting" role="status">
      <span className="kasten-chat-wait-dot" aria-hidden="true" />
      {waiting.text}
      {waiting.n > 1 ? ` · ${waiting.n} in line` : ""}
    </p>
  );
}
