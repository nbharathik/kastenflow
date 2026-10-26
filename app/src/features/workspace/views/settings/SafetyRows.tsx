// Settings → Backup → Safety: whether the backup is private and protected, when
// it was last read back, what was left out, how big the history is, and what
// the backup does not hold.

import { relativeTime } from "../../../../lib/dates";
import type { BackupStatus } from "../../../../lib/vault/backup-types";
import { useBackupStatus } from "../../../backup/use-backup-status";
import { useEffect } from "react";
import { Row } from "./parts";

const VISIBILITY = { private: "Private: only you can read it", public: "Public: anyone can read it", unknown: "Not checked yet" } as const;
const PROTECTION = { protected: "History is locked against being rewritten", unprotected: "History is not locked", unknown: "Not checked yet" } as const;

const size = (bytes: number | null) => (bytes === null ? "—" : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

/** The Safety facts as plain lines. A fact the engine does not have yet reads "—". */
export function safetyLines(status: BackupStatus | null, now = Date.now()): { label: string; value: string }[] {
  const left = status?.skipped.length ?? 0;
  return [
    { label: "Who can read it", value: status ? VISIBILITY[status.visibility] : "—" },
    { label: "Protection", value: status ? (status.protection.reason ?? PROTECTION[status.protection.state]) : "—" },
    { label: "Last checked", value: status?.verifiedAt ? `Read back and found whole ${relativeTime(Date.parse(status.verifiedAt), now)}` : "Not checked yet" },
    { label: "Files not backed up", value: status ? (left === 0 ? "None" : `${left} over 100 MB: ${status.skipped.map((f) => f.path).join(", ")}`) : "—" },
    { label: "History size", value: size(status?.repoSize ?? null) },
  ];
}

export function SafetyRows() {
  const status = useBackupStatus((s) => s.status);
  useEffect(() => {
    void useBackupStatus.getState().refresh();
  }, []);
  return (
    <>
      <Row id="backup.safety" stacked>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-13">
          {safetyLines(status).map((line) => (
            <div key={line.label} className="contents">
              <dt className="text-muted">{line.label}</dt>
              <dd>{line.value}</dd>
            </div>
          ))}
        </dl>
      </Row>
      <Row id="backup.notin" detail="Saved chats, attachments in chats and this app's settings are not in the backup. To keep a chat, save it as a note: notes are in the vault, so they are backed up." />
    </>
  );
}
