// DOIs, arXiv identifiers and addresses found in what a person pastes. This is
// reading text and nothing else: no identifier is ever looked up anywhere.

export interface Identifiers {
  /** `10.1000/xyz`, as written (a DOI is compared without regard to case). */
  doi?: string;
  /** `1706.03762` or `hep-th/9901001`, without a version. */
  arxiv?: string;
  /** A web address that is not a DOI or arXiv link. */
  url?: string;
}

const DOI = /\b10\.\d{4,9}\/[^\s"'<>]+/;
const NEW_ARXIV = String.raw`\d{4}\.\d{4,5}`;
const OLD_ARXIV = String.raw`[a-z]+(?:-[a-z]+)*(?:\.[A-Z]{2})?\/\d{7}`;
const ARXIV_LINK = new RegExp(String.raw`arxiv\.org\/(?:abs|pdf)\/(${NEW_ARXIV}|${OLD_ARXIV})(?:v\d+)?`, "i");
const ARXIV_TAG = new RegExp(String.raw`\barxiv:\s*(${NEW_ARXIV}|${OLD_ARXIV})(?:v\d+)?`, "i");
const ARXIV_BARE = new RegExp(String.raw`^(${NEW_ARXIV})(?:v\d+)?$`);
const ADDRESS = /\bhttps?:\/\/[^\s"'<>]+/i;

const balanced = (text: string, open: string, close: string) => text.split(open).length === text.split(close).length;

/** A pasted DOI cut where an address or a sentence goes on past it. */
function trimDoi(raw: string): string {
  let doi = raw.replace(/[?#].*$/, "");
  for (;;) {
    const last = doi.at(-1);
    if (last !== undefined && ".,;:'\"]}".includes(last)) doi = doi.slice(0, -1);
    else if (last === ")" && !balanced(doi, "(", ")")) doi = doi.slice(0, -1);
    else return doi;
  }
}

function trimAddress(raw: string): string {
  let url = raw;
  for (;;) {
    const last = url.at(-1);
    if (last !== undefined && ".,;:'\"]}".includes(last)) url = url.slice(0, -1);
    else if (last === ")" && !balanced(url, "(", ")")) url = url.slice(0, -1);
    else return url;
  }
}

/** The DOI, arXiv identifier and web address in `text`. An address is named only when it is no DOI or arXiv link. */
export function findIdentifiers(text: string): Identifiers {
  const out: Identifiers = {};
  const doi = DOI.exec(text)?.[0];
  if (doi) {
    const clean = trimDoi(doi);
    if (clean.includes("/") && clean.length > 8) out.doi = clean;
  }
  const trimmed = text.trim();
  const arxiv = ARXIV_LINK.exec(text)?.[1] ?? ARXIV_TAG.exec(text)?.[1] ?? ARXIV_BARE.exec(trimmed)?.[1];
  if (arxiv) out.arxiv = arxiv;
  const address = ADDRESS.exec(text)?.[0];
  if (address && !out.doi && !out.arxiv) {
    const url = trimAddress(address);
    if (url.length > "https://x".length) out.url = url;
  }
  return out;
}

/** Whether the paste is an identifier or an address and nothing else, so only those fields can be filled. */
export function onlyIdentifiers(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\s/.test(t) && !/^(?:arxiv|doi):\s*\S+(?:\s*\[[^\]]*\])?$/i.test(t)) return false;
  const found = findIdentifiers(t);
  return Boolean(found.doi || found.arxiv || found.url);
}

/** A DOI as an address that opens it. */
export const doiUrl = (doi: string): string => `https://doi.org/${encodeURI(doi.trim())}`;

/** An arXiv identifier as the address of its page. */
export const arxivUrl = (id: string): string => `https://arxiv.org/abs/${id.trim()}`;
