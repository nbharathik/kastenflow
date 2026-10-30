// The words and arithmetic of the agent modes: the time box, what "until" means,
// and the policy a choice makes.

import { describe, expect, it } from "vitest";

import type { AgentPolicy, AgentPolicyView } from "../../lib/vault/types";
import { autonomousOn, boxOf, ended, scopeWords, timeOf, turnedOff, untilFor, untilWords, withMode, withProject } from "./policy";

const NOW = Date.parse("2026-10-22T10:00:00Z");
const HOUR = 3_600_000;
const view = (over: Partial<AgentPolicyView> = {}): AgentPolicyView => ({ mode: "balanced", until: null, projects: {}, active: "balanced", autonomousProjects: [], ...over });

describe("the time box", () => {
  it("is an hour, eight hours, or no end", () => {
    expect(untilFor("hour", NOW)).toBe("2026-10-22T11:00:00.000Z");
    expect(untilFor("eight", NOW)).toBe("2026-10-22T18:00:00.000Z");
    expect(untilFor("open", NOW)).toBeNull();
    expect(boxOf(null, NOW)).toBe("open");
    expect(boxOf(untilFor("hour", NOW), NOW)).toBe("hour");
    expect(boxOf(untilFor("eight", NOW), NOW)).toBe("eight");
  });

  it("reads the times the core writes, and counts one it cannot read as over", () => {
    // No zone means UTC, as the core reads it.
    expect(timeOf("2026-12-01 18:00")).toBe(Date.parse("2026-12-01T18:00:00Z"));
    expect(timeOf("2026-12-01")).toBe(Date.parse("2026-12-01T00:00:00Z"));
    expect(timeOf("2026-12-01T18:00:00+02:00")).toBe(Date.parse("2026-12-01T16:00:00Z"));
    expect(timeOf("2026-12-01T18:00:00Z")).toBe(Date.parse("2026-12-01T18:00:00Z"));
    expect(timeOf("soon")).toBeNull();
    expect(ended(null, NOW)).toBe(false);
    expect(ended(untilFor("hour", NOW), NOW + HOUR - 1)).toBe(false);
    expect(ended(untilFor("hour", NOW), NOW + HOUR)).toBe(true);
    expect(ended("whenever", NOW)).toBe(true);
  });

  it("says when it ends", () => {
    expect(untilWords(null, NOW)).toBe("until you turn it off");
    expect(untilWords(untilFor("hour", NOW), NOW)).toMatch(/^until \d{1,2}:\d{2}/);
    expect(untilWords(untilFor("hour", NOW), NOW)).not.toContain("Oct");
    expect(untilWords("2026-12-25T09:00:00Z", NOW)).toContain("Dec");
  });
});

describe("whether autonomous agents are on", () => {
  it("follows what the core says, and the clock since", () => {
    expect(autonomousOn(null, NOW)).toBe(false);
    expect(autonomousOn(view(), NOW)).toBe(false);
    const on = view({ mode: "autonomous", active: "autonomous", until: untilFor("hour", NOW) });
    expect(autonomousOn(on, NOW)).toBe(true);
    // The hour ran out since the core was asked.
    expect(autonomousOn(on, NOW + HOUR)).toBe(false);
    // A mode set but not holding (no history, or ended) is not on.
    expect(autonomousOn(view({ mode: "autonomous", active: "balanced" }), NOW)).toBe(false);
    // A project alone.
    expect(autonomousOn(view({ projects: { talks: "autonomous" }, autonomousProjects: ["talks"] }), NOW)).toBe(true);
  });

  it("names where", () => {
    const title = (folder: string) => folder.toUpperCase();
    expect(scopeWords(view({ active: "autonomous" }), title)).toBe("all your notes");
    expect(scopeWords(view({ autonomousProjects: ["talks", "thesis"] }), title)).toBe("TALKS, THESIS");
  });
});

describe("the policy a choice makes", () => {
  const base: AgentPolicy = { mode: "balanced", until: null, projects: { thesis: "review" } };

  it("picks the vault's mode; autonomous brings its time box and the others none", () => {
    expect(withMode(base, "autonomous", "hour", NOW)).toEqual({ mode: "autonomous", until: untilFor("hour", NOW), projects: { thesis: "review" } });
    expect(withMode(base, "autonomous", "open", NOW).until).toBeNull();
    expect(withMode({ ...base, mode: "autonomous", until: "2026-10-22T11:00:00.000Z" }, "review", "hour", NOW)).toEqual({ mode: "review", until: null, projects: { thesis: "review" } });
  });

  it("gives a project its own mode or takes it back", () => {
    const talks = withProject(base, "talks", "autonomous", "eight", NOW);
    expect(talks.projects).toEqual({ thesis: "review", talks: "autonomous" });
    expect(talks.until).toBe(untilFor("eight", NOW));
    // A second autonomous scope shares the first's time box.
    expect(withProject(talks, "notes", "autonomous", "hour", NOW + 1000).until).toBe(talks.until);
    // The last one to go ends the box.
    expect(withProject(talks, "talks", null, "hour", NOW)).toEqual({ mode: "balanced", until: null, projects: { thesis: "review" } });
  });

  it("turns every autonomous scope down, and leaves the stricter ones", () => {
    const on: AgentPolicy = { mode: "autonomous", until: "2026-10-22T11:00:00.000Z", projects: { thesis: "review", talks: "autonomous" } };
    expect(turnedOff(on)).toEqual({ mode: "balanced", until: null, projects: { thesis: "review" } });
    expect(turnedOff({ mode: "review", until: null, projects: {} })).toEqual({ mode: "review", until: null, projects: {} });
  });
});
