// Kasten's page editor: Milkdown Crepe with Kasten's wiki-links, the
// escaping fix, and Notion's blocks and menus.

import { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Node } from "@milkdown/kit/prose/model";

import { annotationPaint } from "../../annotations/paint";
import { agentActionsCtx, agentMarks, type AgentActions } from "./blocks/agent-marks";
import { aiPlugin } from "./ai/ai";
import { findPlugin } from "./find/find";
import { citePlugin } from "./cite/decorate";
import { calloutSchema, remarkCallout, wrapInCalloutCommand } from "./blocks/callout";
import { calloutView } from "./blocks/callout-view";
import { imageBlock } from "./blocks/image-block";
import { mathBlockInputRule, mathBlockSchema, mathInlineInputRule, mathInlineSchema, mathKeymap } from "./blocks/math";
import { remarkKastenMath, remarkMathSyntax } from "./blocks/math-remark";
import { mathBlockView, mathEditing, mathInlineView } from "./blocks/math-view";
import { bgColorSchema, remarkColor, textColorSchema } from "./blocks/color";
import { remarkToggle, toggleSchema, wrapInToggleCommand } from "./blocks/toggle";
import { toggleView } from "./blocks/toggle-view";
import { remarkUnderline, underlineSchema } from "./blocks/underline";
import { aloneLinks } from "./blocks/alone";
import { dividerView } from "./blocks/divider-view";
import { wikiLinkView } from "./blocks/wikilink-view";
import { foldKeyCtx, smartCtx, smartPageCtx } from "./sections/key";
import { sectionsPlugin, smartDecorations } from "./sections/sections";
import { configureTextEscaping } from "./escaping";
import { fileProviderCtx, type FileProvider } from "./files";
import { linkProviderCtx, type LinkProvider } from "./links";
import { configureMarkdownStyle } from "./markdown-style";
import { codeLanguagePicker } from "./menus/code-language";
import { blockRangePlugin } from "./menus/block-range";
import { gutter } from "./menus/gutter";
import { blockHandle } from "./menus/handle";
import { notionKeymap } from "./menus/keymap";
import { embedSpots } from "./menus/embed-spot";
import { setLocationCopier } from "./menus/location-link";
import { mentionMenu } from "./menus/mention";
import { placeholder } from "./menus/placeholder";
import { fileLinks } from "./file-links";
import { pasteFiles } from "./paste-files";
import { pasteLink } from "./paste-link";
import { templatePickerCtx } from "./template-pick";
import { arrowRules, configureInputRules, quoteInputRule, todoInputRule, toggleInputRule, wikiLinkInputRule } from "./menus/shortcuts";
import { slashMenu } from "./menus/slash";
import { buildToolbar } from "./menus/toolbar";
import { menusCloseWithEditor } from "./ui/close-with-editor";
import { remarkWikiLink, wikiLinkSchema } from "./wikilink";

export interface KastenCrepeOptions {
  /** Called when the document has changed, debounced by Milkdown (200 ms).
   * Loading a note counts as a change. */
  onUpdate?: (ctx: Ctx, doc: Node) => void;
  /** The pages `[[links]]` point at; none by default. */
  links?: LinkProvider;
  /** Where pasted and dropped files are kept, and pictures are shown from;
   * without it, pictures are links only. */
  files?: FileProvider;
  /** What the badge on an agent's writing can do; nothing by default. */
  agent?: AgentActions;
  /** Opens the template gallery to fill the page, offered as "Template…"
   * in the slash menu while the page is empty; none by default. */
  onTemplate?: () => void;
  /** Which page this is, for the sections folded in it, which are kept per
   * page: its note id, or its path while it is a draft. None keeps no folds. */
  foldKey?: string;
  /** Draws the page's sections as slide-like cards (the page's `layout:
   * sections`) from the start; `setSmart` changes it later. */
  smart?: boolean;
  /** Called when "/smart page" turns the sections layout on, so the page can keep it. */
  onSmartPage?: () => void;
}

const noUploads = () => Promise.reject(new Error("This editor keeps no files; paste a link instead."));

