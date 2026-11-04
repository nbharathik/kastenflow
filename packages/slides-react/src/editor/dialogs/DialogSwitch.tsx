import { type JSX, Suspense, lazy, useCallback } from "react";

import { BrandDialog } from "../brand/BrandDialog.tsx";
import { IconsDialog } from "../icons-picker/IconsDialog.tsx";
import { ApplyTemplateDialog } from "../layouts/ApplyTemplateDialog.tsx";
import { LayoutManager } from "../layouts/LayoutManager.tsx";
import { SaveLayoutDialog } from "../layouts/SaveLayoutDialog.tsx";
import { SaveTemplateDialog } from "../layouts/SaveTemplateDialog.tsx";
import type { EditorSession } from "../session/session.ts";
import type { DialogName, EditorUi } from "../ui-state.ts";
import { BackgroundDialog } from "./BackgroundDialog.tsx";
import { CitationDialog } from "./CitationDialog.tsx";
import { CustomShowsDialog } from "./CustomShowsDialog.tsx";
import { EmbedDialog } from "./EmbedDialog.tsx";
import { EmojiDialog } from "./EmojiDialog.tsx";
import { FindDialog } from "./FindDialog.tsx";
import { LayoutsDialog } from "./LayoutsDialog.tsx";
import { LinkDialog } from "./LinkDialog.tsx";
import { ExportDialog } from "./ExportDialog.tsx";
import { ImportDialog } from "./ImportDialog.tsx";
import { ImportLayoutsDialog } from "./ImportLayoutsDialog.tsx";
import { InsertDialog } from "./InsertDialog.tsx";
import { MarkdownImportDialog } from "./MarkdownImportDialog.tsx";
import { GuidesDialog } from "./GuidesDialog.tsx";
import { HeaderFooterDialog } from "./HeaderFooterDialog.tsx";
import { MasterDialog } from "./MasterDialog.tsx";
import { AboutDialog } from "./Notices.tsx";
import { PageDialog } from "./PageDialog.tsx";
import { PageSetupDialog } from "./PageSetupDialog.tsx";
import { PresentingDialog } from "./PresentingDialog.tsx";
import { PngDialog } from "./PngDialog.tsx";
import { RehearsalsDialog } from "./RehearsalsDialog.tsx";
import { ShortcutsDialog } from "./ShortcutsDialog.tsx";
import { TableDialog } from "./TableDialog.tsx";
import { ThemeDialog } from "./ThemeDialog.tsx";
import { VideoDialog } from "./VideoDialog.tsx";
import { CodePictureDialog } from "../code-picture/CodePictureDialog.tsx";
import { DeckHistoryDialog } from "../history/DeckHistoryDialog.tsx";
import { FontsDialog } from "../fonts/FontsDialog.tsx";
import { AudioDialog } from "../media/AudioDialog.tsx";
import { MermaidDialog } from "../media/MermaidDialog.tsx";
import { SpellingDialog } from "../spelling/SpellingDialog.tsx";
import { LintDialog } from "../lint/LintDialog.tsx";
import { PreflightDialog } from "../preflight/PreflightDialog.tsx";
import { ReviewSourcesDialog } from "../sources/ReviewSourcesDialog.tsx";

/** The layout designer is a whole editor of its own and is opened rarely: it is loaded when first asked for (it also holds these dialogs again). */
const LayoutDesigner = lazy(() => import("../layouts/LayoutDesigner.tsx").then((module) => ({ default: module.LayoutDesigner })));

export interface DialogSwitchProps {
  session: EditorSession;
  ui: EditorUi;
  dialog: DialogName | null;
}

/** The dialog that is open, if any: find and replace, layouts, theme, background, shortcuts. All of them are in this one file of the bundle, loaded when the first is opened. */
export function DialogSwitch({ session, ui, dialog }: DialogSwitchProps): JSX.Element | null {
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
    case "emoji":
      return <EmojiDialog {...props} />;
    case "embed":
      return <EmbedDialog {...props} />;
    case "video":
      return <VideoDialog {...props} />;
    case "audio":
      return <AudioDialog {...props} />;
    case "mermaid":
      return <MermaidDialog {...props} />;
    case "fonts":
      return <FontsDialog {...props} />;
    case "spelling":
      return <SpellingDialog {...props} />;
    case "export":
      return <ExportDialog {...props} />;
    case "png":
      return <PngDialog {...props} />;
    case "import":
      return <ImportDialog {...props} />;
    case "import-markdown":
      return <MarkdownImportDialog {...props} />;
    case "master":
      return <MasterDialog {...props} />;
    case "code-picture":
      return <CodePictureDialog {...props} />;
    case "deck-history":
      return <DeckHistoryDialog {...props} />;
    case "header-footer":
      return <HeaderFooterDialog {...props} />;
    case "guides":
      return <GuidesDialog {...props} />;
    case "presenting":
      return <PresentingDialog {...props} />;
    case "custom-shows":
      return <CustomShowsDialog {...props} />;
    case "lint":
      return <LintDialog {...props} />;
    case "about":
      return <AboutDialog {...props} />;
    case "layout-save":
      return <SaveLayoutDialog {...props} />;
    case "layouts-manage":
      return <LayoutManager {...props} />;
    case "import-layouts":
      return <ImportLayoutsDialog {...props} />;
    case "rehearsals":
      return <RehearsalsDialog {...props} />;
    case "preflight":
      return <PreflightDialog {...props} />;
    case "review-sources":
      return <ReviewSourcesDialog {...props} />;
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
    case "icons":
      return <IconsDialog {...props} />;
    case "brand":
      return <BrandDialog {...props} />;
    default:
      return null;
  }
}
