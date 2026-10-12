import { type JSX, Suspense, lazy, useCallback } from "react";

import { ApplyTemplateDialog } from "../layouts/ApplyTemplateDialog.tsx";
import { LayoutManager } from "../layouts/LayoutManager.tsx";
import { SaveLayoutDialog } from "../layouts/SaveLayoutDialog.tsx";
import { SaveTemplateDialog } from "../layouts/SaveTemplateDialog.tsx";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { useUiState } from "../useUi.ts";
import { BackgroundDialog } from "./BackgroundDialog.tsx";
import { CitationDialog } from "./CitationDialog.tsx";
import { EmbedDialog } from "./EmbedDialog.tsx";
import { FindDialog } from "./FindDialog.tsx";
import { LayoutsDialog } from "./LayoutsDialog.tsx";
import { LinkDialog } from "./LinkDialog.tsx";
import { ExportDialog } from "./ExportDialog.tsx";
import { ImportDialog } from "./ImportDialog.tsx";
import { InsertDialog } from "./InsertDialog.tsx";
import { AboutDialog } from "./Notices.tsx";
import { PageDialog } from "./PageDialog.tsx";
import { PageSetupDialog } from "./PageSetupDialog.tsx";
import { PngDialog } from "./PngDialog.tsx";
import { ShortcutsDialog } from "./ShortcutsDialog.tsx";
import { TableDialog } from "./TableDialog.tsx";
import { ThemeDialog } from "./ThemeDialog.tsx";
import { VideoDialog } from "./VideoDialog.tsx";
import { LintDialog } from "../lint/LintDialog.tsx";

/** The layout designer is a whole editor of its own and is opened rarely: it is loaded when first asked for (it also holds these dialogs again). */
const LayoutDesigner = lazy(() => import("../layouts/LayoutDesigner.tsx").then((module) => ({ default: module.LayoutDesigner })));

/** The dialog that is open, if any: find and replace, layouts, theme, background, shortcuts. */
export function Dialogs({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element | null {
  const { dialog } = useUiState(ui);
  const onClose = useCallback(() => ui.openDialog(null), [ui]);
  const props = { session, ui, onClose };
  switch (dialog) {
    case "find":
      return <FindDialog session={session} ui={ui} />;
    case "layouts":
      return <LayoutsDialog {...props} />;
    case "theme":
      return <ThemeDialog {...props} />;
    case "background":
      return <BackgroundDialog {...props} />;
    case "shortcuts":
      return <ShortcutsDialog {...props} />;
    case "table":
      return <TableDialog {...props} />;
    case "link":
      return <LinkDialog {...props} />;
    case "page":
      return <PageSetupDialog {...props} />;
    case "insert-page":
      return <PageDialog {...props} />;
    case "insert":
      return <InsertDialog {...props} />;
    case "citation":
      return <CitationDialog {...props} />;
    case "embed":
      return <EmbedDialog {...props} />;
    case "video":
      return <VideoDialog {...props} />;
    case "export":
      return <ExportDialog {...props} />;
    case "png":
      return <PngDialog {...props} />;
    case "import":
      return <ImportDialog {...props} />;
    case "lint":
      return <LintDialog {...props} />;
    case "about":
      return <AboutDialog {...props} />;
    case "layout-save":
      return <SaveLayoutDialog {...props} />;
    case "layouts-manage":
      return <LayoutManager {...props} />;
    case "layout-design":
      return (
        <Suspense fallback={null}>
          <LayoutDesigner {...props} />
        </Suspense>
      );
    case "template-save":
      return <SaveTemplateDialog {...props} />;
    case "template-apply":
      return <ApplyTemplateDialog {...props} />;
    default:
      return null;
  }
}
