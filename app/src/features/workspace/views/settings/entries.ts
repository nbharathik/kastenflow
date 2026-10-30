// Every setting in the Settings window: its label, the explanation behind its
// ? icon and the words that find it. A row on the page names its entry by id
// (`<Row id="appearance.theme">`) and takes the label and explanation from
// here, so the page and the search cannot drift apart.

import { SHOW_OPTIONS } from "../../../calendar/show";
import { HOME_SECTIONS } from "../../../home/sections";
import type { GroupId, SettingEntry } from "./index";

type Spec = [id: string, label: string, help?: string, words?: string, extra?: Partial<SettingEntry>];

/** The entries of one group; `card` names the card of the group's page they sit in, unless a spec says another. */
function make(group: GroupId, specs: Spec[], card?: string): SettingEntry[] {
  return specs.map(([id, label, help, words, extra]) => ({ id: `${group}.${id}`, group, label, ...(card ? { card } : {}), ...(help ? { help } : {}), ...(words ? { words } : {}), ...extra }));
}

const PAGE_OWN = "For every page; a page can pick its own in its ••• menu.";

/** The rows that limit what an agent may change, by their key in the vault's settings. */
export const LIMIT_SPECS: Spec[] = [
  ["limit.max_removed_fraction", "Largest removal", "An edit removing more of a note's text waits for review.", "percent delete"],
  ["limit.max_notes_per_session_10min", "Notes changed in 10 minutes", "Past this, a session's further changes wait for review."],
  ["limit.max_trash_per_session", "Notes trashed per session", "Past this, moving notes to the trash waits for review."],
  ["limit.max_board_nodes_removed", "Cards removed from a board at once", "More than this waits for review.", "whiteboard"],
  ["limit.max_slides_removed", "Slides taken out of decks in 10 minutes", "Removing slides or emptying them; past this a change waits for review, even in a trusted session. A deck moved to the trash always waits.", "presentation"],
  ["limit.max_write_bytes", "Largest single write", "Bigger writes are refused outright.", "size kb"],
  ["limit.max_asset_bytes", "Largest picture an agent may add", "Bigger pictures and files are refused outright.", "image file size mb"],
  ["limit.max_assets_per_session_10min", "Pictures added in 10 minutes", "Past this a session's pictures are refused; a PowerPoint file comes in whole or not at all.", "images files"],
  ["limit.max_asset_bytes_per_session_10min", "Picture data added in 10 minutes", "Past this a session's pictures are refused.", "images files size mb"],
];

