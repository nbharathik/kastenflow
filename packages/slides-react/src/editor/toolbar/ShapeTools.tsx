import type { Arrow, Dash, Element, Shadow } from "@kasten-slides/wasm";
import type { JSX } from "react";

import { SEPARATOR, plainItem } from "../menus/build.ts";
import { ArrowPreview, DashPreview, WeightPreview } from "../menus/previews.tsx";
import type { Patch } from "../session/elements.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { useEditorValue } from "../useEditor.ts";
import { ColorButton } from "./ColorButton.tsx";
import { Group } from "./Group.tsx";
import { MenuButton } from "./ToolButton.tsx";

const WEIGHTS = [1, 2, 3, 4, 6, 8, 12];

const DASHES: { value: Dash; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dash", label: "Dash" },
  { value: "dot", label: "Dot" },
  { value: "dashDot", label: "Dash-dot" },
  { value: "longDash", label: "Long dash" },
];

const ARROWS: { value: Arrow; label: string }[] = [
  { value: "none", label: "None" },
  { value: "triangle", label: "Triangle" },
  { value: "stealth", label: "Stealth" },
  { value: "open", label: "Open" },
  { value: "oval", label: "Oval" },
  { value: "diamond", label: "Diamond" },
];

/** The shadows on offer: how far it falls, how soft it is, how dark. */
const SHADOWS: { id: string; label: string; shadow: (Patch & Pick<Shadow, "blur" | "dx" | "dy" | "alpha">) | null }[] = [
  { id: "none", label: "No shadow", shadow: null },
  { id: "soft", label: "Soft", shadow: { color: "text1", blur: 8, dx: 2, dy: 4, alpha: 0.3 } },
  { id: "medium", label: "Medium", shadow: { color: "text1", blur: 16, dx: 4, dy: 8, alpha: 0.35 } },
  { id: "hard", label: "Hard", shadow: { color: "text1", blur: 0, dx: 6, dy: 6, alpha: 0.4 } },
];

/** How see-through an element can be made from the bar; the panel has a slider for the rest. */
const OPACITIES = [100, 75, 50, 25, 10];

/** What has a fill, what has an outline, and what has arrowheads. */
const FILLED = new Set<Element["type"]>(["shape", "text"]);
const OUTLINED = new Set<Element["type"]>(["shape", "text", "line", "connector", "image"]);
const HEADED = new Set<Element["type"]>(["line", "connector"]);

/** The one value they all have, `none` for no elements, or "mixed". */
function agree<T>(values: T[], none: T): T | "mixed" {
  if (values.length === 0) return none;
  return values.every((v) => v === values[0]) ? values[0]! : "mixed";
}

/** Whether the selection has anything the shape tools apply to. */
export function hasShapeTools(session: EditorSession): boolean {
  return session.elements.find().some((e) => OUTLINED.has(e.type));
}

/** The name of the shadow an element has, for the menu's check mark: one of the presets, "custom", or "none". */
function shadowName(shadow: Shadow | null | undefined): string {
  if (!shadow) return "none";
  const preset = SHADOWS.find((s) => s.shadow && s.shadow.blur === shadow.blur && s.shadow.dx === shadow.dx && s.shadow.dy === shadow.dy && s.shadow.alpha === shadow.alpha);
  return preset?.id ?? "custom";
}

/**
 * Fill, border, shadow, opacity and arrowheads of the selected shapes, lines, connectors, text boxes and pictures. A control that the
 * selection has no use for (a fill for a line) is left out; nothing is drawn when the selection holds none of them.
 */
