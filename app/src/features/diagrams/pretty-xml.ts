// The editor posts a diagram as one long line. A source kept in the vault is
// read in diffs and by agents, so it is written one element to a line, as the
// core makes a new diagram. Only the white space between elements changes:
// every attribute (a label's own line breaks included) and every element is
// as the editor made it, and a diagram that is not plain mxGraph XML (one
// whose pages are compressed text, say) is kept exactly as it came.

const ROOTS = new Set(["mxfile", "mxGraphModel"]);
const INDENT = "  ";

/** `xml` with one element to a line, or `xml` as it is when that cannot be done without changing anything but spacing. */
export function prettyXml(xml: string): string {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") return xml;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "application/xml");
  } catch {
    return xml;
  }
  const root = doc.documentElement;
  if (!root || !ROOTS.has(root.nodeName) || doc.getElementsByTagName("parsererror").length > 0) return xml;
  // Text that is not just spacing (compressed pages) is not for this to reflow.
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_CDATA_SECTION);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (/\S/.test(node.nodeValue ?? "")) return xml;
  indent(doc, root, 0);
  return `${new XMLSerializer().serializeToString(root)}\n`;
}

function indent(doc: Document, element: Element, depth: number): void {
  for (const child of Array.from(element.childNodes)) if (child.nodeType === Node.TEXT_NODE) element.removeChild(child);
  const children = Array.from(element.children);
  if (children.length === 0) return;
  for (const child of children) {
    element.insertBefore(doc.createTextNode(`\n${INDENT.repeat(depth + 1)}`), child);
    indent(doc, child, depth + 1);
  }
  element.appendChild(doc.createTextNode(`\n${INDENT.repeat(depth)}`));
}
