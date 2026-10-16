// What undo and redo are called. The engine names a step by its operation
// (`transform_elements`); a person is told "Move elements".

const NAMES: Readonly<Record<string, string>> = {
  set_title: "Rename deck",
  apply_theme: "Change theme",
  edit_theme: "Edit theme",
  set_logo: "Change logo",
  add_slide: "Add slide",
  duplicate_slides: "Duplicate slides",
  delete_slides: "Delete slides",
  move_slides: "Move slides",
  set_slide_flags: "Change slide",
  set_layout: "Change layout",
  set_notes: "Edit notes",
  set_background: "Change background",
  add_elements: "Add elements",
  patch_elements: "Change elements",
  transform_elements: "Move elements",
  delete_elements: "Delete elements",
  reorder_elements: "Change order",
  group_elements: "Group",
  ungroup_element: "Ungroup",
  duplicate_elements: "Duplicate elements",
  paste_elements: "Paste",
  align_elements: "Align",
  distribute_elements: "Distribute",
  set_text: "Edit text",
  set_rich_text: "Format text",
  set_cells: "Edit cells",
  clear_cells: "Clear cells",
  insert_rows: "Insert rows",
  delete_rows: "Delete rows",
  insert_columns: "Insert columns",
  delete_columns: "Delete columns",
  merge_cells: "Merge cells",
  unmerge_cells: "Unmerge cells",
  set_cell_fill: "Fill cells",
  replace_all: "Replace text",
  // Slides that were pasted, dragged in with Alt, or imported: they were all added.
  add_slides: "Add slides",
  replace_deck: "Import slides",
  collapse_slides: "Collapse slides",
};

/** A step of history in words: "Move elements"; undefined when there is no step. */
export function stepName(operation: string | undefined): string | undefined {
  if (!operation) return undefined;
  // Steps made of several operations are named for the first (an import is `add_slides, collapse_slides`).
  const known = NAMES[operation] ?? NAMES[operation.split(", ")[0] ?? ""];
  if (known) return known;
  // Not one of ours: a name that is already words stays as it is.
  if (/[A-Z ]/.test(operation)) return operation;
  const words = operation.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "Undo Move elements", or just "Undo" when there is nothing to name. */
export function historyLabel(verb: "Undo" | "Redo", operation: string | undefined): string {
  const name = stepName(operation);
  return name ? `${verb} ${name}` : verb;
}
