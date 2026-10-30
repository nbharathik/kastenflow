// The parts of a formula that need no KaTeX: its type size and whether there is anything to draw.

import { pointsToUnits } from "../units.ts";

/** The size of a formula when the element names none, in points. */
export const MATH_POINTS = 32;

/** The type size of a formula in slide units (1/96 inch): its points, or 32. */
export const mathSize = (points: number | null | undefined): number => pointsToUnits(points != null && points > 0 && Number.isFinite(points) ? points : MATH_POINTS);

/** Whether there is a formula to draw at all. */
export const hasFormula = (latex: string): boolean => latex.trim() !== "";
