// Settings → About: the version, updates, and the open-source licences
// the app ships (scripts/notices.mjs writes them for builds that are
// released).

import { useEffect, useState } from "react";

import { appInfo } from "../../../../lib/api";
import { startupDetail, startupLine, startupMarks } from "../../../../lib/startup-timing";
import { Button } from "../../../../ui/Button";
import { Group, Row } from "./parts";
import { Updates } from "./Updates";

/** Beside the app, wherever it is served from: the demo lives in a folder. */
const noticesUrl = () => `${import.meta.env.BASE_URL}third-party-notices.txt`;

export function About() {
  const [version, setVersion] = useState<string | null>(null);
  const [core, setCore] = useState<string | null>(null);
  const [notices, setNotices] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Marks set while the window started: they do not change, so read once.
  const [marks] = useState(startupMarks);
  const startup = startupLine(marks);

  useEffect(() => {
    appInfo().then(
      (info) => {
        setVersion(info?.appVersion ?? null);
        setCore(info?.coreVersion ?? null);
      },
      () => {},
    );
  }, []);

  const show = async () => {
    setOpen(true);
    if (notices !== null) return;
    try {
      const response = await fetch(noticesUrl());
      const text = response.ok ? await response.text() : "";
      // Lists written before the KastenFlow name start with "Kasten is".
      setNotices(/^Kasten(Flow)? is MIT-licensed/.test(text) ? text : "");
    } catch {
      setNotices("");
    }
  };

  return (
    <Group title="About">
      <Row id="about.version">
        <span className="text-13 text-muted">
          {version ? `Version ${version}${core ? ` · core ${core}` : ""} · MIT licence` : "MIT licence"}
          {startup && (
            <span title={startupDetail(marks)}>
              {" · "}
              {startup}
            </span>
          )}
        </span>
      </Row>
      <Updates />
      <Row id="about.licences">
        <Button size="sm" onClick={() => (open ? setOpen(false) : void show())}>
          {open ? "Hide" : "Show"}
        </Button>
      </Row>
      {open && (
        <div className="kasten-set-extra">
          {notices === null ? (
            <p className="text-13 text-muted">Loading…</p>
          ) : notices === "" ? (
            <p className="text-13 text-muted">This build has no licence list. Release builds carry one; `node scripts/notices.mjs` writes it.</p>
          ) : (
            <pre aria-label="Open-source licences" className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg bg-panel p-3 font-mono text-12 leading-relaxed ring-1 ring-line">
              {notices}
            </pre>
          )}
        </div>
      )}
    </Group>
  );
}
