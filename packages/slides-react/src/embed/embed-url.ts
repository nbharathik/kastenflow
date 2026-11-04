// From a link as a person copies it to the address a frame can show. A watch page of YouTube, a share page of Loom or the editing page of a
// Google document refuse to be framed (or show a whole site around the video), so each known site is turned into the page it made for
// embedding. Anything else on the web is left as it was written. Nothing here asks the network anything: it only reads the text.

/** The sites that have an embed of their own. */
export type EmbedProvider = "youtube" | "vimeo" | "loom" | "google-slides" | "google-docs" | "google-sheets" | "figma" | "web";

export interface EmbedLink {
  /** The address the frame loads. */
  url: string;
  provider: EmbedProvider;
  /** A video is one that plays at once, in a 16:9 frame; a page is looked at and scrolled. */
  kind: "video" | "page";
}

/** What an embedded video may be told: where it starts and ends (seconds) and how it plays. */
export interface PlaybackOptions {
  start?: number | null | undefined;
  end?: number | null | undefined;
  autoplay?: boolean | null | undefined;
  muted?: boolean | null | undefined;
  looped?: boolean | null | undefined;
  controls?: boolean | null | undefined;
}

interface Match {
  link: EmbedLink;
  /** The video, for the sites that have one. */
  id?: string;
  /** The key of an unlisted Vimeo video. */
  hash?: string;
}

const YOUTUBE = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
const VIMEO = new Set(["vimeo.com", "www.vimeo.com", "player.vimeo.com"]);
const LOOM = new Set(["loom.com", "www.loom.com"]);
const FIGMA = new Set(["figma.com", "www.figma.com"]);

const VIDEO_ID = /^[\w-]{11}$/;
const LIST_ID = /^[\w-]{2,64}$/;

/** The address as a web address with no name and password in it, or null. */
function parse(text: string | null | undefined): URL | null {
  const typed = (text ?? "").trim();
  if (typed === "") return null;
  try {
    const url = new URL(typed);
    return (url.protocol === "http:" || url.protocol === "https:") && url.username === "" && url.password === "" ? url : null;
  } catch {
    return null;
  }
}

/** Seconds from `90`, `90s`, `1m30s` or `1h2m3s`; null for anything else and for nothing to skip. */
export function secondsOf(text: string | null | undefined): number | null {
  const found = /^(?:(\d{1,3})h)?(?:(\d{1,4})m)?(?:(\d{1,6})s?)?$/i.exec((text ?? "").trim());
  if (!found || (!found[1] && !found[2] && !found[3])) return null;
  const total = Number(found[1] ?? 0) * 3600 + Number(found[2] ?? 0) * 60 + Number(found[3] ?? 0);
  return total > 0 ? total : null;
}

const segmentsOf = (url: URL): string[] => url.pathname.split("/").filter((part) => part !== "");

const page = (url: string, provider: EmbedProvider = "web"): Match => ({ link: { url, provider, kind: "page" } });

function youtube(url: URL): Match | null {
  const parts = segmentsOf(url);
  let id: string | undefined;
  if (url.hostname === "youtu.be") {
    id = parts[0];
  } else if (parts[0] === "watch") {
    id = url.searchParams.get("v") ?? undefined;
  } else if (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live" || parts[0] === "v") {
    id = parts[1];
  }
  // `videoseries` is the name of the playlist embed, and is as long as a video's number.
  const video = id !== undefined && id !== "videoseries" && VIDEO_ID.test(id) ? id : undefined;
  const wanted = url.searchParams.get("list");
  const list = wanted !== null && LIST_ID.test(wanted) ? wanted : undefined;
  if (video === undefined && list === undefined) return null;
  const start = secondsOf(url.searchParams.get("t") ?? url.searchParams.get("start") ?? new URLSearchParams(url.hash.slice(1)).get("t"));
  const query = [list === undefined ? "" : `list=${list}`, start === null ? "" : `start=${start}`, "rel=0"].filter((part) => part !== "");
  const base = `https://www.youtube-nocookie.com/embed/${video ?? "videoseries"}`;
  return { link: { url: `${base}?${query.join("&")}`, provider: "youtube", kind: "video" }, ...(video === undefined ? {} : { id: video }) };
}

