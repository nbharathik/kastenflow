import { builtInThemes } from "@kasten-slides/wasm";
import { type ChangeEvent, type JSX, useEffect, useState } from "react";

import { COMMON_FAMILIES } from "../dialogs/ThemeFonts.tsx";
import type { DialogProps } from "../dialogs/types.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { BRAND_COLOR_KEYS, type BrandColorKey, type BrandKit, brandOperations, brandPalette, emptyKit, kitText, normaliseHex, parseKit } from "./brand.ts";
import type { BrandScope } from "./brand-host.ts";
import "./brand.css";

const COLOR_LABELS: Record<BrandColorKey, string> = {
  text1: "Text",
  text2: "Text 2",
  bg1: "Background",
  bg2: "Background 2",
  accent1: "Accent 1",
  accent2: "Accent 2",
  accent3: "Accent 3",
  accent4: "Accent 4",
  accent5: "Accent 5",
  accent6: "Accent 6",
};

interface Found {
  slide: string;
  message: string;
}

/**
 * The brand kit of the vault (or of the project the deck is in): a logo, colours, two typefaces and a theme to start from. It can be
 * kept, put on this deck as one step of undo, and used to check the deck for colours that are not the brand's. New decks start from it.
 */
export function BrandDialog({ session, onClose }: DialogProps): JSX.Element {
  const host = session.host.brand;
  const [kit, setKit] = useState<BrandKit>(emptyKit);
  const [scope, setScope] = useState<BrandScope>("vault");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);
  const [found, setFound] = useState<Found[] | null>(null);
  const theme = session.deck.theme;

  useEffect(() => {
    let live = true;
    if (!host) return;
    host.read().then(
      (read) => {
        if (!live) return;
        const parsed = read ? parseKit(read.text) : null;
        if (parsed) {
          setKit(parsed);
          setScope(read?.scope ?? "vault");
        } else {
          // No kit yet: start from how this deck looks now.
          const colors: BrandKit["colors"] = {};
          for (const key of BRAND_COLOR_KEYS) {
            const hex = normaliseHex(theme.colors[key]);
            if (hex) colors[key] = hex;
          }
          setKit({ ...emptyKit(), name: session.deck.title, colors, heading: theme.fonts.heading.family, body: theme.fonts.body.family });
          if (read && !parsed) setNotice({ text: "The kit that was saved could not be read, so this is a new one.", bad: true });
        }
        setLoading(false);
      },
      () => {
        if (!live) return;
        setNotice({ text: "The brand kit could not be read.", bad: true });
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
    // The kit is read once, when the dialog opens.
  }, []);

  if (!host) {
    return (
      <Dialog title="Brand kit" width={420} onClose={onClose} footer={<TextButton onClick={onClose}>Close</TextButton>}>
        <p className="ks-brand-note">A brand kit needs a place to keep it, and this editor has none.</p>
      </Dialog>
    );
  }

  const change = (next: Partial<BrandKit>) => {
    setKit((was) => ({ ...was, ...next }));
    setNotice(null);
    setFound(null);
  };
  const setColor = (key: BrandColorKey, value: string | null) => {
    const colors = { ...kit.colors };
    if (value) colors[key] = value;
    else delete colors[key];
    change({ colors });
  };

  const chooseLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      change({ logo: await session.host.addImage(file.name, new Uint8Array(await file.arrayBuffer()), { source: "file" }) });
    } catch {
      setNotice({ text: "That picture could not be kept.", bad: true });
    }
  };

  const save = async (): Promise<boolean> => {
    try {
      await host.save(kitText(kit), scope);
      return true;
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "The brand kit could not be saved.", bad: true });
      return false;
    }
  };
  const keep = async () => {
    if (await save()) setNotice({ text: scope === "project" ? "Saved for this project." : "Saved for the vault." });
  };
  const keepAndApply = async () => {
    if (!(await save())) return;
    const done = session.run(() => session.core.applyBatch(brandOperations(kit)));
    setNotice({ text: done === undefined ? "Saved, but it could not be put on this deck." : "Saved and put on this deck. Undo takes it back.", ...(done === undefined ? { bad: true } : {}) });
  };
  const check = () => {
    const palette = brandPalette(kit);
    if (palette.length === 0) {
      setNotice({ text: "Choose the brand's colours first.", bad: true });
      return;
    }
    const issues = session.run(() => session.core.lintBrand(palette)) ?? [];
    setFound(issues.map((issue) => ({ slide: issue.slide, message: issue.message })));
  };

  const themes = builtInThemes();
  const slideNumber = (id: string) => session.deck.slides.findIndex((slide) => slide.id === id) + 1;

  return (
    <Dialog
      title="Brand kit"
      width={520}
      onClose={onClose}
      footer={
        <>
          <TextButton onClick={onClose}>Close</TextButton>
          <TextButton disabled={loading} onClick={() => void keep()}>
            Save kit
          </TextButton>
          <TextButton primary disabled={loading} onClick={() => void keepAndApply()}>
            Save and use on this deck
          </TextButton>
        </>
      }
    >
      <div className="ks-brand" aria-busy={loading}>
        {loading ? <p className="ks-brand-note">Reading the brand kit…</p> : null}
        <label className="ks-brand-row">
          <span className="ks-brand-label">Name</span>
          <input className="ks-input" type="text" value={kit.name} onChange={(event) => change({ name: event.target.value })} data-autofocus="" />
        </label>
        {host.project ? (
          <fieldset className="ks-brand-scope">
            <legend className="ks-brand-label">Kept for</legend>
            <label>
              <input type="radio" name="brand-scope" checked={scope === "vault"} onChange={() => setScope("vault")} /> Every deck in the vault
            </label>
            <label>
              <input type="radio" name="brand-scope" checked={scope === "project"} onChange={() => setScope("project")} /> Decks in the project “{host.project}”
            </label>
          </fieldset>
        ) : null}
        <div className="ks-brand-row">
          <span className="ks-brand-label">Logo</span>
          <span className="ks-brand-logo">
            <span className="ks-brand-path">{kit.logo ?? "None"}</span>
            <label className="ks-btn ks-text-btn">
              Choose…
              <input className="ks-brand-file" type="file" accept="image/*" aria-label="Choose a logo" onChange={(event) => void chooseLogo(event)} />
            </label>
            {kit.logo ? <TextButton onClick={() => change({ logo: null })}>Remove</TextButton> : null}
          </span>
        </div>
        <div className="ks-brand-colors" role="group" aria-label="Colours">
          {BRAND_COLOR_KEYS.map((key) => {
            const own = kit.colors[key];
            return (
              <div key={key} className="ks-brand-color">
                <input type="color" aria-label={COLOR_LABELS[key]} value={own ?? normaliseHex(theme.colors[key]) ?? "#000000"} onChange={(event) => setColor(key, normaliseHex(event.target.value))} />
                <span>{COLOR_LABELS[key]}</span>
                {own ? (
                  <button type="button" className="ks-brand-clear" aria-label={`Do not set ${COLOR_LABELS[key]}`} onClick={() => setColor(key, null)}>
                    ×
                  </button>
                ) : (
                  <span className="ks-brand-unset">theme's</span>
                )}
              </div>
            );
          })}
        </div>
        {(["heading", "body"] as const).map((role) => (
          <label key={role} className="ks-brand-row">
            <span className="ks-brand-label">{role === "heading" ? "Heading font" : "Body font"}</span>
            <select className="ks-select" value={kit[role] ?? ""} onChange={(event) => change(role === "heading" ? { heading: event.target.value || null } : { body: event.target.value || null })}>
              <option value="">The theme's own</option>
              {kit[role] && !COMMON_FAMILIES.includes(kit[role] as string) ? <option value={kit[role] as string}>{kit[role]}</option> : null}
              {COMMON_FAMILIES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="ks-brand-row">
          <span className="ks-brand-label">Start from theme</span>
          <select className="ks-select" value={kit.theme ?? ""} onChange={(event) => change({ theme: event.target.value || null })}>
            <option value="">Keep the deck's theme</option>
            {themes.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div className="ks-brand-check">
          <TextButton onClick={check}>Check this deck for other colours</TextButton>
          {found === null ? null : found.length === 0 ? (
            <p className="ks-brand-note" role="status">
              Every colour on the slides is the brand's or the theme's.
            </p>
          ) : (
            <ul className="ks-brand-found" aria-label="Elements with other colours">
              {found.map((item, i) => (
                <li key={i}>
                  <button type="button" className="ks-brand-go" onClick={() => session.goTo(item.slide)}>
                    Slide {slideNumber(item.slide)}
                  </button>{" "}
                  {item.message}
                </li>
              ))}
            </ul>
          )}
        </div>
        {notice ? (
          <p className={`ks-brand-note${notice.bad ? " is-bad" : ""}`} role={notice.bad ? "alert" : "status"}>
            {notice.text}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
