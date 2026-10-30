// The header of the page preview: always in the page (the host's view is drawn under it, never over it), so what the page is, whether it
// is loading and what can be done with it are in view the whole time. Every button is named and reached with the keyboard.

import type { JSX, MouseEvent } from "react";

import type { PreviewMode, WebPreviewState } from "../editor/web-preview-host.ts";
import { Icon, type IconName } from "../editor/ui/Icon.tsx";

function IconBtn({ icon, label, onClick, disabled, pressed }: { icon: IconName; label: string; onClick(): void; disabled?: boolean | undefined; pressed?: boolean | undefined }): JSX.Element {
  return (
    <button type="button" className="ks-wp-btn" aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={16} />
    </button>
  );
}

/** The site a web address is on, for a heading when the page has no title yet. */
export function siteOf(address: string): string {
  try {
    return new URL(address).hostname.replace(/^www\./i, "") || address;
  } catch {
    return address;
  }
}

export interface WebPreviewBarProps {
  address: string;
  state: WebPreviewState | null;
  /** The host's view is open, so Back, Forward and Reload mean something. */
  ready: boolean;
  /** Waiting for the host to answer or for the page to load. */
  loading: boolean;
  mode: PreviewMode;
  onMode(mode: PreviewMode): void;
  /** Left out where the host has no tab to open it in. */
  onTab?: (() => void) | undefined;
  onBack(): void;
  onForward(): void;
  onReload(): void;
  onBrowser(): void;
  onClose(): void;
  onMenu(event: MouseEvent): void;
}

export function WebPreviewBar(props: WebPreviewBarProps): JSX.Element {
  const { address, state, ready, loading, mode, onMode } = props;
  const failed = state?.status === "failed" || state?.status === "blocked";
  const shownAddress = state?.url ?? address;
  const heading = state?.title || siteOf(shownAddress);
  const words = failed ? "Could not load" : loading ? "Loading…" : "";
  return (
    <div className="ks-wp-bar" role="toolbar" aria-label="Web page preview" onContextMenu={props.onMenu}>
      <IconBtn icon="arrow-left" label="Back" disabled={!ready} onClick={props.onBack} />
      <IconBtn icon="arrow-right" label="Forward" disabled={!ready} onClick={props.onForward} />
      <IconBtn icon="rotate-cw" label="Reload" disabled={!ready} onClick={props.onReload} />
      <span className="ks-wp-title" title={shownAddress} data-status={state?.status ?? (loading ? "loading" : undefined)}>
        <span className="ks-wp-site">{heading}</span>
        <span className="ks-wp-address">{shownAddress}</span>
      </span>
      {words ? <span className="ks-wp-state">{words}</span> : null}
      <IconBtn icon="rectangle-horizontal" label="Show over the slide" pressed={mode === "center"} onClick={() => onMode("center")} />
      <IconBtn icon="panel-right" label="Show beside the slide" pressed={mode === "side"} onClick={() => onMode("side")} />
      <IconBtn icon={mode === "full" ? "shrink" : "expand"} label={mode === "full" ? "Leave full screen" : "Full screen"} pressed={mode === "full"} onClick={() => onMode("full")} />
      {props.onTab ? <IconBtn icon="globe" label="Open in a KastenFlow tab" onClick={props.onTab} /> : null}
      <IconBtn icon="external-link" label="Open in my browser" onClick={props.onBrowser} />
      <IconBtn icon="x" label="Close (Esc)" onClick={props.onClose} />
    </div>
  );
}
