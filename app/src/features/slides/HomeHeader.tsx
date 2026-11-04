import { Icon } from "../../ui/Icon";

/** The head of the Slides home: its name, the box that finds a deck, and the New deck button (Ctrl+N while the home has the keys). */
export function HomeHeader({ query, onQuery, onNew, searchable }: { query: string; onQuery(text: string): void; onNew(): void; searchable: boolean }) {
  return (
    <header className="flex flex-wrap items-end gap-3">
      <div className="min-w-[200px] flex-1">
        <h1 className="text-28 font-bold tracking-tight">
          <Icon name="present" className="mr-2.5 inline size-[26px] align-[-4px] text-muted" />
          Slides
        </h1>
        <p className="mt-1 text-14 text-muted">Decks you can present and export to PowerPoint. They are plain files in your vault, so history and agents work on them like on any note.</p>
      </div>
      {searchable && (
        <label className="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 text-muted transition focus-within:border-accent/60 focus-within:ring-[3px] focus-within:ring-accent/15 sm:w-56">
          <Icon name="search" />
          <input type="search" aria-label="Find a deck" placeholder="Find a deck" value={query} onChange={(e) => onQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent text-13 text-ink outline-none" />
        </label>
      )}
      <button type="button" onClick={onNew} title="New deck (Ctrl+N)" className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-13 font-medium text-on-accent shadow-card transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
        <Icon name="plus" className="size-4" />
        New deck
      </button>
    </header>
  );
}
