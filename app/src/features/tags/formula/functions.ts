// What a formula can use, for the function list beside the formula field:
// each function in one line with an example. The core knows the real set;
// a test compares this list with the core's through a shared fixture file.

export interface FormulaFunction {
  name: string;
  /** What it gives, in one line. */
  help: string;
  /** Typed as is when the function is picked. */
  example: string;
}

export const FORMULA_FUNCTIONS: readonly FormulaFunction[] = [
  { name: "days_until", help: "Days from today until a date; negative once it has passed.", example: "days_until(deadline)" },
  { name: "days_since", help: "Days since a date; negative while it is still ahead.", example: "days_since(created)" },
  { name: "count", help: "How many items a list property holds.", example: "count(blocks)" },
  { name: "count_backlinks", help: "How many notes link to this one.", example: "count_backlinks()" },
  { name: "sum", help: "The total of a number on each related note.", example: "sum(tasks.points)" },
  { name: "min", help: "The smallest of a number on each related note.", example: "min(tasks.points)" },
  { name: "max", help: "The largest of a number on each related note.", example: "max(tasks.points)" },
  { name: "if_empty", help: "The first value, or the second when the first is empty.", example: 'if_empty(venue, "TBD")' },
];
