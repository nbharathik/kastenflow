// The footer and date, the rulers, grid and guides, and the touching up of pictures and tables. Each call is one engine operation, so each is
// one step of undo.

import type { Crop, DateSpec, Guide, TableStyle } from "@kasten-slides/wasm";

import { addedGuide, movedGuide } from "../aids/snap-aids.ts";
import type { EditorSession } from "./session.ts";

/** The footer settings a dialog hands over; what is left out stays as it is. */
export interface FooterChange {
  footer?: string;
  date?: DateSpec;
  noDate?: boolean;
  hideOnTitle?: boolean;
  slideNumbers?: boolean;
  /** The slides it is for; the whole deck when left out. */
  slides?: string[];
  hidden?: boolean;
  reset?: boolean;
}

export class PageAids {
  constructor(private readonly s: EditorSession) {}

  // ---- footer, date and number

  setHeaderFooter(change: FooterChange): void {
    this.s.run(() => this.s.core.apply("set_header_footer", change));
  }

  // ---- rulers, grid and guides

  setRulers(on: boolean): void {
    this.s.run(() => this.s.core.apply("set_guides", { rulers: on }));
  }

  /** Shows or hides the grid; showing it with no size chosen takes a size of half an inch. */
  setShowGrid(on: boolean): void {
    const size = this.s.deck.present.guides?.grid;
    this.s.run(() => this.s.core.apply("set_guides", { showGrid: on, ...(on && !size ? { grid: 48 } : {}) }));
  }

  /** The distance between grid lines in slide units; 0 takes the grid away. */
  setGrid(size: number): void {
    this.s.run(() => this.s.core.apply("set_guides", { grid: size }));
  }

  setGuides(lines: Guide[]): void {
    this.s.run(() => this.s.core.apply("set_guides", { lines }));
  }

  private get lines(): readonly Guide[] {
    return this.s.deck.present.guides?.lines ?? [];
  }

  addGuide(axis: Guide["axis"], at: number): void {
    this.setGuides(addedGuide(this.lines, axis, at));
  }

  /** Moves a guide, or takes it away when `at` is null. */
  moveGuide(index: number, at: number | null): void {
    if (index >= 0 && index < this.lines.length) this.setGuides(movedGuide(this.lines, index, at));
  }

  clearGuides(): void {
    if (this.lines.length > 0) this.setGuides([]);
  }

  // ---- pictures and tables

  replacePicture(slideId: string, id: string, src: string): void {
    this.s.run(() => this.s.core.apply("replace_picture", { slide: slideId, id, src }));
  }

  /** Sets a picture's crop and its box together, so one undo takes back the whole crop. */
  setCrop(slideId: string, id: string, box: { x: number; y: number; w: number; h: number }, crop: Crop | null): void {
    this.s.run(() => {
      this.s.core.apply("patch_elements", { slide: slideId, patches: [{ id, patch: { crop } }] });
      this.s.core.applyIntoLast("transform_elements", { slide: slideId, items: [{ id, ...box }] });
    });
  }

  setTableStyle(slideId: string, id: string, change: Partial<Pick<TableStyle, "bandedRows" | "firstColumn" | "lastRow">> & { preset?: string; headerRow?: boolean }): void {
    this.s.run(() => this.s.core.apply("set_table_style", { slide: slideId, id, ...change }));
  }

  /** Draws, or with no stroke gives back to the table's style, the lines of a block of cells. */
  setCellBorders(slideId: string, id: string, from: { row: number; col: number }, to: { row: number; col: number }, sides: readonly string[], stroke?: { color: string; width: number }): void {
    this.s.run(() => this.s.core.apply("set_cell_borders", { slide: slideId, id, from, to, sides: [...sides], ...(stroke ? { stroke } : {}) } as never));
  }

  distributeTable(slideId: string, id: string, lines: "rows" | "columns"): void {
    this.s.run(() => this.s.core.apply("distribute_table", { slide: slideId, id, lines }));
  }

  resizeColumn(slideId: string, id: string, index: number, width: number): void {
    this.s.run(() => this.s.core.apply("resize_table_column", { slide: slideId, id, index, width }));
  }
}
