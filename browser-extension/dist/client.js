// Talking to Kasten: three requests to 127.0.0.1, with what went wrong said in
// words a person can act on. No cookies, no referrer, never to any other address.
export class KastenError extends Error {
    trouble;
    status;
    existing;
    constructor(trouble, message, status = 0, existing = []) {
        super(message);
        this.trouble = trouble;
        this.status = status;
        this.existing = existing;
        this.name = "KastenError";
    }
}
/** How long a request may take: a big page is read and written in a second or two. */
const TIMEOUT_MS = 20_000;
/** The address Kasten's extension routes are on. */
export const baseUrl = (port) => `http://127.0.0.1:${port}`;
function troubleOf(status) {
    switch (status) {
        case 401:
            return "unpaired";
        case 403:
            return "refused";
        case 503:
            return "off";
        case 413:
            return "too-big";
        case 429:
            return "busy";
        case 400:
        case 404:
        case 415:
        case 422:
            return "invalid";
        default:
            return "other";
    }
}
/** The cards a 409 answer names; none when it names any it cannot read. */
function savedCards(answer) {
    const list = answer && typeof answer === "object" && "existing" in answer && Array.isArray(answer.existing) ? answer.existing : [];
    const cards = [];
    for (const item of list) {
        if (!item || typeof item !== "object")
            return [];
        const { path, title, captured } = item;
        if (typeof path !== "string" || typeof title !== "string")
            return [];
        cards.push({ path, title, captured: typeof captured === "string" ? captured : null });
    }
    return cards;
}
export class Kasten {
    port;
    token;
    send;
    constructor(port, token, send = (url, init) => fetch(url, init)) {
        this.port = port;
        this.token = token;
        this.send = send;
    }
    async call(method, path, body) {
        const headers = {};
        if (body !== undefined)
            headers["Content-Type"] = "application/json";
        if (this.token)
            headers["Authorization"] = `Bearer ${this.token}`;
        let response;
        try {
            response = await this.send(`${baseUrl(this.port)}${path}`, {
                method,
                headers,
                body: body === undefined ? undefined : JSON.stringify(body),
                credentials: "omit",
                cache: "no-store",
                referrerPolicy: "no-referrer",
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
        }
        catch {
            throw new KastenError("closed", `KastenFlow did not answer at 127.0.0.1:${this.port}. Open KastenFlow, and in Settings → Browser extension turn the extension on and check the port.`);
        }
        let answer = null;
        try {
            answer = await response.json();
        }
        catch {
            // A reply that is not JSON is not Kasten's.
        }
        if (!response.ok) {
            const said = answer && typeof answer === "object" && "error" in answer && typeof answer.error === "string" ? answer.error : "";
            // A 409 that names cards says the page is saved; any other 409 is a refusal like the rest.
            const saved = response.status === 409 ? savedCards(answer) : [];
            const trouble = saved.length > 0 ? "saved" : troubleOf(response.status);
            throw new KastenError(trouble, said || `KastenFlow refused that (${response.status}).`, response.status, saved);
        }
        if (!answer || typeof answer !== "object")
            throw new KastenError("other", "That did not look like an answer from KastenFlow.", response.status);
        return answer;
    }
    /** Trades a pairing code for a token. `label` names this browser in Kasten's list. */
    pair(code, label) {
        return this.call("POST", "/v1/pair", { code: code.trim(), label });
    }
    /** The places a capture can go. */
    targets() {
        return this.call("GET", "/v1/targets");
    }
    /** Keeps a capture. */
    capture(request) {
        return this.call("POST", "/v1/capture", request);
    }
}