export function ShapeTools({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element | null {
  useEditorValue(session, (state) => state.selection);
  useEditorValue(session, () => session.slide);
  useEditorValue(session, (state) => state.deck.theme);
  const picked = session.elements.find();
  const outlined = picked.filter((e) => OUTLINED.has(e.type));
  if (outlined.length === 0) return null;
  const filled = outlined.filter((e) => FILLED.has(e.type));
  const headed = outlined.filter((e) => HEADED.has(e.type));
  const { theme } = session.deck;
  const ids = (list: Element[]) => list.map((e) => e.id);

  const fill = agree(filled.map((e) => e.style?.fill?.color ?? null), null);
  const border = agree(outlined.map((e) => e.style?.stroke?.color ?? null), null);
  const weight = agree(outlined.map((e) => e.style?.stroke?.width ?? null), null);
  const dash = agree(outlined.map((e) => e.style?.stroke?.dash ?? "solid"), "solid");
  const start = agree(headed.map((e) => e.style?.startArrow ?? "none"), "none");
  const end = agree(headed.map((e) => e.style?.endArrow ?? "none"), "none");
  const shadow = agree(outlined.map((e) => shadowName(e.style?.shadow)), "none");
  const opacity = agree(outlined.map((e) => Math.round((e.style?.opacity ?? 1) * 100)), 100);

  /** Changes part of the outline. Where an element has none yet, it gets one in the text colour to hold the change. */
  const setStroke = (part: Patch) => {
    const has = outlined.filter((e) => e.style?.stroke);
    const lacks = outlined.filter((e) => !e.style?.stroke);
    if (has.length > 0) session.elements.style({ stroke: part }, ids(has));
    if (lacks.length > 0) session.elements.style({ stroke: { color: "text1", ...part } }, ids(lacks));
  };

  return (
    <Group id="shape">
      {filled.length > 0 ? (
        <ColorButton
          theme={theme}
          icon="paint-bucket"
          label="Fill colour"
          value={fill === "mixed" ? null : fill}
          mixed={fill === "mixed"}
          noneLabel="Transparent"
          onPick={(color) => session.elements.style({ fill: color === null ? null : { color } }, ids(filled))}
        />
      ) : null}
      <ColorButton
        theme={theme}
        icon="pen-line"
        label="Border colour"
        value={border === "mixed" ? null : border}
        mixed={border === "mixed"}
        noneLabel="Transparent"
        onPick={(color) => (color === null ? session.elements.style({ stroke: null }, ids(outlined)) : setStroke({ color, alpha: null }))}
      />
      <MenuButton
        ui={ui}
        label="Border weight"
        items={() => WEIGHTS.map((w) => plainItem(`weight-${w}`, `${w} px`, () => setStroke({ width: w }), { checked: weight === w, trailing: <WeightPreview width={w} /> }))}
      >
        <WeightPreview width={typeof weight === "number" ? weight : 2} scale={0.6} />
      </MenuButton>
      <MenuButton
        ui={ui}
        label="Border dash"
        items={() => DASHES.map((d) => plainItem(`dash-${d.value}`, d.label, () => setStroke({ dash: d.value === "solid" ? null : d.value }), { checked: dash === d.value, trailing: <DashPreview dash={d.value} /> }))}
      >
        <DashPreview dash={dash === "mixed" ? "solid" : dash} scale={0.6} />
      </MenuButton>
      {headed.length > 0 ? (
        <>
          <MenuButton
            ui={ui}
            label="Arrow start"
            items={() => ARROWS.map((a) => plainItem(`start-${a.value}`, a.label, () => session.elements.style({ startArrow: a.value === "none" ? null : a.value }, ids(headed)), { checked: start === a.value, trailing: <ArrowPreview arrow={a.value} end={false} /> }))}
          >
            <ArrowPreview arrow={start === "mixed" ? "none" : start} end={false} scale={0.6} />
          </MenuButton>
          <MenuButton
            ui={ui}
            label="Arrow end"
            items={() => ARROWS.map((a) => plainItem(`end-${a.value}`, a.label, () => session.elements.style({ endArrow: a.value === "none" ? null : a.value }, ids(headed)), { checked: end === a.value, trailing: <ArrowPreview arrow={a.value} /> }))}
          >
            <ArrowPreview arrow={end === "mixed" ? "none" : end} scale={0.6} />
          </MenuButton>
        </>
      ) : null}
      <MenuButton
        ui={ui}
        label="Shadow"
        icon="layers"
        on={shadow !== "none" && shadow !== "mixed"}
        items={() => [
          ...SHADOWS.map((s) => plainItem(`shadow-${s.id}`, s.label, () => session.elements.style({ shadow: s.shadow }, ids(outlined)), { checked: shadow === s.id })),
          SEPARATOR,
          plainItem("shadow-more", "More shadow options…", () => ui.openPanel("format")),
        ]}
      />
      <MenuButton
        ui={ui}
        label="Opacity"
        icon="droplet"
        on={opacity !== 100 && opacity !== "mixed"}
        items={() => OPACITIES.map((percent) => plainItem(`opacity-${percent}`, `${percent}%`, () => session.elements.style({ opacity: percent >= 100 ? null : percent / 100 }, ids(outlined)), { checked: opacity === percent }))}
      />
    </Group>
  );
}
