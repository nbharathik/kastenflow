// Writes the shape index agents ask for shapes by name with:
// crates/kasten-core/src/diagrams/shapes/index.tsv.
//
// It reads draw.io's own palette files (app/public/drawio/js/diagramly/sidebar/Sidebar-*.js,
// unpacked there by the diagram editor's installer, never committed) in a node `vm` with
// stubs for the sidebar's helpers, collects every vertex template, and writes one line per
// shape: key, title, width, height, style template number, the part of the style that
// varies, search words. Styles share templates, which is what keeps the file small.
//
//   node scripts/gen-diagram-shapes.mjs           write the index
//   node scripts/gen-diagram-shapes.mjs --check   fail when the written index is out of date
//   node scripts/gen-diagram-shapes.mjs --sizes   print the size of each library

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sidebar = path.join(root, 'app/public/drawio/js/diagramly/sidebar');
const output = path.join(root, 'crates/kasten-core/src/diagrams/shapes/index.tsv');

// The palette files to read, in the order their shapes are listed, and the library each is called.
const FILES = [
  ['Sidebar-AWS4.js', 'aws4'],
  ['Sidebar-AWS4b.js', 'aws4'],
  ['Sidebar-Azure2.js', 'azure2'],
  ['Sidebar-GCP2.js', 'gcp2'],
  ['Sidebar-Kubernetes.js', 'kubernetes'],
  ['Sidebar-Flowchart.js', 'flowchart'],
  ['Sidebar-ER.js', 'er'],
  ['Sidebar-UML25.js', 'uml'],
  ['Sidebar-Network.js', 'network'],
  ['Sidebar-BPMN.js', 'bpmn'],
  ['Sidebar-ArchiMate3.js', 'archimate3'],
  ['Sidebar-Cisco19.js', 'cisco'],
];

// The style constants the palettes use, by the name the editor gives them.
const CONSTANTS = {
  STYLE_SHAPE: 'shape',
  STYLE_VERTICAL_LABEL_POSITION: 'verticalLabelPosition',
  STYLE_VERTICAL_ALIGN: 'verticalAlign',
};

function constants() {
  return new Proxy(CONSTANTS, {
    get(target, name) {
      if (name in target) return target[name];
      if (typeof name !== 'string' || !name.startsWith('STYLE_')) return undefined;
      return name.slice(6).toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    },
  });
}

const noop = () => null;

/** The shapes one palette file makes, as {style, w, h, title, tags}. */
function entriesOf(file) {
  const found = [];
  const sandbox = { console: { log() {}, warn() {}, error() {} } };
  const context = vm.createContext(sandbox);
  function Sidebar() {}
  Sidebar.prototype = {};
  sandbox.Sidebar = Sidebar;
  sandbox.mxConstants = constants();
  sandbox.mxResources = { get: (key) => String(key) };
  const utils = { createXmlDocument: () => ({ createElement: () => ({ setAttribute: noop }) }), bind: (scope, fn) => fn.bind(scope) };
  sandbox.mxUtils = new Proxy(utils, { get: (target, name) => (name in target ? target[name] : noop) });
  sandbox.mxCell = function () {};
  sandbox.mxGeometry = function () {};
  sandbox.mxPoint = function () {};
  vm.runInContext(fs.readFileSync(path.join(sidebar, file), 'utf8'), context, { filename: file });

  const recorder = {
    createVertexTemplateEntry(style, w, h, value, title, showLabel, showTitle, tags) {
      found.push({ style: String(style), w: Number(w), h: Number(h), title: String(title ?? ''), tags: String(tags ?? '') });
      return null;
    },
    getTagsForStencil(_prefix, tags, extra) {
      return String(`${extra || ''} ${tags || ''}`).split(/\s+/).filter(Boolean);
    },
  };
  const self = new Proxy(recorder, {
    get(target, name) {
      if (name in target) return target[name];
      if (name === 'then' || typeof name === 'symbol') return undefined;
      // The palette functions call each other; everything else the sidebar does is not needed here.
      if (name in Sidebar.prototype) return Sidebar.prototype[name].bind(self);
      return noop;
    },
  });
  for (const name of Object.getOwnPropertyNames(Sidebar.prototype)) {
    const fn = Sidebar.prototype[name];
    // The top-level palette functions take no arguments; the ones they call take the shared styles.
    if (/^add\w+Palette$/.test(name) && typeof fn === 'function' && fn.length === 0) {
      try {
        fn.call(self);
      } catch (err) {
        console.error(`${file}: ${name}: ${err.message}`);
      }
    }
  }
  return found;
}

