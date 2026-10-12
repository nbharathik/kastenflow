// The Graph view's controls: what to show (the vault, a project, the pages
// around one), a box that finds a node and brings it to the middle, the
// filters (orphans, missing pages, kinds, tags), and how nodes look and open.

import "../pages/editor/styles/tokens.css";
import "../pages/page/popups.css";

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { VaultGraph } from "../../lib/vault/types";
import { Icon } from "../../ui/Icon";
import { Segmented } from "../../ui/Segmented";
import { Dropdown } from "../library/Dropdown";
import { Popup } from "../pages/page/Popup";
import { OPENS, OPENS_LABEL } from "../workspace/opens";
import { findNodes, hasFilters, kindCounts, kindLabel, SHOW_ALL, type GraphFilters, type Model } from "./graph-model";
import type { GraphOpens, ScopeChoice } from "./graph-prefs";

const control = "h-8 rounded-lg border text-13 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50";
const idle = "border-line bg-raised text-ink hover:bg-hover";
const set = "border-accent/55 bg-accent/12 font-medium text-accent";

export interface ScopeBarProps {
  choice: ScopeChoice;
  onChoice(choice: ScopeChoice): void;
  depth: 1 | 2 | 3;
  onDepth(depth: 1 | 2 | 3): void;
  /** The project shown, and the projects to pick from. */
  project: string | null;
  projects: readonly { folder: string; title: string }[];
  onProject(folder: string): void;
  /** The page the graph is around. */
  anchor: string | null;
}

/** Whole vault, this project or the pages around one, with how far around. */
export function ScopeBar({ choice, onChoice, depth, onDepth, project, projects, onProject, anchor }: ScopeBarProps) {
  return (
    <>
      <Segmented
        label="Show"
        value={choice}
        choices={[
          { value: "vault", label: "Whole vault" },
          { value: "project", label: "A project" },
          { value: "page", label: "Around a page" },
        ]}
        onChange={onChoice}
      />
      {choice === "project" && (
        <Dropdown label="Project" value={project ?? ""} options={projects.map((p) => ({ value: p.folder, label: p.title }))} onChange={onProject} display={projects.find((p) => p.folder === project)?.title ?? "Choose a project"} active={project === null} />
      )}
      {choice === "page" && (
        <Segmented
          label="Links away"
          value={String(depth) as "1" | "2" | "3"}
          choices={[
            { value: "1", label: "1 link" },
            { value: "2", label: "2 links" },
            { value: "3", label: "3 links" },
          ]}
          onChange={(v) => onDepth(Number(v) as 1 | 2 | 3)}
        />
      )}
      {choice === "page" && anchor === null && <span className="text-13 text-muted">Open a page first, or pick one with Graph around it.</span>}
    </>
  );
}

interface SearchProps {
  model: Model;
  /** Brings the node to the middle and selects it. */
  onPick(index: number): void;
}

