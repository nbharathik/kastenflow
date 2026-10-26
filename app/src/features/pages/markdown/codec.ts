// Shared types and parsing helpers for the lossless Markdown layer.

/** A top-level block in the source, as the editor's own tokenizer sees it. */
export interface BlockRange {
  start: number;
  end: number;
  /** A definition other blocks depend on (link reference, footnote). */
  context?: boolean;
}

/** What the lossless layer needs from an editor. `N` is its top-level node type. */
export interface MarkdownCodec<N> {
  blockRanges(markdown: string): BlockRange[];
  parse(markdown: string): N[];
  serialize(nodes: N[]): string;
  eq(a: N, b: N): boolean;
  /** Node type name, used to check structure after a reload. */
  typeOf(node: N): string;
  /** Whether the node writes no Markdown at all, like the empty paragraph an
   * editor adds to a document that would otherwise be empty. Defaults to
   * serializing it. */
  isBlank?(node: N): boolean;
  /** Offered a block the editor changed: its old source (lines ended by `\n`), the node
   * now, and the text the serializer wrote for it. Returns that text said in the old
   * source's own bytes where it can, else null to keep the serializer's. Optional. */
  refine?(source: string, node: N, written: string): string | null;
}

export interface Unit<N> {
  /** Whitespace between the previous block and this one. */
  gap: string;
  /** The block's exact source. */
  src: string;
  /** What the editor shows for it; empty for blocks it cannot display. */
  nodes: N[];
}

export interface Snapshot<N> {
  readonly units: readonly Unit<N>[];
  readonly tail: string;
  readonly eol: "\n" | "\r\n";
  /** The note's definitions (link references, footnotes), for parsing blocks. */
  readonly context: string;
}

export function isBlank<N>(codec: MarkdownCodec<N>, node: N): boolean {
  return codec.isBlank ? codec.isBlank(node) : codec.serialize([node]).trim() === "";
}

/** A block the editor cannot parse is kept verbatim and shown as nothing,
 * rather than being lost. */
function safeParse<N>(codec: MarkdownCodec<N>, src: string): N[] {
  try {
    return codec.parse(src);
  } catch {
    return [];
  }
}

/** The nodes a block shows, without filler an editor adds to an empty parse. */
export function parseVisible<N>(codec: MarkdownCodec<N>, src: string): N[] {
  return safeParse(codec, src).filter((n) => !isBlank(codec, n));
}

/** Parses a block with the note's definitions appended, so reference links and
 * footnotes resolve. If the appended text changes the block's structure (an
 * unclosed fence swallows it), the block is parsed alone instead. */
export function contextualParser<N>(codec: MarkdownCodec<N>, context: string): (src: string) => N[] {
  if (context === "") return (src) => parseVisible(codec, src);
  const contextCount = parseVisible(codec, context).length;
  return (src) => {
    const alone = parseVisible(codec, src);
    const all = parseVisible(codec, `${src}\n\n${context}`);
    const nodes = all.slice(0, all.length - contextCount);
    const sameShape = nodes.length === alone.length && nodes.every((n, i) => codec.typeOf(n) === codec.typeOf(alone[i]!));
    return sameShape ? nodes : alone;
  };
}

export function detectEol(text: string): "\n" | "\r\n" {
  const crlf = text.match(/\r\n/g)?.length ?? 0;
  const lf = (text.match(/\n/g)?.length ?? 0) - crlf;
  return crlf > lf ? "\r\n" : "\n";
}
