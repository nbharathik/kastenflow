import { useEffect, useState, type ReactNode } from "react";

import { useWorkspace } from "../workspace/store";
import { onDiagramChanged } from "./store";

/** A diagram's picture as an image address, read again when the diagram is saved; null while loading and when it has none.
 * The SVG is only ever shown through an `<img>`, never put into the page. */
export function useDiagramPicture(path: string): { url: string | null; loaded: boolean } {
  const client = useWorkspace((s) => s.client);
  const [picture, setPicture] = useState<{ url: string | null; loaded: boolean }>({ url: null, loaded: false });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    return onDiagramChanged((changed) => {
      if (changed === path) setVersion((v) => v + 1);
    });
  }, [path]);

  useEffect(() => {
    if (!client) return;
    let gone = false;
    let url: string | null = null;
    void client
      .diagramPreview(path)
      .catch(() => null)
      .then((svg) => {
        if (gone) return;
        url = svg ? URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) : null;
        setPicture({ url, loaded: true });
      });
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [client, path, version]);

  return picture;
}

/** A diagram's picture, or `fallback` (the placeholder) while there is none. */
export function DiagramImage({ path, alt, className, fallback }: { path: string; alt: string; className?: string; fallback?: ReactNode }) {
  const { url, loaded } = useDiagramPicture(path);
  if (url) return <img src={url} alt={alt} className={className} draggable={false} />;
  return <>{loaded ? fallback : null}</>;
}
