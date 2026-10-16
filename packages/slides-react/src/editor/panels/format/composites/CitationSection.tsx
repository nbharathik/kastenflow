import { type CitationStyle, closestReference } from "@kasten-slides/wasm";
import { useEffect, useMemo, useState } from "react";

import { ReferenceList } from "../../../citations/ReferenceList.tsx";
import { useReferences } from "../../../citations/use-references.ts";
import { Row, SelectField, TextField, TriToggle } from "../controls.tsx";
import type { SectionProps } from "../types.ts";
import { agree, only, shared } from "../values.ts";
import { patchEach } from "../write.ts";
import { TextButton } from "../../../ui/Button.tsx";
import { addCitationKeys, parseKeys, showKeys } from "./citation-keys.ts";
import { CompositeSection } from "./CompositeSection.tsx";

const STYLES: { value: CitationStyle; label: string }[] = [
  { value: "short", label: "Short: Vaswani et al., 2017 (NeurIPS)" },
  { value: "numbered", label: "Numbered: [1]" },
  { value: "full", label: "Full reference" },
  { value: "list", label: "List of every work cited" },
];

/** References by their keys, and how they are written. */
export function CitationSection({ session, ui, elements }: SectionProps) {
  const citations = only(elements, "citation");
  const keys = shared(citations.map((c) => showKeys(c.keys)), "");
  const style = agree<CitationStyle>(citations.map((c) => c.format ?? "short"), "short");
  const links = agree(citations.map((c) => Boolean(c.links)), false);
  const works = useReferences();
  const [finding, setFinding] = useState(false);
  const known = useMemo(() => new Set(works?.map((w) => w.key)), [works]);
  // The keys the person just typed for these citations. A key the bibliography does not have is pointed out for these, once they are typed,
  // and not for a citation that is only selected: the panel does not flag what nobody asked about (Tools, Lint lists it on request).
  const [typed, setTyped] = useState<readonly string[] | null>(null);
  const selected = citations.map((c) => c.id).join(",");
  useEffect(() => setTyped(null), [selected]);
  // The typed keys the bibliography does not have (only when there is a bibliography to check against).
  const unknown = works && typed ? [...new Set(typed)].filter((key) => !known.has(key)) : [];
  const held = new Set(citations.flatMap((c) => c.keys).filter((key) => citations.every((c) => c.keys.includes(key))));
  const swap = (key: string, instead: string) => {
    patchEach(session, citations, (c) => (c.keys.includes(key) ? { keys: [...new Set(c.keys.map((k) => (k === key ? instead : k)))] } : null));
    setTyped((now) => now && now.map((k) => (k === key ? instead : k)));
  };
  const toggle = (key: string) => {
    if (held.has(key)) patchEach(session, citations, (c) => ({ keys: c.keys.filter((k) => k !== key) }));
    else addCitationKeys(session, citations, [key]);
  };

  return (
    <CompositeSection id="citation" title="Citation" ui={ui} ids={citations.map((c) => c.id)}>
      <div className="ks-sp-field">
        <span className="ks-sp-label">Keys</span>
        <div data-primary="">
          <TextField
            label="Citation keys"
            value={keys.value}
            mixed={keys.mixed}
            placeholder="vaswani2017, devlin2019"
            onCommit={(text) => {
              setTyped(parseKeys(text));
              patchEach(session, citations, () => ({ keys: parseKeys(text) }));
            }}
          />
        </div>
        <p className="ks-sp-hint">One key for each reference, separated by commas.</p>
      </div>
      {unknown.length > 0 ? (
        <ul className="ks-ct-unknown" aria-label="Keys that are not in the bibliography">
          {unknown.map((key) => {
            const nearest = closestReference(key);
            return (
              <li key={key}>
                <span>
                  <code>{key}</code> is not in the bibliography.
                </span>
                {nearest ? (
                  <span>
                    Did you mean <code>{nearest}</code>?{" "}
                    <button type="button" className="ks-ct-use" onClick={() => swap(key, nearest)}>
                      Use it
                    </button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {works && works.length > 0 ? (
        <div className="ks-sp-field">
          <TextButton onClick={() => setFinding((now) => !now)} aria-expanded={finding}>
            {finding ? "Hide the references" : "Find a reference…"}
          </TextButton>
          {finding ? <ReferenceList works={works} chosen={held} onToggle={toggle} label="References" focus /> : null}
        </div>
      ) : null}
      <Row label="Format" wide>
        <SelectField<CitationStyle> label="Citation format" value={style} options={STYLES} onPick={(picked) => patchEach(session, citations, () => ({ format: picked }))} />
      </Row>
      <TriToggle label="Link each work" on={links} onChange={(next) => patchEach(session, citations, (c) => (Boolean(c.links) === next ? null : { links: next }))} />
      <p className="ks-sp-hint">A work with a DOI, a web address or an arXiv number opens its page from the slide, the show and the exports.</p>
    </CompositeSection>
  );
}
