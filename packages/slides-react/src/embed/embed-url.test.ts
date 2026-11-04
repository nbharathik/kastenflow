import { describe, expect, it } from "vitest";

import { playbackUrl, posterSourceOf, providerOf, singleLinkOf, toEmbedUrl } from "./embed-url.ts";

const ID = "dQw4w9WgXcQ";
const nocookie = (rest: string) => `https://www.youtube-nocookie.com/embed/${rest}`;

describe("a YouTube link", () => {
  it("becomes the privacy-friendly embed, whichever way it was written", () => {
    for (const link of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}&feature=share`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://youtu.be/${ID}?si=abc123`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube.com/live/${ID}`,
      `https://www.youtube-nocookie.com/embed/${ID}`,
    ]) {
      expect(toEmbedUrl(link), link).toEqual({ url: nocookie(`${ID}?rel=0`), provider: "youtube", kind: "video" });
    }
  });

  it("keeps where the video starts, from t=, start= or the hash, in seconds or hours, minutes and seconds", () => {
    const start = (n: number) => ({ url: nocookie(`${ID}?start=${n}&rel=0`), provider: "youtube", kind: "video" });
    expect(toEmbedUrl(`https://www.youtube.com/watch?v=${ID}&t=90`)).toEqual(start(90));
    expect(toEmbedUrl(`https://www.youtube.com/watch?v=${ID}&t=90s`)).toEqual(start(90));
    expect(toEmbedUrl(`https://youtu.be/${ID}?t=1m30s`)).toEqual(start(90));
    expect(toEmbedUrl(`https://youtu.be/${ID}?t=1h2m3s`)).toEqual(start(3723));
    expect(toEmbedUrl(`https://www.youtube.com/embed/${ID}?start=45`)).toEqual(start(45));
    expect(toEmbedUrl(`https://www.youtube.com/watch?v=${ID}#t=2m`)).toEqual(start(120));
    expect(toEmbedUrl(`https://youtu.be/${ID}?t=0`)).toEqual({ url: nocookie(`${ID}?rel=0`), provider: "youtube", kind: "video" });
  });

  it("ignores a start time that is not one", () => {
    for (const bad of ["abc", "-5", "1m-3s", "", "99999999999999999999"]) {
      expect(toEmbedUrl(`https://youtu.be/${ID}?t=${bad}`)?.url, bad).toBe(nocookie(`${ID}?rel=0`));
    }
  });

  it("is the playlist embed for a link with only a list", () => {
    expect(toEmbedUrl("https://www.youtube.com/playlist?list=PLabc_DEF-123")).toEqual({
      url: nocookie("videoseries?list=PLabc_DEF-123&rel=0"),
      provider: "youtube",
      kind: "video",
    });
  });

  it("keeps the list of a video that is watched from one", () => {
    expect(toEmbedUrl(`https://www.youtube.com/watch?v=${ID}&list=PLabc123&t=5`)?.url).toBe(nocookie(`${ID}?list=PLabc123&start=5&rel=0`));
  });

  it("is left as an ordinary page when the video cannot be named", () => {
    for (const odd of ["https://www.youtube.com/", "https://www.youtube.com/watch?v=short", "https://www.youtube.com/@someone", "https://youtu.be/"]) {
      expect(toEmbedUrl(odd), odd).toEqual({ url: odd, provider: "web", kind: "page" });
    }
  });

  it("is not fooled by a host that only looks like YouTube", () => {
    for (const fake of [`https://youtube.com.evil.example/watch?v=${ID}`, `https://evilyoutube.com/watch?v=${ID}`, `https://example.com/watch?v=${ID}`, `https://youtu.be.example.org/${ID}`]) {
      expect(toEmbedUrl(fake)?.provider, fake).toBe("web");
    }
  });

  it("is the same when it is converted again", () => {
    const once = toEmbedUrl(`https://youtu.be/${ID}?t=1m30s`);
    expect(once && toEmbedUrl(once.url)).toEqual(once);
  });
});

describe("a Vimeo link", () => {
  const player = (rest: string) => ({ url: `https://player.vimeo.com/video/${rest}`, provider: "vimeo", kind: "video" });
  it("becomes the player", () => {
    expect(toEmbedUrl("https://vimeo.com/76979871")).toEqual(player("76979871"));
    expect(toEmbedUrl("https://www.vimeo.com/76979871?share=copy")).toEqual(player("76979871"));
    expect(toEmbedUrl("https://vimeo.com/channels/staffpicks/76979871")).toEqual(player("76979871"));
    expect(toEmbedUrl("https://player.vimeo.com/video/76979871")).toEqual(player("76979871"));
    expect(toEmbedUrl("https://player.vimeo.com/video/76979871?h=a1b2c3d4e5&badge=0")).toEqual(player("76979871?h=a1b2c3d4e5"));
  });
  it("keeps the key of an unlisted video and where it starts", () => {
    expect(toEmbedUrl("https://vimeo.com/76979871/a1b2c3d4e5")).toEqual(player("76979871?h=a1b2c3d4e5"));
    expect(toEmbedUrl("https://vimeo.com/76979871#t=1m30s")).toEqual({ url: "https://player.vimeo.com/video/76979871#t=90s", provider: "vimeo", kind: "video" });
  });
  it("is an ordinary page when there is no video number", () => {
    expect(toEmbedUrl("https://vimeo.com/features")?.provider).toBe("web");
  });
});