/** The place in a Vimeo address where the video's number is. */
function vimeoNumber(parts: string[]): number {
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (parts[i] === "video" || parts[i] === "videos") return i + 1;
  }
  return parts[0] === "channels" ? 2 : 0;
}

function vimeo(url: URL): Match | null {
  const parts = segmentsOf(url);
  let id: string | undefined;
  let hash: string | undefined;
  if (url.hostname === "player.vimeo.com") {
    if (parts[0] !== "video") return null;
    id = parts[1];
    hash = url.searchParams.get("h") ?? undefined;
  } else {
    const at = vimeoNumber(parts);
    id = parts[at];
    hash = parts[at + 1];
  }
  if (id === undefined || !/^\d+$/.test(id)) return null;
  const key = hash !== undefined && /^[0-9a-f]{8,16}$/i.test(hash) ? hash : undefined;
  const start = secondsOf(new URLSearchParams(url.hash.slice(1)).get("t"));
  const at = `https://player.vimeo.com/video/${id}${key === undefined ? "" : `?h=${key}`}${start === null ? "" : `#t=${start}s`}`;
  return { link: { url: at, provider: "vimeo", kind: "video" }, id, ...(key === undefined ? {} : { hash: key }) };
}

function loom(url: URL): Match | null {
  const parts = segmentsOf(url);
  if ((parts[0] !== "share" && parts[0] !== "embed") || parts[1] === undefined || !/^[A-Za-z0-9]{8,64}$/.test(parts[1])) return null;
  const start = secondsOf(url.searchParams.get("t"));
  return { link: { url: `https://www.loom.com/embed/${parts[1]}${start === null ? "" : `?t=${start}`}`, provider: "loom", kind: "video" }, id: parts[1] };
}

/** The shapes of a Google file's address: `/<kind>/d/<id>/…`, or `/<kind>/d/e/<key>/…` for one that is published to the web. */
function google(url: URL): Match | null {
  const parts = segmentsOf(url);
  const [kind, d, third, fourth] = parts;
  if (d !== "d" || third === undefined) return null;
  const published = third === "e";
  const id = published ? fourth : third;
  if (id === undefined || !/^[\w-]{10,}$/.test(id)) return null;
  const root = `https://docs.google.com/${kind}/d/${published ? `e/${id}` : id}`;
  if (kind === "presentation") return page(`${root}/embed`, "google-slides");
  if (kind === "document") return page(published ? `${root}/pub?embedded=true` : `${root}/preview`, "google-docs");
  if (kind === "spreadsheets") return page(published ? `${root}/pubhtml?widget=true&headers=false` : `${root}/preview`, "google-sheets");
  return null;
}

function figma(url: URL): Match | null {
  const kind = segmentsOf(url)[0];
  if (kind === "embed") return page(url.href, "figma");
  if (kind !== "file" && kind !== "design" && kind !== "proto" && kind !== "board") return null;
  return page(`https://www.figma.com/embed?embed_host=kastenflow&url=${encodeURIComponent(url.href)}`, "figma");
}

function match(text: string | null | undefined): Match | null {
  const url = parse(text);
  if (url === null) return null;
  const host = url.hostname;
  let found: Match | null = null;
  if (YOUTUBE.has(host) || host === "youtu.be") found = youtube(url);
  else if (VIMEO.has(host)) found = vimeo(url);
  else if (LOOM.has(host)) found = loom(url);
  else if (host === "docs.google.com") found = google(url);
  else if (FIGMA.has(host)) found = figma(url);
  return found ?? page((text ?? "").trim());
}

/**
 * The address to load in a frame for a link, with the site it is of and whether it is a video. Null when the text is not a web address
 * (a script, a file, mail), so nothing but the web ever goes in a frame. A link of a known site becomes that site's embed, with the start
 * time kept; converting an embed address gives the same address back.
 */
