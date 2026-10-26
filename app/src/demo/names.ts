// The words a recording clicks, in the order of the scenes. They are the names
// the real screens give their buttons, switches and fields (visible text or
// accessible name), listed here so a scene script has one place to look.

export const NAMES = {
  backup: {
    /** The status bar's item: its accessible name starts with this and ends with how fresh the backup is. */
    statusBar: "Backup:",
    statusPopover: "Backup status",
    setUp: "Set up backup",
    github: "GitHub (recommended)",
    signInCode: "Sign-in code",
    openGitHubAgain: "Open GitHub again",
    repoName: "Repository name",
    createRepo: "Create private repo",
    progress: "Backing up",
    next: "Next",
    done: "Done",
    backUpNow: "Back up now",
    getLatest: "Get latest",
    settingsButton: "Backup settings",
    settingsSignIn: "Sign in with GitHub",
    settingsSignOut: "Sign out",
  },
  chat: {
    /** A request the demo answers with proposed changes. */
    prompt: "Plan next week from my notes",
    continueWithChatGpt: "Continue with ChatGPT",
    staged: "This chat's staged changes",
    review: "Review",
    apply: "Apply",
    discard: "Discard",
    undo: "Undo this chat's changes",
    applyDirectly: "Apply directly",
    addToChat: "Add to chat",
    addToChatKeys: "Ctrl+Alt+L",
  },
  plugins: {
    /** The switches in Settings → Plugins are named by the plugin. */
    diagrams: "Diagrams",
    latex: "LaTeX",
    browser: "Browser",
    download: "Download",
    progress: "LaTeX download",
    cancel: "Cancel",
  },
  latex: {
    newDocument: "New document",
    preview: "PDF preview",
    pages: "PDF pages",
  },
  browser: {
    linkMenu: ["Preview here", "Preview beside", "Full screen", "Open in a KastenFlow tab", "Open in my browser", "Copy link"],
  },
} as const;