describe("a Loom link", () => {
  it("becomes the embed", () => {
    expect(toEmbedUrl("https://www.loom.com/share/0123456789abcdef0123456789abcdef?sid=xyz")).toEqual({
      url: "https://www.loom.com/embed/0123456789abcdef0123456789abcdef",
      provider: "loom",
      kind: "video",
    });
    expect(toEmbedUrl("https://loom.com/embed/0123456789abcdef")?.url).toBe("https://www.loom.com/embed/0123456789abcdef");
  });
  it("keeps where it starts", () => {
    expect(toEmbedUrl("https://www.loom.com/share/abc123def?t=90")?.url).toBe("https://www.loom.com/embed/abc123def?t=90");
  });
});

describe("a Google link", () => {
  it("shows a presentation in the slide embed", () => {
    expect(toEmbedUrl("https://docs.google.com/presentation/d/1AbC-dEf_123/edit#slide=id.p")).toEqual({
      url: "https://docs.google.com/presentation/d/1AbC-dEf_123/embed",
      provider: "google-slides",
      kind: "page",
    });
    expect(toEmbedUrl("https://docs.google.com/presentation/d/e/2PACX-1vABC/pub?start=false")?.url).toBe("https://docs.google.com/presentation/d/e/2PACX-1vABC/embed");
  });
  it("shows a document and a sheet in the read-only view", () => {
    expect(toEmbedUrl("https://docs.google.com/document/d/1AbC-dEf_123/edit?usp=sharing")).toEqual({
      url: "https://docs.google.com/document/d/1AbC-dEf_123/preview",
      provider: "google-docs",
      kind: "page",
    });
    expect(toEmbedUrl("https://docs.google.com/spreadsheets/d/1AbC-dEf_123/edit#gid=0")).toEqual({
      url: "https://docs.google.com/spreadsheets/d/1AbC-dEf_123/preview",
      provider: "google-sheets",
      kind: "page",
    });
  });
  it("uses the published form of a published document or sheet", () => {
    expect(toEmbedUrl("https://docs.google.com/document/d/e/2PACX-1vABC/pub")?.url).toBe("https://docs.google.com/document/d/e/2PACX-1vABC/pub?embedded=true");
    expect(toEmbedUrl("https://docs.google.com/spreadsheets/d/e/2PACX-1vABC/pubhtml")?.url).toBe("https://docs.google.com/spreadsheets/d/e/2PACX-1vABC/pubhtml?widget=true&headers=false");
  });
  it("leaves another Google page as it is", () => {
    expect(toEmbedUrl("https://docs.google.com/forms/d/e/1FAIpQ/viewform")).toEqual({ url: "https://docs.google.com/forms/d/e/1FAIpQ/viewform", provider: "web", kind: "page" });
  });
});

describe("a Figma link", () => {
  it("goes through the Figma embed", () => {
    const link = "https://www.figma.com/design/AbC123/My-file?node-id=1-2";
    expect(toEmbedUrl(link)).toEqual({
      url: `https://www.figma.com/embed?embed_host=kastenflow&url=${encodeURIComponent(link)}`,
      provider: "figma",
      kind: "page",
    });
    expect(toEmbedUrl("https://figma.com/proto/AbC123/Flow")?.provider).toBe("figma");
  });
  it("leaves the embed alone", () => {
    const embed = "https://www.figma.com/embed?embed_host=kastenflow&url=https%3A%2F%2Fwww.figma.com%2Ffile%2FAbC";
    expect(toEmbedUrl(embed)).toEqual({ url: embed, provider: "figma", kind: "page" });
  });
});

describe("any other address", () => {
  it("is an ordinary page, as it was written", () => {
    expect(toEmbedUrl("https://example.com/docs/intro?x=1#top")).toEqual({ url: "https://example.com/docs/intro?x=1#top", provider: "web", kind: "page" });
    expect(toEmbedUrl("  http://localhost:3000  ")).toEqual({ url: "http://localhost:3000", provider: "web", kind: "page" });
  });
  it("is nothing when it is not a web address", () => {
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,hi", "mailto:a@b.c", "example.com", "", "   ", "not a url", null, undefined]) {
      expect(toEmbedUrl(bad), String(bad)).toBeNull();
    }
  });
  it("is nothing when it carries a name and password", () => {
    expect(toEmbedUrl("https://user:pass@www.youtube.com/watch?v=" + ID)).toBeNull();
  });
});