export function toEmbedUrl(text: string | null | undefined): EmbedLink | null {
  return match(text)?.link ?? null;
}

/** The address when the text is a web address and nothing else (one link, no words round it), as pasted or dropped; null otherwise. */
export function singleLinkOf(text: string | null | undefined): string | null {
  const typed = (text ?? "").trim();
  return /^https?:\/\/\S+$/i.test(typed) && parse(typed) !== null ? typed : null;
}

/** The site a link is of, to note on its embed; null for an ordinary page and for what is no web address. */
export function providerOf(text: string | null | undefined): Exclude<EmbedProvider, "web"> | null {
  const provider = toEmbedUrl(text)?.provider;
  return provider === undefined || provider === "web" ? null : provider;
}

const flag = (on: boolean | null | undefined): boolean => on === true;
const second = (n: number | null | undefined): number | null => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : null);

/** The address of a converted video with the options its element holds (start, end, autoplay, muted, looped, controls). A page is as it was. */
export function playbackUrl(link: EmbedLink, options: PlaybackOptions): string {
  const url = parse(link.url);
  if (url === null || link.kind !== "video") return link.url;
  const start = second(options.start);
  if (link.provider === "youtube") {
    const last = segmentsOf(url)[1] ?? "";
    const list = url.searchParams.get("list");
    const end = second(options.end);
    const from = start ?? secondsOf(url.searchParams.get("start"));
    const query = [
      list === null ? "" : `list=${list}`,
      from === null ? "" : `start=${from}`,
      end === null ? "" : `end=${end}`,
      flag(options.autoplay) ? "autoplay=1" : "",
      flag(options.muted) ? "mute=1" : "",
      flag(options.looped) ? "loop=1" : "",
      // A single video loops only as a playlist of itself.
      flag(options.looped) && list === null && last !== "videoseries" ? `playlist=${last}` : "",
      options.controls === false ? "controls=0" : "",
      "rel=0",
    ].filter((part) => part !== "");
    return `https://www.youtube-nocookie.com/embed/${last}?${query.join("&")}`;
  }
  if (link.provider === "vimeo") {
    const from = start ?? secondsOf(url.hash.slice(1).replace(/^t=/, ""));
    const key = url.searchParams.get("h");
    const query = [key === null ? "" : `h=${key}`, flag(options.autoplay) ? "autoplay=1" : "", flag(options.muted) ? "muted=1" : "", flag(options.looped) ? "loop=1" : "", options.controls === false ? "controls=0" : ""].filter((part) => part !== "");
    return `${url.origin}${url.pathname}${query.length ? `?${query.join("&")}` : ""}${from === null ? "" : `#t=${from}s`}`;
  }
  if (link.provider === "loom") {
    const from = start ?? secondsOf(url.searchParams.get("t"));
    const query = [from === null ? "" : `t=${from}`, flag(options.autoplay) ? "autoplay=1" : ""].filter((part) => part !== "");
    return `${url.origin}${url.pathname}${query.length ? `?${query.join("&")}` : ""}`;
  }
  return link.url;
}

/** Where the picture of a video can be had. `url` is YouTube's thumbnail of the video, or Vimeo's answer to an oEmbed question. */
export interface PosterSource {
  provider: "youtube" | "vimeo";
  /** The video's number, for naming the picture. */
  id: string;
  url: string;
}

/** Where the picture of a video link can be had; null for anything else (a playlist, another site). */
export function posterSourceOf(text: string | null | undefined): PosterSource | null {
  const found = match(text);
  if (found?.id === undefined) return null;
  if (found.link.provider === "youtube") return { provider: "youtube", id: found.id, url: `https://img.youtube.com/vi/${found.id}/hqdefault.jpg` };
  if (found.link.provider === "vimeo") {
    const watch = `https://vimeo.com/${found.id}${found.hash === undefined ? "" : `/${found.hash}`}`;
    return { provider: "vimeo", id: found.id, url: `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(watch)}` };
  }
  return null;
}
