import { beforeEach, describe, expect, it } from "vitest";

import { allowed, anyControl, capabilitiesOf, forgetCapabilities, NOTHING, pruned, type ModelCapabilities } from "./capabilities";
import { keepSettings, learnedEffort, learnEffort, savedSettings } from "./prefs";
import { describe as summary, inRange, isSet, readSettings, setting } from "./settings";
import { scriptedChat } from "./test-kit";

const none: ModelCapabilities = {
  version: 1,
  route: { kind: "chatCompletions", official: false },
  model: "m",
  family: "x",
  verified: true,
  reasoningEffort: null,
  thinking: null,
  temperature: null,
  maxOutput: null,
  effortRefused: false,
};
const plan: ModelCapabilities = { ...none, route: { kind: "chatGptResponses" }, model: "gpt-6.1-sol", family: "gpt-6", verified: false, reasoningEffort: ["low", "medium", "high"] };
const local: ModelCapabilities = { ...none, temperature: { min: 0, max: 2 }, maxOutput: { min: 256, max: 131072 } };
const claude: ModelCapabilities = {
  ...none,
  route: { kind: "anthropicMessages" },
  model: "claude-sonnet-4-5",
  thinking: { min: 1024, max: 31999, default: 8000 },
  temperature: { min: 0, max: 1 },
  maxOutput: { min: 256, max: 32000 },
};

beforeEach(() => {
  localStorage.clear();
  forgetCapabilities();
});

describe("the controls a model offers", () => {
  it("shows the ChatGPT plan no temperature and no longest answer, only an effort to try", () => {
    const controls = allowed(plan);
    expect(controls).toMatchObject({ efforts: ["low", "medium", "high"], effortTried: true, thinking: null, temperature: null, maxOutput: null });
    expect(anyControl(controls)).toBe(true);
    // Found to work: no longer a thing to try. Found to be refused: gone.
    expect(allowed(plan, {}, "works").effortTried).toBe(false);
    const refused = allowed(plan, {}, "refused");
    expect(refused.efforts).toEqual([]);
    expect(anyControl(refused)).toBe(false);
    expect(allowed({ ...plan, effortRefused: true }).efforts).toEqual([]);
    expect(allowed({ ...plan, verified: true }).effortTried).toBe(false);
  });

  it("offers nothing for a model it knows nothing of", () => {
    expect(allowed(null)).toBe(NOTHING);
    expect(anyControl(allowed(none))).toBe(false);
    expect(allowed(local)).toMatchObject({ efforts: [], temperature: { min: 0, max: 2 }, maxOutput: { min: 256, max: 131072 } });
  });

  it("takes the temperature away while Claude thinks", () => {
    expect(allowed(claude).temperature).toEqual({ min: 0, max: 1 });
    expect(allowed(claude, { thinkingBudget: 4000 }).temperature).toBeNull();
    // A model with no thinking budget keeps its temperature whatever is set.
    expect(allowed(local, { thinkingBudget: 4000 }).temperature).toEqual({ min: 0, max: 2 });
  });

  it("leaves out of settings what the model does not take or what is out of range", () => {
    const wide = { reasoningEffort: "high", thinkingBudget: 4000, temperature: 0.5, maxOutputTokens: 1000 } as const;
    expect(pruned(wide, allowed(plan))).toEqual({ reasoningEffort: "high" });
    expect(pruned(wide, allowed(local))).toEqual({ temperature: 0.5, maxOutputTokens: 1000 });
    // Thinking on: the budget and the longest answer stay, the temperature goes.
    expect(pruned(wide, allowed(claude, wide))).toEqual({ thinkingBudget: 4000, maxOutputTokens: 1000 });
    expect(pruned({ temperature: 3, maxOutputTokens: 5, thinkingBudget: 10 }, allowed(claude))).toEqual({});
    expect(pruned({ temperature: Number.NaN }, allowed(local))).toEqual({});
    expect(pruned(wide, NOTHING)).toEqual({});
    expect(pruned({ reasoningEffort: "high" }, allowed(plan, {}, "refused"))).toEqual({});
  });
});

