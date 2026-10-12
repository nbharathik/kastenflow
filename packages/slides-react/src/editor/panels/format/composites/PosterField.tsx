import { useEffect, useState } from "react";

import { pickFiles, readImage } from "../../../files.ts";
import type { HostImage } from "../../../host.ts";
import type { EditorSession } from "../../../session/session.ts";
import { TextButton } from "../../../ui/Button.tsx";
import { Popover, usePopover } from "../../../ui/Popover.tsx";
import { Row } from "../controls.tsx";
import type { Mixed } from "../values.ts";
import "./composites.css";

interface PosterFieldProps {
  session: EditorSession;
  /** The path of the still in the host's store; null for none. */
  value: string | null | Mixed;
  onPick(path: string | null): void;
  /** What the row is called: Poster by default; an embedded page calls it its Snapshot. */
  label?: string;
}

/** The last part of a path, which is what a person knows a picture by. */
const nameOf = (path: string): string => path.split("/").pop() ?? path;

/** The still an embedded page or a video shows where it cannot play: what it is, a way to choose another from the host's pictures or the computer, and a way to take it away. */
export function PosterField({ session, value, onPick, label = "Poster" }: PosterFieldProps) {
  const menu = usePopover();
  const [held, setHeld] = useState<HostImage[] | null>(null);
  const { host } = session;
  const path = value === "mixed" || value === null ? null : value;
  const url = path ? host.imageUrl(path) : undefined;

  // The pictures come when the list is opened, not before.
  useEffect(() => {
    if (!menu.anchor || held !== null) return;
    let live = true;
    (host.images?.() ?? Promise.resolve([])).then(
      (list) => live && setHeld(list),
      () => live && setHeld([]),
    );
    return () => {
      live = false;
    };
  }, [menu.anchor, held, host]);

  const fromComputer = async () => {
    menu.close();
    const [file] = await pickFiles("image/*");
    if (!file) return;
    try {
      const read = await readImage(file);
      onPick(await host.addImage(read.name, read.bytes));
    } catch {
      host.notify?.("That picture could not be added.");
    }
  };

  return (
    <Row label={label} wide>
      <div className="ks-cs-poster">
        <div className="ks-cs-poster-now">
          <span className="ks-cs-thumb" aria-hidden="true">
            {url ? <img src={url} alt="" draggable={false} /> : null}
          </span>
          <span className="ks-sp-value" title={path ?? undefined}>
            {value === "mixed" ? "Mixed" : path ? nameOf(path) : "None"}
          </span>
        </div>
        <div className="ks-sp-actions">
          <TextButton onClick={(event) => menu.toggleFrom(event.currentTarget)} aria-haspopup="dialog" aria-expanded={menu.anchor !== null}>
            Choose…
          </TextButton>
          <TextButton disabled={path === null && value !== "mixed"} onClick={() => onPick(null)}>
            Remove
          </TextButton>
        </div>
      </div>
      {menu.anchor ? (
        <Popover anchor={menu.anchor} onClose={menu.close} label="Pictures">
          <div className="ks-cs-gallery-wrap">
            {held === null ? <p className="ks-sp-hint">Looking…</p> : held.length === 0 ? <p className="ks-sp-hint">No pictures have been added yet.</p> : null}
            <div className="ks-cs-gallery" role="list">
              {(held ?? []).map((picture) => (
                <button
                  key={picture.path}
                  type="button"
                  role="listitem"
                  className={`ks-btn ks-cs-pic${picture.path === path ? " is-on" : ""}`}
                  aria-label={picture.name}
                  data-tip={picture.name}
                  onClick={() => {
                    menu.close();
                    onPick(picture.path);
                  }}
                >
                  <img src={host.imageUrl(picture.path)} alt="" draggable={false} />
                </button>
              ))}
            </div>
            <TextButton onClick={fromComputer}>From the computer…</TextButton>
          </div>
        </Popover>
      ) : null}
    </Row>
  );
}
