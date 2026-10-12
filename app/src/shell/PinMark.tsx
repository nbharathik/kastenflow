import { Icon } from "../ui/Icon";

/** A quiet pin at the end of a pinned row; the row's buttons take its place on hover. */
export function PinMark() {
  return (
    <span role="img" aria-label="Pinned" title="Pinned" className="grid size-5 shrink-0 place-items-center text-muted/70 group-focus-within:hidden group-hover:hidden">
      <Icon name="pin" className="size-3.5 rotate-45" />
    </span>
  );
}
