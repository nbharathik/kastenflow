import { describe, expect, it } from "vitest";

import { citationText } from "./cite-insert";

describe("citationText", () => {
  it("writes the whole command in plain text", () => {
    expect(citationText("As shown by ", ".", "knuth84")).toBe("\\cite{knuth84}");
    expect(citationText("", "", "a:b")).toBe("\\cite{a:b}");
  });

  it("adds only the key inside the braces of a citation", () => {
    expect(citationText("see \\cite{", "}", "k")).toBe("k");
    expect(citationText("see \\cite{a", "}", "k")).toBe(",k");
    expect(citationText("see \\cite{a,", "}", "k")).toBe("k");
    expect(citationText("see \\cite{a, ", "}", "k")).toBe("k");
    expect(citationText("\\citep[p. 3]{a", "} more", "k")).toBe(",k");
    expect(citationText("\\textcite*{", "}", "k")).toBe("k");
  });

  it("puts a comma after the key when more keys follow it", () => {
    expect(citationText("\\cite{a,", "b}", "k")).toBe("k,");
    expect(citationText("\\cite{", "b}", "k")).toBe("k,");
    expect(citationText("\\cite{a,", ",b}", "k")).toBe("k");
  });

  it("does not mistake other braces for a citation", () => {
    expect(citationText("\\label{", "}", "k")).toBe("\\cite{k}");
    expect(citationText("\\cite{a} and {", "}", "k")).toBe("\\cite{k}");
    expect(citationText("\\cite{a", "", "k")).toBe("\\cite{k}");
  });
});
