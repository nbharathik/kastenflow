import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    // Style sheets are left empty in tests, except the ones a test reads as text (`?raw`): the exported page carries them.
    css: { include: [/\?raw/] },
    // reveal.js fits text on a timer it never clears. In a test file that ends sooner, the timer fires after the
    // page is gone and finds no cancelAnimationFrame; no test is left for it to touch. Only that error is let
    // through: any other after a file ends still fails the run.
    onUnhandledError: (error) =>
      !(/cancelAnimationFrame is not a function/.test(error.message) && (error.stack ?? "").includes("reveal.js")),
  },
});
