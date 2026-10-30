// Columns: HTML-comment markers around blocks, drawn side by side. One list
// for the editor to `.use`, remark transform first so toggles and callouts
// inside a column are already blocks when the markers are paired.

import { columnSchema, columnsSchema } from "./node";
import { columnsGuard } from "./guard";
import { columnsKeys } from "./keys";
import { remarkColumns } from "./remark";
import { columnsView } from "./view";

export const columns = [remarkColumns, columnsSchema, columnSchema, columnsView, columnsGuard, columnsKeys].flat();
