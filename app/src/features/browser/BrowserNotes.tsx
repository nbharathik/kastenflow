// What the browser tab's stage shows when it shows no page: a note saying why
// (the browser is off, the desktop app is needed, a page could not be shown),
// and the start page of favourite sites.

import type { ReactNode } from "react";

export function Note({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="kasten-browser-note">
      <strong>{heading}</strong>
      <span>{children}</span>
    </div>
  );
}

export function StartPage({ favourites, onGo }: { favourites: readonly { title: string; url: string }[]; onGo(url: string): void }) {
  return (
    <div className="kasten-browser-start">
      <h2 className="text-20 font-semibold">Browser</h2>
      <p className="text-14 text-muted">Type an address or something to search for above. What you capture from a page goes to your Inbox, a project or a page, after you have seen it.</p>
      {favourites.length > 0 ? (
        <ul className="kasten-browser-favourites" aria-label="Favourite sites">
          {favourites.map((fav) => (
            <li key={fav.url} className="contents">
              <button type="button" className="kasten-browser-favourite" title={fav.url} onClick={() => onGo(fav.url)}>
                {fav.title}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-13 text-muted">Favourite sites you add in Settings, under Browser, show here.</p>
      )}
    </div>
  );
}
