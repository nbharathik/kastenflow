// What the popup's views share: what they need of the browser, the line said
// above a view, and how a failed request is told.
import { KastenError } from "./client.js";
import { h } from "./dom.js";
import { forgetPairing } from "./settings.js";
export const words = (error) => (error instanceof Error ? error.message : String(error));
export function noticeLine(notice) {
    return notice ? h("p", { class: notice.bad ? "notice is-bad" : "notice", role: notice.bad ? "alert" : "status" }, notice.text) : null;
}
/** What went wrong with a request, as the popup says it. A token Kasten does
 * not know is forgotten at once, so the next view asks to pair again. */
export async function trouble(env, error) {
    const unpaired = error instanceof KastenError && error.trouble === "unpaired";
    if (unpaired)
        await forgetPairing(env.storage).catch(() => { });
    return { text: words(error), unpaired };
}
