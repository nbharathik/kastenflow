// "Follow active page", as a compact switch in the message box's bar: whether
// the thread's page chip changes with the page in front.

import { Icon } from "../../../ui/Icon";
import { useChat } from "../store";
import { following, type ComposerThread } from "../thread";

export function FollowToggle({ thread }: { thread: ComposerThread }) {
  const follow = following(thread);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={follow}
      aria-label="Follow active page"
      className="kasten-chat-follow"
      title={follow ? "Following the page you are looking at: the first chip changes with it. Press to keep what it names." : "Not following: the first chip stays as it is. Press to follow the page you are looking at."}
      onClick={() => useChat.getState().setFollow(thread.id, !follow)}
    >
      <Icon name="link" className="size-3.5" />
    </button>
  );
}
