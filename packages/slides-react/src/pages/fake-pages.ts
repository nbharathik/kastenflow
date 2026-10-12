// A host that holds a few pages, for the tests of everything that reads pages and for a demo: it gives a host the members a
// host with pages has (`pickPage`, `readPage`, `pageSections` ...), over pages kept in memory.

import { pageBody, pageSections } from "@kasten-slides/wasm";

import type { HostPage, HostPageSection, HostPageText, OpenPageWay, SlidesHost } from "../editor/host.ts";

export interface FakePages {
  /** The pages, by path; a test changes one with `edit`. */
  readonly pages: Map<string, HostPageText>;
  /** What `pickPage` answers next, by path (null for the person closing the picker). */
  choose: string | null;
  /** The pages opened, in order. */
  readonly opened: { path: string; how: OpenPageWay | undefined; section: string | null | undefined }[];
  /** How many times each page was read. */
  readonly reads: Map<string, number>;
  /** Changes a page's Markdown and tells those who watch. */
  edit(path: string, markdown: string): void;
  /** Takes a page away, as trashing it does, and tells those who watch. */
  remove(path: string): void;
}

const summary = ({ markdown: _markdown, ...page }: HostPageText): HostPage => page;

/** Gives `host` the members of a host with pages, over `pages`. */
export function withPages(host: SlidesHost, pages: readonly HostPageText[]): FakePages {
  const held = new Map(pages.map((page) => [page.path, page]));
  const watchers = new Set<(paths: string[]) => void>();
  const fake: FakePages = {
    pages: held,
    choose: pages[0]?.path ?? null,
    opened: [],
    reads: new Map(),
    edit(path, markdown) {
      const page = held.get(path);
      if (!page) return;
      held.set(path, { ...page, markdown });
      for (const watcher of [...watchers]) watcher([path]);
    },
    remove(path) {
      held.delete(path);
      for (const watcher of [...watchers]) watcher([path]);
    },
  };
  host.pickPage = async () => {
    const page = fake.choose === null ? undefined : held.get(fake.choose);
    return page ? summary(page) : null;
  };
  host.readPage = async (path) => {
    fake.reads.set(path, (fake.reads.get(path) ?? 0) + 1);
    return held.get(path);
  };
  host.listPages = async () => [...held.values()].map(summary);
  host.pageSections = async (path): Promise<HostPageSection[]> => {
    const page = held.get(path);
    if (!page) return [];
    const lines = pageBody(page.markdown).split("\n");
    return pageSections(page.markdown).map((section) => ({ heading: section.heading, title: section.title, level: section.level, markdown: lines.slice(section.line, section.end).join("\n").trimEnd() }));
  };
  host.openPage = (path, how, section) => void fake.opened.push({ path, how, section });
  host.watchPages = (onChange) => {
    watchers.add(onChange);
    return () => void watchers.delete(onChange);
  };
  return fake;
}
