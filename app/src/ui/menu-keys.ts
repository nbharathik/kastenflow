// Keys inside a menu: the arrows move between its items, wrapping round,
// and Home and End go to the first and the last. Shared by every menu that
// takes focus, so they all answer the same keys.

/** The menu's items that can take focus, in order. Those of a submenu open inside it (`data-menu-sub`) are its own, not the menu's. */
export function menuItems(menu: HTMLElement | null): HTMLElement[] {
  if (!menu) return [];
  const own = menu.hasAttribute("data-menu-sub") ? menu : null;
  // Custom content (`data-menu-focus`) offers its buttons, and the one checked choice of a radio group.
  const focusable = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [data-menu-focus] button:not([role="radio"]), [data-menu-focus] [role="radio"][tabindex="0"]';
  return [...menu.querySelectorAll<HTMLElement>(focusable)].filter(
    (item) => !item.hasAttribute("disabled") && item.getAttribute("aria-disabled") !== "true" && item.closest("[data-menu-sub]") === own,
  );
}

/** Moves focus for an arrow, Home or End key; returns whether the key was one. */
export function moveInMenu(event: { key: string; defaultPrevented?: boolean; preventDefault(): void }, menu: HTMLElement | null): boolean {
  // A control inside the menu (a radio group) already used this key.
  if (event.defaultPrevented) return false;
  const items = menuItems(menu);
  if (items.length === 0) return false;
  const at = items.indexOf(document.activeElement as HTMLElement);
  let next: number;
  if (event.key === "ArrowDown") next = at < 0 ? 0 : (at + 1) % items.length;
  else if (event.key === "ArrowUp") next = at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = items.length - 1;
  else return false;
  event.preventDefault();
  items[next]!.focus();
  return true;
}
