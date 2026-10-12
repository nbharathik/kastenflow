// Builds the website into _site: the page assembled from site/, its styles,
// scripts and pictures, and the app's browser preview as the demo under
// demo/. The Website workflow runs it; run it yourself to look first.
//
//   node scripts/build-site.mjs <owner/repository> [site URL] [--no-demo]
//
// The page's GitHub links name the repository, and its social preview needs
// the site's own address (https://<owner>.github.io/<repository>).
// --no-demo leaves the demo out, for a quick look at the page alone.

import { execFileSync, execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** What the demo may load: its own files, pictures and files it makes
 * itself, and nothing from anywhere else. */
const DEMO_CSP = [
  "default-src 'self'",
  // The slide engine compiles WebAssembly; JavaScript eval stays blocked.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** Apply the demo's policy to the built page, refusing content it cannot protect. */
export function secureDemoPage(html) {
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) throw new Error("the demo's page has an inline script, which its policy would block");
  if (!html.includes("<head>")) throw new Error("the demo's page has no head for its security policy");
  return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${DEMO_CSP}" />`);
}

/** Puts each `<!-- include <file> -->` in place. A section may include its own
 * parts, as the banner includes its views; `read(file)` gives a file's text. */
export function includePartials(text, read, depth = 0) {
  if (depth > 3) throw new Error("site partials include each other too deeply");
  return text.replace(/<!-- include (\S+) -->/g, (_, file) => includePartials(read(file).trimEnd(), read, depth + 1));
}

function main() {
  const args = process.argv.slice(2);
  const demo = !args.includes("--no-demo");
  const [repo, site] = args.filter((a) => !a.startsWith("--"));
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    console.error("usage: build-site.mjs <owner/repository> [site URL] [--no-demo]");
    process.exit(2);
  }
  const [owner, name] = repo.split("/");
  const home = (site ?? `https://${owner.toLowerCase()}.github.io/${name}`).replace(/\/+$/, "");

  const out = "_site";
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out);

  if (demo) {
    // A relative base serves the demo from any folder, such as /<repository>/demo/.
    const vite = ["-C", "app", "exec", "vite", "build", "--base", "./", "--outDir", `../${out}/demo`, "--emptyOutDir"];
    // On Windows pnpm is a .cmd shim, which Node starts only through a shell.
    if (process.platform === "win32") execSync(["pnpm", ...vite].join(" "), { stdio: "inherit" });
    else execFileSync("pnpm", vite, { stdio: "inherit" });
    // The demo holds only its own files, as the app does: GitHub Pages sends
    // no policy of its own, so the page carries one.
    const demoPage = join(out, "demo", "index.html");
    writeFileSync(demoPage, secureDemoPage(readFileSync(demoPage, "utf8")));
  }

  // The page: site/index.html with its sections put in place.
  const read = (file) => {
    const path = join("site", file);
    if (!existsSync(path)) throw new Error(`the site includes ${file}, which does not exist`);
    return readFileSync(path, "utf8");
  };
  let page = includePartials(readFileSync("site/index.html", "utf8"), read);
  const scripts = readdirSync("site/js").map((file) => readFileSync(join("site/js", file), "utf8")).join("\n");
  page = page.replace("<!-- icons -->", iconSymbols(page, scripts));
  page = page.replaceAll("__REPO__", repo).replaceAll("__SITE__", home);
  if (/__[A-Z]+__/.test(page)) throw new Error("the page has a placeholder this script does not fill");
  writeFileSync(join(out, "index.html"), page);

  for (const dir of ["css", "js", "img"]) cpSync(join("site", dir), join(out, dir), { recursive: true });
  for (const file of ["logo-tile.svg", "social-preview.png"]) cpSync(join("docs/brand", file), join(out, "img", file));
  for (const file of readdirSync("docs/screenshots").filter((f) => f.endsWith(".webp"))) cpSync(join("docs/screenshots", file), join(out, "img", file));
  cpSync("app/src/ui/LICENSE-lucide.txt", join(out, "LICENSE-lucide.txt"));

  console.log(`Built ${out} for ${home}/${demo ? "" : " (without the demo)"}`);
}

/** An SVG <symbol> for each of the app's icons the page or its scripts use
 * as `#i-<name>` and the page does not draw itself. */
function iconSymbols(html, scripts) {
  const icons = new Map();
  for (const [, key, parts] of readFileSync("app/src/ui/icons.ts", "utf8").matchAll(/^\s*"([\w-]+)": (\[.*\]),$/gm)) icons.set(key, JSON.parse(parts));
  const own = new Set([...html.matchAll(/id="i-([\w-]+)"/g)].map((m) => m[1]));
  const used = [...new Set([...`${html}\n${scripts}`.matchAll(/#i-([a-z][\w-]*)/g)].map((m) => m[1]))].filter((key) => !own.has(key)).sort();
  const symbols = used.map((key) => {
    const parts = icons.get(key);
    if (!parts) throw new Error(`the page uses an icon the app does not have: ${key}`);
    const body = parts.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`).join("");
    return `<symbol id="i-${key}" viewBox="0 0 24 24">${body}</symbol>`;
  });
  return `<!-- Icons: Lucide (ISC licence, LICENSE-lucide.txt), https://lucide.dev -->\n${symbols.join("\n")}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
