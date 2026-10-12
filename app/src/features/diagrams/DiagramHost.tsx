import "./diagrams.css";

import { useEffect, useRef, useState } from "react";

import { Modal } from "../../ui/Modal";
import { flushOpenPage } from "../workspace/page/open-page";
import { useWorkspace } from "../workspace/store";
import { DiagramEditor } from "./DiagramEditor";
import { DiagramPicker } from "./DiagramPicker";
import { DrawioFrame } from "./DrawioFrame";
import { useDiagramHost, type PngJob } from "./host-store";
import { diagramChanged } from "./store";

/** The most diagrams drawn again at once. */
const AT_ONCE = 2;
/** How long a diagram gets to be drawn again before it is given up on. */
const GIVE_UP_MS = 30_000;
/** How long a PNG is waited for: someone is waiting for it. */
const PNG_GIVE_UP_MS = 30_000;

/** The window's diagram host: the editor in a modal over the current view, and the hidden frames that draw pictures again.
 * Loaded only once there is something for it to do. */
export default function DiagramHost() {
  const modal = useDiagramHost((s) => s.modal);
  const picking = useDiagramHost((s) => s.picker !== null);
  const queue = useDiagramHost((s) => s.queue);
  const pngs = useDiagramHost((s) => s.pngs);
  return (
    <>
      {queue.slice(0, AT_ONCE).map((path) => (
        <Redraw key={path} path={path} />
      ))}
      {pngs.slice(0, AT_ONCE).map((job) => (
        <PngOf key={job.id} job={job} />
      ))}
      {modal && <EditInModal path={modal} />}
      {picking && <DiagramPicker />}
    </>
  );
}

function EditInModal({ path }: { path: string }) {
  const close = async () => {
    // What the editor holds is written first, the picture too.
    await flushOpenPage();
    useDiagramHost.getState().closeModal();
  };
  return (
    <Modal label="Edit diagram" plain onClose={() => void close()}>
      <div className="kasten-diagram-modal">
        <DiagramEditor
          path={path}
          ui="min"
          onClose={() => void close()}
          onOpenInTab={(shown) => {
            void flushOpenPage().then(() => {
              useDiagramHost.getState().closeModal();
              useWorkspace.getState().openPath(shown, "tab");
            });
          }}
        />
      </div>
    </Modal>
  );
}

/** One diagram drawn as a PNG off screen: read, loaded in a hidden frame, exported, the bytes handed to whoever asked. Nothing is saved. */
function PngOf({ job }: { job: PngJob }) {
  const client = useWorkspace((s) => s.client);
  const [file, setFile] = useState<{ path: string; xml: string; hash: string } | null>(null);
  const settled = useRef(false);

  useEffect(() => {
    const finish = (bytes: Uint8Array | null, why: string) => {
      if (settled.current) return;
      settled.current = true;
      if (bytes) job.resolve(bytes);
      else job.reject(new Error(why));
      useDiagramHost.getState().donePng(job.id);
    };
    if (!client) {
      finish(null, "No vault is open");
      return;
    }
    let gone = false;
    client.diagram(job.path).then(
      (read) => {
        if (!gone) setFile({ path: read.path, xml: read.xml, hash: read.hash });
      },
      (err: unknown) => finish(null, err instanceof Error ? err.message : String(err)),
    );
    const giveUp = setTimeout(() => finish(null, "The diagram editor did not draw the picture in time"), PNG_GIVE_UP_MS);
    return () => {
      gone = true;
      clearTimeout(giveUp);
    };
  }, [client, job]);

  if (!file) return null;
  return (
    <DrawioFrame
      file={file}
      mode="png"
      scale={job.scale}
      hidden
      title={`Drawing ${job.path} as a picture`}
      onPng={(bytes) => {
        if (settled.current) return;
        settled.current = true;
        if (bytes) job.resolve(bytes);
        else job.reject(new Error("The diagram editor did not draw the picture"));
        useDiagramHost.getState().donePng(job.id);
      }}
    />
  );
}

/** One diagram drawn again off screen: read, loaded in a hidden frame, exported, its picture kept for the source it was drawn from. */
function Redraw({ path }: { path: string }) {
  const client = useWorkspace((s) => s.client);
  const [file, setFile] = useState<{ path: string; xml: string; hash: string } | null>(null);

  useEffect(() => {
    if (!client) return;
    let gone = false;
    client.diagram(path).then(
      (read) => {
        if (gone) return;
        if (read.preview === "fresh") useDiagramHost.getState().done(path);
        else setFile({ path: read.path, xml: read.xml, hash: read.hash });
      },
      () => {
        if (!gone) useDiagramHost.getState().done(path);
      },
    );
    const giveUp = setTimeout(() => useDiagramHost.getState().done(path), GIVE_UP_MS);
    return () => {
      gone = true;
      clearTimeout(giveUp);
    };
  }, [client, path]);

  if (!file) return null;
  return (
    <DrawioFrame
      file={file}
      mode="render"
      hidden
      title={`Drawing ${path} again`}
      onDone={(ok) => {
        if (ok) diagramChanged(path);
        useDiagramHost.getState().done(path);
      }}
    />
  );
}
