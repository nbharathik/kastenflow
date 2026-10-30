import { useEffect, useId, useState } from "react";

import type { ErrorLog } from "../../lib/vault/smart-types";
import { Button } from "../../ui/Button";
import type { SmartBackend } from "./backend";
import { countWords, newestFirst, placeWords, whenWords } from "./errors";

interface Props {
  pagePath: string;
  backend: SmartBackend;
  /** Changes when the page reported an error, so the list is read again. */
  version: number;
}

/** A small "2 errors" chip under a smart page, with the details one click away. Nothing at all while the page has none. */
export function ErrorChip({ pagePath, backend, version }: Props) {
  const [log, setLog] = useState<ErrorLog>({ records: [] });
  const [open, setOpen] = useState(false);
  const panel = useId();

  useEffect(() => {
    let current = true;
    backend.errors(pagePath).then(
      (next) => current && setLog(next),
      () => {
        // The chip is a courtesy; a log that cannot be read is no chip.
      },
    );
    return () => {
      current = false;
    };
  }, [backend, pagePath, version]);

  const count = log.records.length;
  if (count === 0) return null;

  const clear = () => {
    setLog({ records: [] });
    setOpen(false);
    backend.clearErrors(pagePath).catch(() => {});
  };

  return (
    <div
      className="kasten-smart-errors"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <Button tone="quiet" size="sm" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((was) => !was)}>
        {countWords(count)}
      </Button>
      {open && (
        <div id={panel} className="kasten-smart-error-list" role="region" aria-label="Errors in this page">
          <ul>
            {newestFirst(log.records).map((record, i) => (
              <li key={`${record.time}-${i}`}>
                <span className="kasten-smart-error-message">{record.message || "(no message)"}</span>
                <span className="kasten-smart-error-where">{[whenWords(record.time), placeWords(record)].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
          <Button tone="quiet" size="sm" onClick={clear}>
            Clear errors
          </Button>
        </div>
      )}
    </div>
  );
}
