import { describe, expect, it } from "vitest";

import { keyProblem } from "./keys";

describe("a citation key", () => {
  it("is letters, digits and a few marks, starting and ending with a letter, digit or underscore", () => {
    for (const ok of ["vaswani2017attention", "doe_2020", "a", "x-y:z.1/2", "müller2020", "a+b", "_x_"]) expect(keyProblem(ok), ok).toBeNull();
  });

  it("says what is wrong with one that is not", () => {
    expect(keyProblem("")).toMatch(/Write a key/);
    expect(keyProblem("two words")).toMatch(/space/);
    expect(keyProblem("a,b")).toMatch(/“,”/);
    expect(keyProblem("a{b}")).toMatch(/“\{”/);
    expect(keyProblem("-start")).toMatch(/start/);
    expect(keyProblem("end.")).toMatch(/end/);
    expect(keyProblem("x".repeat(129))).toMatch(/128/);
  });
});