/** Creates and mounts the editor under `root`. */
export async function createKastenCrepe(root: HTMLElement, options: KastenCrepeOptions = {}): Promise<Crepe> {
  const { files } = options;
  const crepe = new Crepe({
    root,
    defaultValue: "",
    features: {
      // Kasten's own chat replaces Crepe's AI.
      [Crepe.Feature.AI]: false,
      [Crepe.Feature.TopBar]: false,
      // Kasten's own Notion-style slash menu, block handle and placeholders.
      [Crepe.Feature.BlockEdit]: false,
      [Crepe.Feature.Placeholder]: false,
      // Kasten has its own math, which keeps `$5 and $10` plain text.
      [Crepe.Feature.Latex]: false,
    },
    featureConfigs: {
      [Crepe.Feature.Toolbar]: { buildToolbar },
      // The native caret, as in Notion. The virtual one measures the page on
      // every keystroke, which shows on long notes.
      [Crepe.Feature.Cursor]: { virtual: false },
      // Crepe's default keeps uploads as blob: URLs, which would be saved
      // into the note. Kasten keeps them in assets/ and links them relatively.
      [Crepe.Feature.ImageBlock]: {
        onUpload: (file) => (files ? files.save(file) : noUploads()),
        proxyDomURL: (src) => files?.url(src) ?? src,
        blockUploadPlaceholderText: "or paste an image link…",
        inlineUploadPlaceholderText: "or paste an image link…",
      },
    },
  });
  crepe.editor
    .config(configureTextEscaping)
    .config(configureMarkdownStyle)
    .config(configureInputRules)
    .config((ctx) => {
      if (options.links) ctx.set(linkProviderCtx.key, options.links);
      if (files) ctx.set(fileProviderCtx.key, files);
      if (options.agent) ctx.set(agentActionsCtx.key, options.agent);
      if (options.onTemplate) ctx.set(templatePickerCtx.key, options.onTemplate);
      if (options.foldKey) ctx.set(foldKeyCtx.key, options.foldKey);
      if (options.smart) ctx.set(smartCtx.key, true);
      if (options.onSmartPage) ctx.set(smartPageCtx.key, options.onSmartPage);
    })
    .use(linkProviderCtx)
    .use(fileProviderCtx)
    .use(templatePickerCtx)
    .use(foldKeyCtx)
    .use(smartCtx)
    .use(smartPageCtx)
    .use([agentActionsCtx, agentMarks])
    .use(annotationPaint)
    .use(findPlugin)
    .use(citePlugin)
    .use(aiPlugin)
    .use(imageBlock)
    .use(pasteFiles)
    .use(pasteLink)
    .use(fileLinks)
    .use([remarkWikiLink, wikiLinkSchema, wikiLinkView, aloneLinks].flat())
    .use([dividerView, sectionsPlugin, smartDecorations].flat())
    .use([remarkCallout, calloutSchema, calloutView, wrapInCalloutCommand].flat())
    .use([remarkToggle, toggleSchema, toggleView, wrapInToggleCommand].flat())
    .use([remarkColor, textColorSchema, bgColorSchema].flat())
    .use([remarkUnderline, underlineSchema].flat())
    .use([remarkMathSyntax, remarkKastenMath, mathInlineSchema, mathBlockSchema, mathInlineView, mathBlockView, mathEditing, mathKeymap].flat())
    // The slash menu sees keys before the Notion keymap, so Esc closes it first.
    .use([blockHandle, blockRangePlugin, gutter, codeLanguagePicker, slashMenu, mentionMenu, embedSpots, notionKeymap, placeholder, menusCloseWithEditor].flat())
    .use([todoInputRule, toggleInputRule, quoteInputRule, wikiLinkInputRule, mathBlockInputRule, mathInlineInputRule, ...arrowRules]);
  const { onUpdate } = options;
  if (onUpdate) crepe.on((api) => api.updated((ctx, doc) => onUpdate(ctx, doc)));
  await crepe.create();
  // The block menu's "Copy link to this location" asks the page, which knows what it is.
  setLocationCopier(crepe.editor.ctx.get(editorViewCtx), options.links?.copyLocation);
  return crepe;
}
