// Simple (Markdown) tables: the plugins to `.use`, and what the block menu and
// the editor's set-up need from the rest.

import { tableKeys } from "./keys";

export const tables = [tableKeys];

export { setTableLinks, tableMenuItems } from "./menu";