describe("settings helpers", () => {
  it("sets and clears one setting without touching the others", () => {
    const one = setting({}, "temperature", 0.7);
    expect(one).toEqual({ temperature: 0.7 });
    expect(setting(one, "maxOutputTokens", 900)).toEqual({ temperature: 0.7, maxOutputTokens: 900 });
    expect(setting(one, "temperature", undefined)).toEqual({});
    expect(isSet({})).toBe(false);
    expect(isSet(one)).toBe(true);
  });

  it("holds a typed number to the range, and ignores text that is not one", () => {
    const range = { min: 0, max: 2 };
    expect(inRange("1.256", range)).toBe(1.26);
    expect(inRange("9", range)).toBe(2);
    expect(inRange("-3", range)).toBe(0);
    expect(inRange("", range)).toBeUndefined();
    expect(inRange("abc", range)).toBeUndefined();
    expect(inRange("1000.6", { min: 256, max: 4000 }, true)).toBe(1001);
  });

  it("reads stored settings with care", () => {
    expect(readSettings({ reasoningEffort: "high", temperature: 0.2, thinkingBudget: 2000, maxOutputTokens: 800, other: 1 })).toEqual({
      reasoningEffort: "high",
      temperature: 0.2,
      thinkingBudget: 2000,
      maxOutputTokens: 800,
    });
    expect(readSettings({ reasoningEffort: "extreme", temperature: "hot", thinkingBudget: Number.NaN })).toEqual({});
    expect(readSettings(null)).toEqual({});
    expect(readSettings("x")).toEqual({});
  });

  it("describes what is set in a line", () => {
    expect(summary({})).toBe("");
    expect(summary({ reasoningEffort: "high", thinkingBudget: 8000, temperature: 0.4, maxOutputTokens: 2000 })).toBe("High effort · 8,000 thinking tokens · temperature 0.4 · up to 2,000 tokens");
  });
});

describe("what is remembered between runs", () => {
  it("keeps the settings last used with each model, and forgets when none are set", () => {
    keepSettings("Local", "llama", { temperature: 0.3 });
    keepSettings("Local", "qwen", { maxOutputTokens: 700 });
    expect(savedSettings("Local", "llama")).toEqual({ temperature: 0.3 });
    expect(savedSettings("Local", "qwen")).toEqual({ maxOutputTokens: 700 });
    expect(savedSettings("Other", "llama")).toEqual({});
    keepSettings("Local", "llama", {});
    expect(savedSettings("Local", "llama")).toEqual({});
    expect(savedSettings("Local", "qwen")).toEqual({ maxOutputTokens: 700 });
  });

  it("keeps a bounded number, the newest", () => {
    for (let i = 0; i < 60; i++) keepSettings("P", `m${i}`, { temperature: 0.5 });
    expect(savedSettings("P", "m59")).toEqual({ temperature: 0.5 });
    expect(savedSettings("P", "m0")).toEqual({});
  });

  it("survives storage that holds nonsense", () => {
    localStorage.setItem("kasten.chat.settings", "not json");
    localStorage.setItem("kasten.chat.effort", "[1,2]");
    expect(savedSettings("P", "m")).toEqual({});
    expect(learnedEffort("P", "m")).toBeNull();
    keepSettings("P", "m", { temperature: 1 });
    expect(savedSettings("P", "m")).toEqual({ temperature: 1 });
  });

  it("remembers whether a model takes a reasoning effort", () => {
    expect(learnedEffort("ChatGPT", "gpt-6.1-sol")).toBeNull();
    learnEffort("ChatGPT", "gpt-6.1-sol", "refused");
    expect(learnedEffort("ChatGPT", "gpt-6.1-sol")).toBe("refused");
    learnEffort("ChatGPT", "gpt-6.1-sol", "works");
    expect(learnedEffort("ChatGPT", "gpt-6.1-sol")).toBe("works");
    expect(learnedEffort("ChatGPT", "other")).toBeNull();
  });
});

describe("asking the backend what a model takes", () => {
  it("asks once for a model, and again for another", async () => {
    const chat = scriptedChat();
    chat.capabilities = local;
    const first = await capabilitiesOf(chat, "Local", "llama");
    await capabilitiesOf(chat, "Local", "llama");
    await capabilitiesOf(chat, "Local", "qwen");
    expect(chat.capabilityAsks).toEqual(["Local|llama", "Local|qwen"]);
    expect(first).toMatchObject({ model: "llama", temperature: { min: 0, max: 2 } });
  });

  it("asks again after it could not be told, and after what a turn may have taught", async () => {
    const chat = scriptedChat();
    expect(await capabilitiesOf(chat, "P", "m")).toBeNull();
    chat.capabilities = plan;
    expect(await capabilitiesOf(chat, "P", "m")).toMatchObject({ family: "gpt-6" });
    forgetCapabilities("P", "m");
    await capabilitiesOf(chat, "P", "m");
    expect(chat.capabilityAsks).toEqual(["P|m", "P|m", "P|m"]);
  });
});