/** A box that finds nodes by title as you type; Enter brings the first (or the one chosen with the arrows) to the middle. */
export function SearchBox({ model, onPick }: SearchProps) {
  const id = useId();
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const found = findNodes(model, text);
  const current = Math.min(active, Math.max(0, found.length - 1));
  const pick = (index: number) => {
    onPick(index);
    setText("");
    setActive(0);
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") setActive(Math.min(current + 1, found.length - 1));
    else if (event.key === "ArrowUp") setActive(Math.max(current - 1, 0));
    else if (event.key === "Enter" && found[current] !== undefined) pick(found[current]!);
    else if (event.key === "Escape" && text) setText("");
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <div className="relative">
      <label className={`${control} ${idle} flex w-56 items-center gap-2 px-2.5 focus-within:border-accent/60`}>
        <Icon name="search" className="size-3.5 shrink-0 text-muted" />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-expanded={found.length > 0}
          aria-controls={`${id}-list`}
          aria-activedescendant={found.length > 0 ? `${id}-${current}` : undefined}
          aria-label="Find a node in the graph"
          placeholder="Find and focus…"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
        />
      </label>
      {found.length > 0 && (
        <ul id={`${id}-list`} role="listbox" aria-label="Matches" className="absolute left-0 top-full z-30 mt-1 w-72 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-line bg-raised p-1 shadow-pop">
          {found.map((index, i) => (
            <li
              key={model.nodes[index]!.id}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === current}
              onMouseMove={() => setActive(i)}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(index);
              }}
              className={`flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-13 ${i === current ? "bg-hover" : ""}`}
            >
              <span className="min-w-0 flex-1 truncate">{model.nodes[index]!.title}</span>
              <span className="shrink-0 text-12 text-muted">{kindLabel(model.nodes[index]!.kind)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface FilterProps {
  graph: VaultGraph;
  filters: GraphFilters;
  onFilters(filters: GraphFilters): void;
  /** Tags to pick from, lower case, with how many notes carry each. */
  tags: readonly { tag: string; count: number }[];
}

/** Orphans, missing pages, kinds and tags, in one popup; the button shows how many are set. */
export function FilterMenu({ graph, filters, onFilters, tags }: FilterProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const kinds = kindCounts(graph);
  const hidden = new Set(filters.hiddenKinds);
  const count = Number(!filters.orphans) + Number(!filters.ghosts) + filters.hiddenKinds.length + filters.tags.length;
  const toggleKind = (kind: string) => onFilters({ ...filters, hiddenKinds: hidden.has(kind) ? filters.hiddenKinds.filter((k) => k !== kind) : [...filters.hiddenKinds, kind] });
  return (
    <span className="relative inline-flex">
      <button ref={button} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((was) => !was)} className={`${control} ${hasFilters(filters) ? set : idle} flex items-center gap-1.5 px-2.5`}>
        <Icon name="filter" className="size-3.5" />
        Filters
        {count > 0 && <span className="rounded bg-accent/15 px-1 text-12 tabular-nums">{count}</span>}
      </button>
      {open && (
        <Popup label="Graph filters" anchor={button} onClose={() => setOpen(false)} className="top-full mt-1 w-72 max-w-[calc(100vw-1rem)] p-3">
          <Inside>
          <div className="flex flex-col gap-3 text-13">
            <Check label="Pages with no links" checked={filters.orphans} onChange={(orphans) => onFilters({ ...filters, orphans })} />
            <Check label="Missing pages (links to pages not made yet)" checked={filters.ghosts} onChange={(ghosts) => onFilters({ ...filters, ghosts })} />
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-12 font-medium text-muted">Kinds</legend>
              {kinds
                .filter((k) => k.kind !== "ghost")
                .map((k) => (
                  <Check key={k.kind} label={`${k.label} (${k.count})`} checked={!hidden.has(k.kind)} onChange={() => toggleKind(k.kind)} />
                ))}
            </fieldset>
            <div className="flex flex-col gap-1.5">
              <span className="text-12 font-medium text-muted">Only pages tagged</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {filters.tags.map((tag) => (
                  <button key={tag} type="button" aria-label={`Stop filtering by #${tag}`} title="Remove" onClick={() => onFilters({ ...filters, tags: filters.tags.filter((t) => t !== tag) })} className="flex h-6 items-center gap-1 rounded-md bg-well px-1.5 text-12 hover:bg-hover">
                    #{tag}
                    <Icon name="close" className="size-3 text-muted" />
                  </button>
                ))}
                <Dropdown
                  label="Add a tag"
                  value=""
                  display="Add a tag"
                  options={tags.filter((t) => !filters.tags.includes(t.tag)).map((t) => ({ value: t.tag, label: `#${t.tag}`, detail: String(t.count) }))}
                  onChange={(tag) => onFilters({ ...filters, tags: [...filters.tags, tag] })}
                />
              </div>
            </div>
            {hasFilters(filters) && (
              <button type="button" onClick={() => onFilters(SHOW_ALL)} className="self-start rounded-md px-2 py-1 text-13 text-muted hover:bg-hover hover:text-ink">
                Clear filters
              </button>
            )}
          </div>
          </Inside>
        </Popup>
      )}
    </span>
  );
}

/** Keeps the popup it is in inside its pane: it opens toward the left instead when it would run past the right edge. */
function Inside({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const popup = root.current?.parentElement;
    if (!popup) return;
    popup.style.left = "0";
    popup.style.right = "";
    const edge = Math.min(popup.closest(".kasten-pane")?.getBoundingClientRect().right ?? Infinity, window.innerWidth);
    if (popup.getBoundingClientRect().right > edge - 8) {
      popup.style.left = "auto";
      popup.style.right = "0";
    }
  }, []);
  return <div ref={root}>{children}</div>;
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange(checked: boolean): void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-4 accent-[var(--color-accent)]" />
      <span>{label}</span>
    </label>
  );
}

interface LookProps {
  colourBy: "kind" | "project";
  onColourBy(by: "kind" | "project"): void;
  opens: GraphOpens;
  onOpens(opens: GraphOpens): void;
}

/** Colour by kind or project, and where a plain click opens a node. */
export function LookControls({ colourBy, onColourBy, opens, onOpens }: LookProps) {
  return (
    <>
      <Segmented
        label="Colour by"
        value={colourBy}
        choices={[
          { value: "kind", label: "Kind" },
          { value: "project", label: "Project" },
        ]}
        onChange={onColourBy}
      />
      <Dropdown
        label="A click opens"
        value={opens}
        display={opens === "auto" ? "Click: to the right" : `Click: ${OPENS_LABEL[opens].toLowerCase()}`}
        options={[{ value: "auto", label: "As Settings say (to the right if the same tab)" }, ...OPENS.map((o) => ({ value: o, label: OPENS_LABEL[o] }))]}
        onChange={(value) => onOpens(value as GraphOpens)}
        filterable={false}
      />
    </>
  );
}
