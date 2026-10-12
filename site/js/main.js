// The page's behaviour: theme, header, things arriving as they scroll into
// view, the download for this computer, copy buttons and the banner, whose
// live views load as they are opened.

import { setupTheme } from "./theme-toggle.js";
import { setupHero } from "./hero.js";

const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

setupTheme();
setupHeader();
setupReveals();
setupDownloads();
setupCopy();
setupHero();

function setupHeader() {
  const header = document.querySelector("[data-header]");
  const nav = document.getElementById("site-nav");
  const toggle = document.querySelector("[data-menu-toggle]");
  const stick = () => header.classList.toggle("is-stuck", scrollY > 8);
  addEventListener("scroll", stick, { passive: true });
  stick();

  const close = () => {
    nav.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
  };
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  nav.addEventListener("click", (event) => {
    if (event.target.closest("a")) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nav.classList.contains("is-open")) {
      close();
      toggle.focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (!header.contains(event.target)) close();
  });
}

/** Marks what is already on screen as arrived, hides the rest, and lets each
 * arrive as it scrolls into view. */
function setupReveals() {
  const items = [...document.querySelectorAll("[data-reveal]")];
  const onScreen = (el) => el.getBoundingClientRect().top < innerHeight * 0.92;
  for (const el of items) if (still || onScreen(el)) el.classList.add("is-in");
  document.documentElement.classList.add("js");
  if (still || !("IntersectionObserver" in window)) {
    for (const el of items) el.classList.add("is-in");
    return;
  }
  const seen = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        seen.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  for (const el of items) if (!el.classList.contains("is-in")) seen.observe(el);
}

/** The visitor's system, when it is one Kasten runs on. */
function desktop() {
  const agent = navigator.userAgent.toLowerCase();
  const platform = (navigator.userAgentData?.platform ?? navigator.platform ?? "").toLowerCase();
  if (/android|iphone|ipad|ipod|mobile/.test(agent)) return null;
  if (platform.startsWith("win") || agent.includes("windows")) return "windows";
  if (platform.startsWith("mac") || agent.includes("mac os")) return "mac";
  if (platform.includes("linux") || agent.includes("linux")) return "linux";
  return null;
}

function setupDownloads() {
  const os = desktop();
  if (!os) return;
  const name = { windows: "Windows", mac: "macOS", linux: "Linux" }[os];
  for (const label of document.querySelectorAll("[data-os-label]")) label.textContent = `Download for ${name}`;
  document.querySelector(`.systems [data-os="${os}"]`)?.classList.add("is-you");
}

function setupCopy() {
  for (const button of document.querySelectorAll("[data-copy]")) {
    const label = button.querySelector("span");
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        label.textContent = "Copied";
        button.classList.add("is-done");
      } catch {
        label.textContent = "Select and copy";
      }
      setTimeout(() => {
        label.textContent = "Copy";
        button.classList.remove("is-done");
      }, 2000);
    });
  }
}
