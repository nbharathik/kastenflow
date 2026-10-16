// Buttons from the kit (ui.css): text buttons in four tones and three
// sizes, and square icon buttons that name themselves for screen readers.

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { Icon, type IconName } from "./Icon";

type Tone = "secondary" | "primary" | "quiet" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone;
  size?: Size;
  icon?: IconName;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ tone = "secondary", size = "md", icon, className = "", children, type = "button", ...rest }, ref) {
  const tones = tone === "secondary" ? "" : ` is-${tone}`;
  const sizes = size === "md" ? "" : ` is-${size}`;
  return (
    <button ref={ref} type={type} className={`ui-btn${tones}${sizes} ${className}`} {...rest}>
      {icon && <Icon name={icon} className="size-4" />}
      {children}
    </button>
  );
});

/** A mark on an icon button's corner: a dot that pulses while something works, or a count of things that need a look. */
export type IconBadge = { kind: "working" } | { kind: "count"; count: number };

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  /** What the button does, for its tooltip and screen readers. */
  label: string;
  size?: "sm" | "md";
  /** Shown pressed: a panel it opens is open. */
  active?: boolean;
  iconClass?: string;
  /** A small mark in its corner; say what it means in `aria-description`. */
  badge?: IconBadge | null;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ icon, label, size = "md", active, iconClass, badge, className = "", type = "button", title, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? label}
      aria-pressed={active}
      className={`ui-icon-btn${size === "sm" ? " is-sm" : ""} ${className}`}
      {...rest}
    >
      <Icon name={icon} className={iconClass ?? (size === "sm" ? "size-[15px]" : "size-[17px]")} />
      {badge && (
        <span className="ui-icon-badge" data-kind={badge.kind} aria-hidden="true">
          {badge.kind === "count" ? (badge.count > 9 ? "9+" : badge.count) : null}
        </span>
      )}
    </button>
  );
});
