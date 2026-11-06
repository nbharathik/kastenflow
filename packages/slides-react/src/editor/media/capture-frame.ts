// A still from a video, for its poster: the video is opened out of sight, moved to the moment asked for, and that frame is copied onto a
// canvas and read back as a PNG. A video from another site that does not allow its pictures to be read gives nothing (the browser forbids it).

/** The longest side of a captured picture, in pixels. */
export const MOST_SIDE = 1920;

/** A picture of `w` x `h` made to fit in a square of `limit`, keeping its shape. */
export function fitSide(w: number, h: number, limit = MOST_SIDE): { w: number; h: number } {
  if (!(w > 0 && h > 0)) return { w: 0, h: 0 };
  const scale = Math.min(1, limit / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** A moment of a video kept inside it. */
export const withinVideo = (time: number, duration: number): number => (Number.isFinite(time) ? Math.min(Math.max(time, 0), Number.isFinite(duration) && duration > 0 ? duration : Math.max(time, 0)) : 0);

/** The name a poster is kept under: the video's file name and the moment. */
export function frameName(src: string, time: number): string {
  const file = src.split(/[?#]/)[0]?.split(/[/\\]/).pop() ?? "video";
  const base = file.replace(/\.[A-Za-z0-9]+$/, "").replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "") || "video";
  const seconds = String(Math.round(withinVideo(time, Number.POSITIVE_INFINITY) * 10) / 10).replace(".", "-");
  return `${base}-poster-${seconds}s.png`;
}

function once(target: HTMLVideoElement, event: string, patience = 15_000): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      window.clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener("error", onError);
      resolve(ok);
    };
    const onEvent = () => done(true);
    const onError = () => done(false);
    const timer = window.setTimeout(() => done(false), patience);
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

/** The frame at `time` seconds of the video at `address` as PNG bytes; null when it cannot be had. */
export async function captureFrame(address: string, time: number): Promise<Uint8Array | null> {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.src = address;
  try {
    if (!(await once(video, "loadedmetadata"))) return null;
    video.currentTime = withinVideo(time, video.duration);
    if (!(await once(video, "seeked"))) return null;
    const size = fitSide(video.videoWidth, video.videoHeight);
    if (size.w === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = size.w;
    canvas.height = size.h;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, 0, 0, size.w, size.h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
