// Asks a question of a thread to open for editing: the up arrow in an empty
// message box does, and the question shows its field (view/Message.tsx).

export const EDIT_QUESTION = "kasten-chat-edit-question";

export interface EditRequest {
  thread: string;
  message: string;
}

export function requestEdit(thread: string, message: string): void {
  window.dispatchEvent(new CustomEvent<EditRequest>(EDIT_QUESTION, { detail: { thread, message } }));
}
