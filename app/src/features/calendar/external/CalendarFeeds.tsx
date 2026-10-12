// Settings → Subscribed calendars: read-only calendar feeds (an `.ics`
// address, such as Google's "secret address in iCal format"). The address is
// kept in the system keychain by the desktop app and never comes back to the
// window; each calendar can be shown or hidden, refreshed or removed.

import { useState, type ReactNode } from "react";

import { Button } from "../../../ui/Button";
import { useWorkspace } from "../../workspace/store";
import { Block, Group, Row } from "../../workspace/views/settings/parts";
import { swatch } from "../../panel/properties/schemas";
import { canSubscribe } from "./api";
import { freshness } from "./external";
import { useCalendars, useFeeds } from "./store";
import type { CalendarInfo } from "./types";

const BUTTON = "ui-btn";
const PRIMARY = "ui-btn is-primary";
const INPUT = "ui-field";
const COLORS = ["blue", "teal", "green", "yellow", "orange", "red", "pink", "purple", "brown", "gray"] as const;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const toast = (text: string) => useWorkspace.getState().toast(text);

export function CalendarFeeds() {
  const calendars = useCalendars();
  const [subscribing, setSubscribing] = useState(false);
  if (!canSubscribe()) {
    return (
      <Group title="Subscribed calendars" sub>
        <Row id="calendar.subscribe" label="Calendars from Google or Outlook" help="They can show here, read-only, in the desktop app. The browser preview cannot keep their addresses safely." detail="It needs the desktop app" />
      </Group>
    );
  }
  return (
    <Group title="Subscribed calendars" sub help="Their events show in the Calendar and on Home, read-only. Nothing is written to your notes and nothing is sent back to the calendar.">
      <Block id="calendar.feeds">{calendars?.map((calendar) => <Feed key={calendar.id} calendar={calendar} />)}</Block>
      {subscribing ? (
        <Subscribe onDone={() => setSubscribing(false)} />
      ) : (
        <Row id="calendar.subscribe" label={calendars?.length ? "Subscribe to another calendar" : "Subscribe to a calendar"}>
          <Button size="sm" tone="primary" icon="plus" onClick={() => setSubscribing(true)}>
            Subscribe…
          </Button>
        </Row>
      )}
    </Group>
  );
}

/** A checkbox drawn as the Settings' switch, with no row around it. */
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) {
  return (
    <label className="relative inline-flex cursor-pointer items-center">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span className="h-5 w-9 rounded-full bg-line-strong transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40" />
      <span className="absolute left-0.5 top-0.5 size-4 rounded-full bg-knob shadow transition-transform peer-checked:translate-x-4 peer-checked:bg-on-accent" />
    </label>
  );
}

function Feed({ calendar }: { calendar: CalendarInfo }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const fail = (err: unknown) => toast(message(err));
  const refresh = async () => {
    setBusy(true);
    await useFeeds.getState().refresh(null, calendar.id);
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true);
    try {
      await useFeeds.getState().remove(calendar.id);
      toast(`Removed ${calendar.name}`);
    } catch (err) {
      fail(err);
    }
  };
  return (
    <div className="kasten-feed" role="group" aria-label={calendar.name}>
      <div className="kasten-feed-line">
        <span className="kasten-feed-dot" style={{ background: swatch(calendar.color)?.fg ?? "var(--color-accent)" }} aria-hidden="true" />
        <div className="kasten-feed-name">
          <div className="text-14 font-medium">{calendar.name}</div>
          <div className="kasten-feed-where">
            {calendar.masked} · {freshness(calendar)}
          </div>
        </div>
        <Toggle label={`Show ${calendar.name}`} checked={calendar.shown} onChange={(shown) => void useFeeds.getState().edit(calendar.id, { shown }).catch(fail)} />
        <button type="button" className={BUTTON} disabled={busy} aria-label={`Refresh ${calendar.name}`} onClick={() => void refresh()}>
          Refresh
        </button>
        {confirming ? (
          <>
            <button type="button" className={BUTTON} disabled={busy} aria-label={`Confirm removing ${calendar.name}`} onClick={() => void remove()}>
              Remove for good
            </button>
            <button type="button" className={BUTTON} onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" className={BUTTON} disabled={busy} aria-label={`Remove ${calendar.name}`} onClick={() => setConfirming(true)}>
            Remove
          </button>
        )}
      </div>
      {confirming && <div className="kasten-feed-where">Removing forgets the address on this computer and its saved copy. Your notes are not touched; to subscribe again you paste the address again.</div>}
      {calendar.error && (
        <div className="kasten-feed-error" role="status">
          {calendar.error}
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className="text-13 font-medium text-muted">{label}</span>
        {children}
      </label>
      {hint && <div className="text-12 text-muted">{hint}</div>}
    </div>
  );
}

/** The form: where to find an address for Google, Outlook and the rest, then
 * the address, a name and a colour. Nothing is kept until the address has
 * been fetched and read. */
function Subscribe({ onDone }: { onDone(): void }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("blue");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const made = await useFeeds.getState().add(name.trim(), url.trim(), color);
      toast(`Subscribed to ${made.name}`);
      onDone();
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };

  return (
    <form
      className="kasten-feed"
      aria-label="Subscribe to a calendar"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Field
        label="Calendar address"
        hint={
          <>
            Private calendar addresses are secrets: anyone who has one can read the calendar. KastenFlow keeps it in your system keychain. <code className="font-mono">webcal://</code> addresses work too.
          </>
        }
      >
        <input className={INPUT} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" autoComplete="off" autoCorrect="off" spellCheck={false} autoFocus aria-label="Calendar address" />
      </Field>
      <Field label="Name" hint="Optional: the calendar’s own name is used when you leave it empty.">
        <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="Work" maxLength={80} aria-label="Calendar name" />
      </Field>
      <div className="flex flex-col gap-1">
        <span className="text-13 font-medium text-muted" id="feed-colour">
          Colour
        </span>
        <div className="kasten-feed-colors" role="radiogroup" aria-labelledby="feed-colour">
          {COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} title={c} className="kasten-feed-swatch" style={{ background: swatch(c)?.fg }} onClick={() => setColor(c)} />
          ))}
        </div>
      </div>
      <details className="text-12 text-muted">
        <summary className="cursor-pointer">Where to find the address</summary>
        <ul className="mt-1 list-disc pl-5">
          <li>Google Calendar: Settings, pick the calendar, Integrate calendar, “Secret address in iCal format”.</li>
          <li>Outlook: Settings, Calendar, Shared calendars, Publish a calendar, then copy the ICS link.</li>
          <li>Fastmail, iCloud and others: the calendar’s sharing options give a link that ends in .ics (or starts with webcal://).</li>
          <li>A calendar on your own domain or network: its .ics address as it is.</li>
        </ul>
      </details>
      {error && (
        <div className="kasten-feed-error" role="alert">
          {error}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button type="button" className={BUTTON} onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className={PRIMARY} disabled={busy || !url.trim()}>
          {busy ? "Checking the calendar…" : "Subscribe"}
        </button>
      </div>
    </form>
  );
}
