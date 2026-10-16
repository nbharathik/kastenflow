import { describe, expect, it } from "vitest";

import type { RequestOutcome } from "../../../chat/agent-types";
import { clockOf, reportText, resultOf, speedOf, stageOf, triesOf } from "./report";

const at = new Date(2026, 9, 12, 14, 5, 9).getTime();
const worked: RequestOutcome = { at, provider: "chatgpt", model: "gpt-5", route: "chatgpt.com/backend-api/codex/responses", ok: true, stage: "stream", status: 200, kind: null, reason: "", attempts: 1, firstByteMs: 520, totalMs: 4210, renewed: true, rebuilt: false };
const failed: RequestOutcome = { at: at - 60_000, provider: "openai", model: "local-model", route: "localhost:8000/v1/chat/completions", ok: false, stage: "request", status: 503, kind: "connection", reason: "closed", attempts: 4, firstByteMs: null, totalMs: 9400, renewed: false, rebuilt: true };

describe("the connection report's words", () => {
  it("names the stage a request reached", () => {
    expect(stageOf("signIn")).toBe("Sign-in");
    expect(stageOf("renewal")).toBe("Renewing the sign-in");
    expect(stageOf("modelList")).toBe("Model list");
    expect(stageOf("request")).toBe("Request");
    expect(stageOf("stream")).toBe("Answer");
  });

  it("says how it ended: worked, or what failed and how", () => {
    expect(resultOf(worked)).toBe("Worked");
    expect(resultOf(failed)).toBe("Failed: connection (503, closed)");
    expect(resultOf({ ...failed, kind: "rateLimited", status: 429, reason: "rate_limit_exceeded" })).toBe("Failed: rate limit (429, rate_limit_exceeded)");
    expect(resultOf({ ...failed, kind: null, status: null, reason: "" })).toBe("Failed");
    expect(resultOf({ ...failed, kind: "other", status: null, reason: "timeout" })).toBe("Failed: error (timeout)");
  });

  it("counts the tries, and says what was done to get through", () => {
    expect(triesOf(worked)).toBe("1 try, token renewed");
    expect(triesOf(failed)).toBe("4 tries, connection made again");
    expect(triesOf({ ...worked, renewed: false, rebuilt: true })).toBe("1 try, connection made again");
    expect(triesOf({ ...worked, renewed: true, rebuilt: true })).toBe("1 try, token renewed, connection made again");
    expect(triesOf({ ...worked, renewed: false })).toBe("1 try");
  });

  it("says how long it took", () => {
    expect(speedOf(worked)).toBe("520 ms to the first word, 4.2 s in all");
    expect(speedOf({ ...worked, firstByteMs: 1500 })).toBe("1.5 s to the first word, 4.2 s in all");
    expect(speedOf(failed)).toBe("9.4 s in all");
    expect(speedOf({ ...worked, firstByteMs: 80, totalMs: 120 })).toBe("80 ms to the first word, 120 ms in all");
  });

  it("writes the time of day", () => {
    expect(clockOf(at)).toBe("14:05:09");
  });
});

describe("the report as text to copy", () => {
  it("is one line a request, newest first as given, with the time in full and no secrets in it", () => {
    const text = reportText([worked, failed]);
    const lines = text.split("\n");
    expect(lines[0]).toBe("KastenFlow connection report");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("2026-10-12 14:05:09 | chatgpt | gpt-5 | chatgpt.com/backend-api/codex/responses | Answer | Worked | 1 try, token renewed | 520 ms to the first word, 4.2 s in all");
    expect(lines[2]).toContain("Failed: connection (503, closed)");
    expect(lines[2]).toContain("4 tries, connection made again");
  });

  it("says so when there is nothing", () => {
    expect(reportText([])).toBe("KastenFlow connection report\nNo requests yet.");
  });
});