const slug = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/** The key, the style with its varying part cut out, and that part. */
function describe(entry, library) {
  // The connection points a shape lists for snapping are left out: they change nothing that is
  // drawn, differ for every icon, and are most of the index.
  const style = entry.style.replace(/\t|\n/g, ' ').replace(/points=\[[^;]*\];?/g, '');
  let match;
  if ((match = /(shape=mxgraph\.(\w+)\.[\w-]+;)(?:[^]*?)prIcon=([\w-]+)/.exec(style))) {
    return { key: `${match[2]}.${match[3]}`, template: style.replace(/prIcon=[\w-]+/, 'prIcon=~'), name: match[3] };
  }
  if ((match = /resIcon=mxgraph\.(\w+)\.([\w-]+)/.exec(style))) {
    return { key: `${match[1]}.${match[2]}`, template: style.replace(/(resIcon=mxgraph\.\w+\.)[\w-]+/, '$1~'), name: match[2] };
  }
  if ((match = /image=img\/lib\/(\w+)\/([^;]+)\.(svg|png)/.exec(style))) {
    const name = match[2];
    const lib = match[1] === 'azure2' ? 'azure2' : library;
    return { key: `${lib}.${slug(name)}`, template: style.replace(/(image=img\/lib\/\w+\/)[^;]+\.(svg|png)/, '$1~.$2'), name };
  }
  if ((match = /shape=mxgraph\.(\w+)\.([\w-]+)/.exec(style))) {
    return { key: `${match[1]}.${match[2]}`, template: style.replace(/(shape=mxgraph\.\w+\.)[\w-]+/, '$1~'), name: match[2] };
  }
  return { key: `${library}.${slug(entry.title)}`, template: style, name: '' };
}

function build() {
  const templates = [];
  const rows = [];
  const seen = new Set();
  const perLibrary = {};
  for (const [file, library] of FILES) {
    if (!fs.existsSync(path.join(sidebar, file))) continue;
    for (const entry of entriesOf(file)) {
      if (!entry.title || !Number.isFinite(entry.w) || !Number.isFinite(entry.h)) continue;
      const { key, template, name } = describe(entry, library);
      if (!key || key.endsWith('.') || seen.has(key)) continue;
      seen.add(key);
      let at = templates.indexOf(template);
      if (at < 0) at = templates.push(template) - 1;
      const title = entry.title.replace(/\s+/g, ' ').trim();
      // Search words that the key and title do not already hold.
      const known = `${key} ${title}`.toLowerCase();
      const words = [...new Set(entry.tags.toLowerCase().split(/\s+/))]
        .filter((w) => w.length > 2 && !known.includes(w) && !/^(mxgraph|aws|amazon|web|service)$/.test(w))
        .join(' ');
      // A varying part that is the key's own tail is left out: the loader takes it from the key.
      const own = key.slice(key.indexOf('.') + 1) === name ? '' : name;
      const line = [key, title, Math.round(entry.w), Math.round(entry.h), at + 1, own, words.slice(0, 40)].join('\t');
      rows.push(line.replace(/\t+$/, '\t'));
      const lib = key.split('.')[0];
      perLibrary[lib] = (perLibrary[lib] ?? 0) + line.length + 1;
    }
  }
  const head = [
    '# KastenFlow shape index: generated by scripts/gen-diagram-shapes.mjs from the editor\'s palettes. Do not edit.',
    '# @n<TAB>template ("~" is the part that varies); then key, title, width, height, template, varying part, search words.',
  ];
  const body = templates.map((t, i) => `@${i + 1}\t${t}`);
  return { text: [...head, ...body, ...rows].join('\n') + '\n', perLibrary, shapes: rows.length, templates: templates.length };
}

if (!fs.existsSync(sidebar)) {
  const message = 'The editor is not unpacked at app/public/drawio, so the shape index cannot be generated here.';
  if (process.argv.includes('--check')) {
    console.log(`${message} The written index is left as it is.`);
    process.exit(0);
  }
  console.error(message);
  process.exit(1);
}

const built = build();
if (process.argv.includes('--sizes')) {
  for (const [lib, bytes] of Object.entries(built.perLibrary).sort((a, b) => b[1] - a[1])) console.log(`${lib}\t${bytes}`);
  console.log(`total\t${built.text.length}\t${built.shapes} shapes\t${built.templates} templates`);
} else if (process.argv.includes('--check')) {
  const current = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '';
  if (current !== built.text) {
    const a = current.split('\n');
    const b = built.text.split('\n');
    const at = a.findIndex((line, i) => line !== b[i]);
    console.error(`The shape index is out of date (first difference at line ${at + 1}). Run: node scripts/gen-diagram-shapes.mjs`);
    process.exit(1);
  }
  console.log(`The shape index is up to date: ${built.shapes} shapes, ${built.text.length} bytes.`);
} else {
  fs.writeFileSync(output, built.text);
  console.log(`Wrote ${built.shapes} shapes (${built.templates} style templates), ${built.text.length} bytes, to ${path.relative(root, output)}`);
}
