// The shapes and lines the Insert menu offers. Each preset is a PowerPoint
// preset name, which the renderer draws and the PPTX export writes as is.

import type { Route } from "@kasten-slides/wasm";

export interface ShapeEntry {
  preset: string;
  label: string;
}

export const SHAPE_GROUPS: { title: string; shapes: ShapeEntry[] }[] = [
  {
    title: "Shapes",
    shapes: [
      { preset: "rect", label: "Rectangle" },
      { preset: "roundRect", label: "Rounded rectangle" },
      { preset: "ellipse", label: "Oval" },
      { preset: "triangle", label: "Triangle" },
      { preset: "rtTriangle", label: "Right triangle" },
      { preset: "diamond", label: "Diamond" },
      { preset: "parallelogram", label: "Parallelogram" },
      { preset: "trapezoid", label: "Trapezoid" },
      { preset: "pentagon", label: "Pentagon" },
      { preset: "hexagon", label: "Hexagon" },
      { preset: "octagon", label: "Octagon" },
      { preset: "plus", label: "Cross" },
      { preset: "can", label: "Cylinder" },
    ],
  },
  {
    title: "Stars",
    shapes: [
      { preset: "star4", label: "4-point star" },
      { preset: "star5", label: "5-point star" },
      { preset: "star6", label: "6-point star" },
      { preset: "star8", label: "8-point star" },
    ],
  },
  {
    title: "Arrows",
    shapes: [
      { preset: "rightArrow", label: "Right arrow" },
      { preset: "leftArrow", label: "Left arrow" },
      { preset: "upArrow", label: "Up arrow" },
      { preset: "downArrow", label: "Down arrow" },
      { preset: "leftRightArrow", label: "Left-right arrow" },
      { preset: "chevron", label: "Chevron" },
      { preset: "homePlate", label: "Pentagon arrow" },
    ],
  },
  {
    title: "Callouts",
    shapes: [
      { preset: "wedgeRectCallout", label: "Rectangle callout" },
      { preset: "wedgeRoundRectCallout", label: "Rounded callout" },
    ],
  },
  {
    title: "Flowchart",
    shapes: [
      { preset: "flowChartProcess", label: "Process" },
      { preset: "flowChartAlternateProcess", label: "Alternate process" },
      { preset: "flowChartDecision", label: "Decision" },
      { preset: "flowChartTerminator", label: "Terminator" },
      { preset: "flowChartConnector", label: "Connector" },
      { preset: "flowChartPreparation", label: "Preparation" },
      { preset: "flowChartInputOutput", label: "Data" },
      { preset: "flowChartManualOperation", label: "Manual operation" },
    ],
  },
];

/**
 * The groups with only the shapes a search finds: every word typed must be in a shape's name, its preset name or its group's title.
 * An empty search finds every shape; a group with none left is dropped.
 */
export function findShapes(search: string, groups: typeof SHAPE_GROUPS = SHAPE_GROUPS): typeof SHAPE_GROUPS {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return groups;
  return groups
    .map((group) => ({ title: group.title, shapes: group.shapes.filter((shape) => words.every((word) => `${shape.label} ${shape.preset} ${group.title}`.toLowerCase().includes(word))) }))
    .filter((group) => group.shapes.length > 0);
}

export interface LineEntry {
  tool: `line:${Route}` | `arrow:${Route}`;
  label: string;
}

export const LINES: LineEntry[] = [
  { tool: "line:straight", label: "Line" },
  { tool: "arrow:straight", label: "Arrow" },
  { tool: "line:elbow", label: "Elbow connector" },
  { tool: "arrow:elbow", label: "Elbow arrow connector" },
  { tool: "line:curved", label: "Curved connector" },
  { tool: "arrow:curved", label: "Curved arrow connector" },
];

/** How big a shape or text box is when it is placed by a click instead of a drag. */
export const CLICK_SIZE = { shape: { w: 160, h: 120 }, text: { w: 300, h: 56 } } as const;