describe("a single link, as pasted or dropped", () => {
  it("is a web address and nothing else, with the spaces round it taken off", () => {
    expect(singleLinkOf("  https://example.com/a?b=1#c\n")).toBe("https://example.com/a?b=1#c");
    expect(singleLinkOf("http://localhost:3000")).toBe("http://localhost:3000");
  });
  it("is nothing for words, for two links, for other kinds of address, or for no text", () => {
    for (const not of ["see https://example.com", "https://a.example https://b.example", "https://a.example\nhttps://b.example", "example.com", "mailto:a@b.c", "javascript:alert(1)", "file:///etc/passwd", "https://user:pw@example.com/", "", "  "]) {
      expect(singleLinkOf(not), not).toBeNull();
    }
    expect(singleLinkOf(null)).toBeNull();
  });
});

describe("the site to note on an embed", () => {
  it("is the site of a link that has an embed of its own, and nothing for any other address", () => {
    expect(providerOf(`https://youtu.be/${ID}`)).toBe("youtube");
    expect(providerOf("https://vimeo.com/76979871")).toBe("vimeo");
    expect(providerOf("https://docs.google.com/presentation/d/1AbC-dEf_123/edit")).toBe("google-slides");
    expect(providerOf("https://example.com/")).toBeNull();
    expect(providerOf("not a link")).toBeNull();
    expect(providerOf(undefined)).toBeNull();
  });
});

describe("how a video plays", () => {
  const link = (text: string) => toEmbedUrl(text) as NonNullable<ReturnType<typeof toEmbedUrl>>;
  it("adds the options a YouTube video was given", () => {
    const url = playbackUrl(link(`https://youtu.be/${ID}`), { start: 10, end: 60, autoplay: true, muted: true, looped: true, controls: false });
    expect(url).toBe(nocookie(`${ID}?start=10&end=60&autoplay=1&mute=1&loop=1&playlist=${ID}&controls=0&rel=0`));
  });
  it("leaves a video with no options as it is, and lets its own start stand until another is given", () => {
    expect(playbackUrl(link(`https://youtu.be/${ID}?t=30`), {})).toBe(nocookie(`${ID}?start=30&rel=0`));
    expect(playbackUrl(link(`https://youtu.be/${ID}?t=30`), { start: 5 })).toBe(nocookie(`${ID}?start=5&rel=0`));
  });
  it("adds the options to a Vimeo video, and its start in the fragment", () => {
    expect(playbackUrl(link("https://vimeo.com/76979871"), { start: 90, autoplay: true, muted: true, looped: true, controls: false })).toBe(
      "https://player.vimeo.com/video/76979871?autoplay=1&muted=1&loop=1&controls=0#t=90s",
    );
  });
  it("adds only the start to a Loom video", () => {
    expect(playbackUrl(link("https://www.loom.com/share/abc123def"), { start: 12, autoplay: true })).toBe("https://www.loom.com/embed/abc123def?t=12&autoplay=1");
  });
  it("leaves a page as it is", () => {
    expect(playbackUrl(link("https://example.com/a"), { start: 5, autoplay: true })).toBe("https://example.com/a");
  });
});

describe("the picture a video link has", () => {
  it("is the YouTube thumbnail of the video", () => {
    expect(posterSourceOf(`https://youtu.be/${ID}`)).toEqual({ provider: "youtube", id: ID, url: `https://img.youtube.com/vi/${ID}/hqdefault.jpg` });
  });
  it("is asked of Vimeo's oEmbed for a Vimeo video, with the key of an unlisted one", () => {
    expect(posterSourceOf("https://vimeo.com/76979871")).toEqual({ provider: "vimeo", id: "76979871", url: "https://vimeo.com/api/oembed.json?url=" + encodeURIComponent("https://vimeo.com/76979871") });
    expect(posterSourceOf("https://vimeo.com/76979871/a1b2c3d4e5")?.url).toBe("https://vimeo.com/api/oembed.json?url=" + encodeURIComponent("https://vimeo.com/76979871/a1b2c3d4e5"));
  });
  it("is nothing for a playlist, any other site, or no link", () => {
    expect(posterSourceOf("https://www.youtube.com/playlist?list=PLabc")).toBeNull();
    expect(posterSourceOf("https://example.com/")).toBeNull();
    expect(posterSourceOf("")).toBeNull();
  });
});
