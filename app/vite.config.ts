import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { wasmGuard } from "../scripts/vite-wasm-guard.mjs";
import { devCsp } from "./dev-csp.ts";
import { drawioDev } from "./dev-drawio.ts";

// Settings follow the Tauri 2 + Vite guide: a fixed dev port the Rust side
// knows about (tauri.conf.json devUrl), and no watching of the Rust sources.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  // drawioDev serves the real diagram editor to the preview, when it was unpacked into public/drawio, and keeps it out of builds.
  plugins: [wasmGuard(), react(), tailwindcss(), drawioDev()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
    // Tauri applies no policy to the dev server's pages; this one does.
    headers: { "Content-Security-Policy": devCsp(1420, host) },
    // Compile the first screen's code as the server starts, before the
    // window asks for it: under `tauri dev` that is minutes early.
    warmup: { clientFiles: ["./src/main.tsx", "./src/shell/AppShell.tsx", "./src/features/workspace/page/NotePage.tsx"] },
    // The browser preview bundles its own samples, the core's starter
    // templates, tags and tour page, and the dev vault's for ?samples=dev.
    fs: { allow: [".", "../fixtures/dev-vault", "../fixtures/preview-vault", "../crates/kasten-core/defaults", "../packages", "../node_modules"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  // The slide engine's WebAssembly sits beside its glue code and is found by
  // URL, so the glue is left as it is.
  optimizeDeps: { exclude: ["@kasten-slides/wasm"] },
  // Crepe draws some of its menus with Vue, whose bundler build asks for
  // these flags. They are Vue's own defaults, set so it stops asking.
  define: {
    __VUE_OPTIONS_API__: "true",
    __VUE_PROD_DEVTOOLS__: "false",
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
  },
  build: {
    // Assets load from disk inside the app, not over a network; the editor
    // chunk (Milkdown, CodeMirror, KaTeX) is large but lazy.
    chunkSizeWarningLimit: 2500,
    // The main window, and the quick capture window's small page.
    rollupOptions: { input: { main: "index.html", capture: "capture.html" } },
    minify: process.env.TAURI_ENV_DEBUG ? false : undefined,
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/dom-shims.ts"],
    // The page-editor round trip mounts a real editor per fixture.
    testTimeout: 60_000,
  },
});
