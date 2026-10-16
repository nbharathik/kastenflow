// What the window's draft layer (features/workspace/with-drafts.ts) does with
// a vault call about a draft, a new page that has no file yet. Each feature's
// `*-types.ts` adds a rules object for the calls it brings, which the layer
// spreads into its table; the compiler makes sure no call is left out.

/**
 * - `pass`: never given a draft.
 * - `make`: given a draft, makes its page first, then acts on the page.
 * - `own`: written out in the draft layer itself.
 * - `{ empty }`: about a draft with no page yet, the answer is `empty()`.
 */
export type DraftRule = "pass" | "make" | "own" | { empty: () => unknown };
