import { isDormant, type StatusOrOther } from "../../features/projects/state/status";

/** A quiet dot at the end of the row of a project that is paused (filled) or done (a ring); an active project has none. */
export function StatusDot({ status }: { status: StatusOrOther }) {
  if (!isDormant(status)) return null;
  return (
    <span
      role="img"
      aria-label={status}
      title={status}
      className={`mx-1.5 size-2 shrink-0 rounded-full group-focus-within:hidden group-hover:hidden ${status === "Done" ? "ring-[1.5px] ring-inset ring-faint" : "bg-faint"}`}
    />
  );
}
