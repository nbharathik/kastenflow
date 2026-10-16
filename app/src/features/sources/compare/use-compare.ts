// What the comparison dialog is made from: the references with their PDFs and
// those PDFs' highlights, read from the vault when it opens.

import { useEffect, useMemo } from "react";

import { buildRows } from "../../references/rows";
import { useBibliography } from "../../references/use-bibliography";
import { useSources } from "../store";
import { papersFrom, type ComparePaper } from "./papers";

export interface ComparePapers {
  /** Null until everything is read. */
  papers: ComparePaper[] | null;
  /** Every key in the bibliography. */
  keys: ReadonlySet<string>;
  error: string | null;
}

export function useComparePapers(): ComparePapers {
  const { bib, error } = useBibliography();
  const list = useSources((s) => s.list);
  const highlights = useSources((s) => s.highlights);

  useEffect(() => {
    void useSources.getState().loadAll();
  }, []);

  const rows = useMemo(() => (bib ? buildRows(bib, (list ?? []).map((s) => s.path)) : null), [bib, list]);
  const papers = useMemo(() => (rows && list ? papersFrom(rows, list, highlights) : null), [rows, list, highlights]);
  const keys = useMemo(() => new Set(rows?.map((r) => r.key) ?? []), [rows]);
  return { papers, keys, error };
}
