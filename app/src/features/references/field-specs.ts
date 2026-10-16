// Which fields the forms offer for each kind of entry, in the order a person
// reads them. Fields the form has no row for are shown read only and kept.

export interface FieldSpec {
  name: string;
  label: string;
  /** Under the box: how to write it. */
  hint?: string;
  /** A box of several lines. */
  long?: boolean;
  /** A short box. */
  narrow?: boolean;
}

const AUTHOR: FieldSpec = { name: "author", label: "Authors", hint: "Last, First and Last, First" };
const TITLE: FieldSpec = { name: "title", label: "Title" };
const YEAR: FieldSpec = { name: "year", label: "Year", narrow: true };
const IDENTIFIERS: FieldSpec[] = [
  { name: "doi", label: "DOI", hint: "For example 10.1000/xyz123" },
  { name: "eprint", label: "arXiv number", hint: "For example 1706.03762", narrow: true },
  { name: "url", label: "Link" },
  { name: "abstract", label: "Abstract", long: true },
  { name: "note", label: "Note", long: true },
];

/** The place a work appeared, by what kind of work it is. */
const WHERE: Record<string, FieldSpec[]> = {
  article: [
    { name: "journal", label: "Journal" },
    { name: "volume", label: "Volume", narrow: true },
    { name: "number", label: "Issue", narrow: true },
    { name: "pages", label: "Pages", narrow: true, hint: "12--34" },
  ],
  inproceedings: [
    { name: "booktitle", label: "Conference or proceedings" },
    { name: "pages", label: "Pages", narrow: true, hint: "12--34" },
  ],
  incollection: [
    { name: "booktitle", label: "Book" },
    { name: "publisher", label: "Publisher" },
    { name: "pages", label: "Pages", narrow: true, hint: "12--34" },
  ],
  book: [{ name: "publisher", label: "Publisher" }],
  phdthesis: [{ name: "school", label: "University" }],
  mastersthesis: [{ name: "school", label: "University" }],
  techreport: [{ name: "institution", label: "Institution" }],
};

const OTHER: FieldSpec[] = [{ name: "howpublished", label: "Where it appeared" }];

/** The rows the form shows for an entry of this type. */
export function fieldsFor(type: string): FieldSpec[] {
  return [AUTHOR, TITLE, YEAR, ...(WHERE[type.toLowerCase()] ?? OTHER), ...IDENTIFIERS];
}

const NAMES: Record<string, string> = {
  article: "Journal article",
  inproceedings: "Conference paper",
  book: "Book",
  incollection: "Book chapter",
  phdthesis: "PhD thesis",
  mastersthesis: "Master's thesis",
  techreport: "Technical report",
  misc: "Other",
  online: "Web page",
  unpublished: "Unpublished",
};

/** An entry type in plain words; a type this does not know is shown as it is written. */
export const typeLabel = (type: string): string => NAMES[type.toLowerCase()] ?? type;

/** The fields with a value that the form has no row for, in the order they came. */
export function extraFields(type: string, fields: Record<string, string>): [string, string][] {
  const shown = new Set(fieldsFor(type).map((f) => f.name));
  return Object.entries(fields).filter(([name, value]) => !shown.has(name) && value.trim() !== "");
}