export const ENTRIES: SettingEntry[] = [
  ...make(
    "appearance",
    [
      ["theme", "Theme", "Light, dark, or follow your computer.", "dark light mode night colour scheme system"],
      ["accent", "Accent colour", "Buttons, selection and highlights.", "color blue violet green orange pink graphite"],
      ["zoom", "Interface size", "How large everything draws on this display. Each display keeps its own size; Auto picks one from the display's width.", "zoom scale bigger smaller magnify display ctrl percent 100%"],
    ],
    "Frequently used",
  ),
  ...make("appearance", [["motion", "Motion", "Menus, dialogs and views ease in as they open. System follows your computer's reduce-motion setting. Typing never moves.", "animation animate reduce transitions"]], "Animation"),
  ...make(
    "pages",
    [
      ["font", "Font", PAGE_OWN, "typeface serif mono sans reading"],
      ["textSize", "Text size", PAGE_OWN, "font size larger smaller bigger reading"],
      ["pageWidth", "Page width", "How wide page text runs: the usual column, a wider one, or the whole window.", "full width wide normal column margins"],
      ["spellcheck", "Check spelling", "Underline words the spell checker does not know.", "spell typos"],
      ["propsFold", "Properties on pages", "Whether a page's properties show under its title or fold into one line. A page you fold or unfold yourself keeps your choice.", "fold unfold collapse hide show tags properties"],
    ],
    "Reading",
  ),
  ...make(
    "pages",
    [
      ["newTabs", "Open pages in a new tab", "What you click opens in its own tab, so the page you are on stays open, Home included.", "click tabs"],
      ["peek", "Open pages from views in", "A page picked in the calendar, a table, a board of cards or Tasks.", "peek center side full"],
      ["links", "Open links and sub-pages in", "A plain click on a link, a sub-page or a page in the sidebar. Ctrl, Shift and Alt clicks, and what a page chooses in its ••• menu, still win.", "same tab peek stack right"],
      ["right", "Open to the right", "What a page opened to the right does to the pane there.", "split replace add tab"],
      ["keepTabs", "Keep recent tabs ready", "The last few tabs you used stay open out of sight, so coming back is instant and keeps your place, caret and whiteboard undo. More uses more memory; Off closes a tab's view when you leave it. Browser tabs are never kept.", "memory speed fast switch tabs cache keep alive background off"],
    ],
    "Opening pages",
  ),
  ...make(
    "pages",
    [
      [
        "smartRun",
        "Smart pages",
        "A smart page has a small app of its own, such as a tracker or a dashboard, that works with your notes under the same rules as an agent. They are a plugin that is off until you turn it on in Plugins, for each vault; a project can turn them on or off for its own pages from its menu. Off, every smart page shows its notes instead, and agents can only ask you to turn them on. A page an agent made waits for your Allow to run either way.",
        "smart interactive app tracker dashboard sandbox frames plugin turn on off stop disable kill switch",
        { only: "desktop" },
      ],
    ],
    "Smart pages",
  ),
  ...make("sidebar", [
    ["cards", "Show quick notes under projects", "Quick notes and captures stay on their project's home and in the Inbox; turn this on to list them under the project as well.", "cards captures inbox"],
    ["views", "Views in the sidebar", "Pin the ones you use every day; the rest stay under More views, and a view that is open or has a count shows anyway.", "pin unpin order arrange navigation more views", { jump: true }],
  ]),
  ...make(
    "home",
    HOME_SECTIONS.map((s): Spec => [s.id, s.label, s.hint, "section show hide customize"]),
  ),
  ...make("boards", [
    [
      "toolbar",
      "Always show the toolbar",
      "Off, the strip of tools on a board's left edge rests faintly until the pointer comes to it, so it stays out of the way while you work. Every tool is also a key (V, H, D, R, O, L), and every action is in the palette.",
      "tools strip left edge canvas hide",
    ],
    ["minimap", "Show the minimap", "A small map of the board in a corner, for large boards. M turns it on and off on a board.", "overview map corner large"],
    ["doubleClick", "Double-click on empty space makes", "What a double-click on an empty part of a board makes. The + menu on a board sets it too.", "card sticky note create empty"],
  ]),
  ...make("ai", [
    ["providers", "Providers", "Anthropic, any OpenAI-compatible server, or your ChatGPT plan, each with the model new chats start with. Keys are kept in your system keychain.", "anthropic claude openai gpt api key model vllm ollama local server base url add test remove", { jump: true }],
    [
      "chatgpt",
      "Use your ChatGPT plan",
      "Sign in with your ChatGPT account instead of an API key. Chats, AI writing, brainstorms and suggestions then count against your ChatGPT plan; you set the limit in ChatGPT → Settings → Usage. Image generation and some tools are not available. Your notes go to OpenAI only while this provider is the one chosen.",
      "sign in chatgpt openai subscription plus pro account login",
    ],
  ]),
  ...make(
    "ai",
    [
      [
        "selectedText",
        "Selected text",
        "Add automatically: selecting 3 or more characters in a page, PDF, LaTeX document or slide text box puts it on the chat as a chip you can remove. Only with “Add to chat”: nothing is added until you press Add to chat (Ctrl+Alt+L). Never: selections are not offered. Add to chat keeps up to five snippets.",
        "selection snippet quote context highlight automatically chip add to chat ask about",
      ],
      [
        "onSwitch",
        "When I switch pages",
        "Keep this chat and follow the page: one chat whose page chip follows the page in front. Use that page’s chat: each page has its own chat, made when you first write in it; switching tabs switches chats. Start a new chat: every page you open gets a fresh chat.",
        "switch tabs page chat bound per page new chat follow conversation separate",
      ],
      [
        "assistantLinks",
        "Links from the assistant open",
        "Where a page, board or file named in a deck’s assistant opens when you click it. Beside the deck: in the pane to its right, so the deck stays where it is. In a new tab: a tab of its own. In the deck’s tab: replaces the deck there (Back brings it back). Ctrl, Shift and Alt still choose.",
        "slides deck assistant link click open beside new tab here replace pane split",
      ],
      ["listSize", "Chats in the list", "How many chats the list keeps. Older ones are archived, not deleted, and stay under Archived in the Chat view. A chat tied to a page, or one that is working, is never archived.", "history archive older chats keep number list size limit"],
      [
        "maxConcurrent",
        "Agents working at once",
        "How many chats may work at the same time. A chat past the limit says “Waiting for another chat to finish” and starts when a place is free; Stop takes it out of the line.",
        "concurrent parallel simultaneous queue waiting agents chats limit memory",
      ],
    ],
    "Chat panel",
  ),
  ...make(
    "ai",
    [
      ["budgetRounds", "Steps in one go", "How many times the assistant may ask the model, one step after another, before it pauses. A pause keeps everything it has done; Continue lets it go on.", "limit pause continue budget agent chat steps rounds"],
      ["budgetCalls", "Tool calls in one go", "How many times the assistant may use its tools (read, search, change notes) before it pauses and waits for Continue.", "limit pause continue budget agent chat tools calls"],
      ["budgetMinutes", "Minutes in one go", "How long one answer may run before it pauses and waits for Continue.", "limit pause continue budget agent chat time duration"],
    ],
    "Agent limits",
  ),
  ...make(
    "ai",
    [
      [
        "report",
        "Connection report",
        "The last requests to your AI providers: how far each got, how it ended, the tries it took and how long. It holds no keys, tokens, prompts or answers, so it can be copied into a message when a chat or a sign-in does not work.",
        "connection errors diagnostics retry requests failed network timeout copy clear",
        { jump: true },
      ],
    ],
    "Connection report",
  ),
  ...make("agents", [
    [
      "mode",
      "How much agents may do",
      "Review everything holds every change for your review. Balanced lets small changes through and holds big or risky ones. Autonomous lets agents work freely for a time you choose; a restore point is saved first, and everything can be undone.",
      "review everything balanced autonomous permission approve trust free hands off unattended",
      { card: "How much agents may do" },
    ],
    ["modeUntil", "How long Autonomous lasts", "1 hour, 8 hours, or until you turn it off. When the time is up, agents are on Balanced again.", "autonomous time box hour duration expire end", { card: "How much agents may do", quiet: true }],
    ["modeProjects", "Projects with a mode of their own", "A project can be stricter or looser than everything else. Agents working in it follow its mode.", "project override per project autonomous review", { card: "How much agents may do" }],
    ["claude", "Connect Claude Code", "Run this once in a terminal.", "mcp command cli claude code"],
    ["config", "Claude Desktop, Cursor and other MCP apps", "Add this to the app's MCP settings (its mcpServers).", "mcp json config cursor"],
    ["url", "Clients that connect by URL", "Start the server with the command, then connect to its address with the token as a bearer. It answers this computer only.", "http token bearer server address"],
    ["review", "Changes waiting and past sessions", "Accept or reject proposals; undo a whole session.", "review history proposals undo"],
    ...LIMIT_SPECS.map((spec): Spec => [spec[0], spec[1], spec[2], spec[3], { card: "Review limits" }]),
  ]),
  ...make("calendar", [
    ["weekStart", "Weeks start on", "For the Calendar and the journal's month.", "monday sunday saturday week first day"],
    ...SHOW_OPTIONS.map((o): Spec => [`show.${o.key}`, o.label, o.detail, "show days calendar"]),
    ["feeds", "Subscribed calendars", "Their events show in the Calendar and on Home, read-only. Nothing is written to your notes and nothing is sent back to the calendar.", "google outlook ics ical feed subscribe refresh", { card: "Subscribed calendars", jump: true, only: "desktop" }],
    ["subscribe", "Subscribe to a calendar", "Paste the calendar's address; KastenFlow checks it before keeping it.", "google outlook ics ical webcal url", { card: "Subscribed calendars" }],
    ["reviewReminder", "Weekly review reminder", "A banner on Home once the chosen day has come, until the weekly review is marked done. Off until you switch it on. A review not done is only a date, never an error.", "review weekly reminder banner routine look back", { card: "Reviews" }],
    ["reviewDay", "Reminder day", "The day of the week the banner first shows.", "review weekly weekday monday friday", { card: "Reviews" }],
  ]),
  ...make("browser", [
    ["enabled", "Use the browser", "Adds Browser to the sidebar and the new tab menu, and lets a slide show a web page beside it.", "web internet turn on slides preview"],
    ["engine", "Search engine", "What the address box searches with, when what you type is not an address.", "google duckduckgo bing"],
    ["addEngine", "Add a search engine", "A name and an address with %s where the words go.", "custom url", { jump: true }],
    ["favourites", "Favourite sites", "Shown on the start page of a new browser tab.", "bookmarks start page", { jump: true }],
    ["webLinks", "Open web links in", "For links in your pages, cards and chats. Shift+click uses the other one. A browser tab needs the browser turned on.", "system browser tab"],
    ["clear", "Browsing data", "Cookies, history and cached files of the browser. Your notes and KastenFlow's own data are not touched.", "cookies history cache clear delete"],
    ["signin", "Signing in", "Some sites, Google among them, may refuse sign-in inside an embedded browser like this one. Open the page in your system browser instead (the arrow beside the address).", "google login"],
  ]),
  ...make("extension", [
    ["enabled", "Let the browser extension reach KastenFlow", "Off until you turn it on.", "chrome edge capture clip turn on"],
    ["port", "Port", "KastenFlow listens here on 127.0.0.1. The extension asks for the same port (in its own popup, under Advanced).", "network address"],
    ["pair", "Pair an extension", "Make a code in KastenFlow, then type it into the extension's popup. It works once.", "code connect chrome edge"],
    ["paired", "Paired extensions", "The extensions that can add captures, each with a way to revoke it.", "revoke unpair"],
    ["folder", "Extension folder", "KastenFlow carries the extension's files, kept up to date with each update. In Chrome or Edge, Load unpacked picks this folder.", "files show folder open install unpacked load", { only: "desktop" }],
    ["install", "Put the extension in Chrome or Edge", "Load it unpacked from the folder KastenFlow carries, pin it, then pair.", "install developer mode load unpacked steps", { jump: true }],
  ]),
  ...make("vault", [
    ["location", "Notes live in", "Every page is a Markdown file in this folder.", "folder path directory where"],
    ["import", "Import notes", "From Obsidian, Notion, Heptabase, a folder of Markdown or a KastenFlow project bundle, as a project you can undo.", "obsidian notion heptabase markdown migrate bundle"],
    ["export", "Export a project", "A copy of one project as a folder outside the vault: its pages, whiteboards, decks, pictures, PDFs, tags and the works it cites. You see what goes in first. Credentials, history, chats and the trash never do. Import brings it back into any vault.", "bundle share send copy folder package give away", { only: "desktop" }],
    ["switch", "Switch vault", "Open another folder, or make a new vault; the window restarts on it.", "open another folder new vault change", { only: "desktop" }],
    ["copy", "Copy vault settings", "The vault's own settings (AI provider addresses, agent limits, the journal template) as text. Keys are never in it.", "config yaml export json", { only: "desktop" }],
  ]),
  ...make("history", [
    ["synced", "Vault folder", "Quit KastenFlow, move the vault folder out of the synced folder, then open the folder from its new place.", "dropbox onedrive google drive icloud synced cloud", { quiet: true }],
    ["history", "History", "Saved changes are recorded in local Git history so you can restore earlier versions.", "git versions restore undo"],
    ["check", "Check the vault", "Looks for pages with broken properties, pages that clash with each other, links to missing pages and damaged history.", "verify problems integrity repair"],
    ["health", "Vault health", "How the vault stands: saving and indexing, backup, copies kept after outside changes, proposed changes, broken links and missing pictures, and what drawing and the browser need. Looking changes nothing.", "status problems conflicts indexing stale failed saved external proposed diagnose repair missing assets", { card: "Vault health", jump: true }],
  ]),
  ...make("backup", [
    ["setup", "Set up backup", "A guided setup: pick GitHub, another git host or a folder, and the first backup is made for you.", "wizard guide start github folder drive sync", { only: "desktop" }],
    ["github", "Back up to GitHub", "Sign in, and KastenFlow makes a private repository in your account for this vault.", "sign in remote repository"],
    ["remote", "Backup remote", "A private git repository on any host, such as GitLab, Gitea or your own server. Nothing on the server is ever overwritten.", "git gitlab gitea server push token url"],
    ["status", "Backup status", "When this vault was last backed up, and a button to back up now.", "push now", { quiet: true }],
    ["latest", "Get latest", "Brings in what you changed on another computer. Nothing here is overwritten: a page changed on both keeps the other version beside yours.", "pull sync another computer restore", { quiet: true }],
    ["token", "Backup token", "A personal access token that can read and write the backup repository. It is checked now and sent to that server only.", "password credentials git", { quiet: true }],
    ["signin", "Sign-in", "The GitHub account KastenFlow signs in with. Signing out forgets it on this computer; revoking takes the access away on GitHub too.", "account sign out revoke access token github", { only: "desktop", quiet: true }],
    ["when", "When to back up", "As I work: 2 minutes after you stop changing things, and at least once an hour. Every hour: once an hour when something changed. Only when I close or by hand: never by itself.", "push delay interval schedule hourly manual automatic", { only: "desktop" }],
    ["others", "Changes from other computers", "Automatically when safe brings in what another computer backed up when nothing here is waiting and no page has unsaved typing. Ask me tells you first. Only by hand never looks. Two sets of changes that need joining always ask first.", "get latest pull fetch sync interval minutes look automatic ask manual", { only: "desktop" }],
    ["files", "Backup files", "For Dropbox, Google Drive, OneDrive or a disk: a file of the whole vault in their folder, written daily. Not encrypted.", "folder bundle dropbox drive onedrive disk"],
    ["keep", "Backup files to keep", "How many of this computer's backup files stay in the folder, from 3 to 60. Seven by default.", "retention count folder bundle", { only: "desktop" }],
    ["safety", "Safety", "Whether the backup is private and locked against rewriting, when it was last read back whole, which files were left out and how big the history is.", "private public visibility protection verify size 100 mb skipped", { only: "desktop" }],
    ["notin", "What is not in the backup", "Saved chats, attachments in chats and this app's settings stay on this computer. Save a chat as a note to keep it in the vault.", "chats attachments settings missing excluded", { only: "desktop" }],
  ]),
  ...make("search", [
    ["provider", "Provider", "An OpenAI-compatible one: OpenAI, or a local server such as vLLM or Ollama. Add one under AI providers first.", "embeddings openai vllm ollama", { only: "desktop" }],
    ["model", "Embedding model", "OpenAI's text-embedding-3-small, or the embedding model your server runs.", "embeddings vectors text-embedding", { only: "desktop" }],
    ["vectors", "Vectors", "Make a vector for each note, so searching by meaning can find it.", "make stop index embeddings notes", { only: "desktop", quiet: true }],
    ["unavailable", "Search by meaning works in the desktop app", "It asks an embedding model, with a key kept in your system keychain.", "embeddings vectors", { only: "preview" }],
  ]),
  ...make("diagrams", [
    ["editor", "Diagram editor", "A separate download, checked to be exactly the file KastenFlow expects before it is installed. Apache-2.0. It never reaches the network.", "draw.io drawio install remove download flowchart"],
    ["credit", "Credit", "The editor's licence and notices are kept with the installed copy and in the docs.", "drawio licence apache"],
  ]),
  ...make("templates", [
    ["count", "Templates", "Pages in the templates folder; {{title}}, {{date}}, {{time}}, {{weekday}}, {{week}}, {{month}} and {{year}} are filled in.", "gallery browse placeholders"],
    ["journal", "Journal days start from", "The template each new day's page is made from; days already written keep theirs.", "daily diary"],
    ["kits", "Starter kits", "A daily planner, a second brain, a Zettelkasten, Getting Things Done, student or research: pages, templates and tag databases in one step that Undo takes back.", "gtd planner zettelkasten para"],
    ["missing", "New starter templates", "Starter templates a newer KastenFlow added since this vault was made.", "add", { quiet: true }],
  ]),
  ...make("plugins", [["list", "Plugins", "Extra tools you can switch on, such as diagrams, LaTeX, smart pages and the browser. Some download a program the first time.", "extensions add-ons extras tools diagrams drawio latex smart pages browser download"]]),
  ...make("desktop", [
    ["keepRunning", "Keep running when the window closes", "KastenFlow stays in the tray, so quick capture and backups carry on. Quit from the tray icon.", "tray background close", { only: "desktop" }],
    ["capture", "Quick capture", "A small box over any app: type, Tab to choose where it goes, Enter to save.", "shortcut global key hotkey capture", { only: "desktop" }],
    ["notifications", "Notifications", "Only while KastenFlow is in the background: when a backup starts failing, a new version is ready, or a chat finished, paused or failed. Never a note's or an answer's words.", "alerts", { only: "desktop" }],
    ["about", "Quick capture and the tray", "Capture from any app with a shortcut, keep KastenFlow in the tray and hear when a backup fails: these come with the desktop app.", "tray capture", { only: "preview" }],
  ]),
  ...make("shortcuts", [
    ["sheet", "All shortcuts on one sheet", "Every key on one page, to read.", "list cheat sheet help"],
    ["editor", "Change a command's keys", "Click a key to change it. Keys need Ctrl, ⌘ or Alt, so typing never runs a command. Backspace removes a key and Escape cancels.", "keys keyboard shortcuts bindings hotkeys rebind record reset command", { jump: true }],
  ]),
  ...make("about", [
    ["version", "KastenFlow", "The version, and the licence: MIT.", "version build core mit"],
    ["updates", "Updates", "See whether a newer KastenFlow is out.", "check new version release upgrade"],
    ["autoCheck", "Check for new versions", "Once a day, and when KastenFlow starts, asks GitHub for the latest release. Off until you turn it on.", "automatic daily update github"],
    ["autoDownload", "Download new versions automatically", "A new version the check finds downloads in the background. It installs only when you choose Restart to update.", "automatic install background update", { quiet: true }],
    ["licences", "Open-source licences", "The libraries KastenFlow is built on, and their licences.", "third party notices credits"],
  ]),
];
