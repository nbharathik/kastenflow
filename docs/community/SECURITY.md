# Security model

KastenFlow is early software. Use trusted vaults and keep an independent backup.
These are the intended boundaries, not a guarantee that every implementation
path is free of vulnerabilities.

## Reporting a problem

Please report vulnerabilities privately through this repository's Security tab
if private reporting is enabled. If it is unavailable, ask the maintainer for
a private contact without posting exploit details in a public issue.

Include the affected version, platform, reproduction steps and likely impact.
Do not include API keys or a personal vault.

## Known Linux dependency issue

The Linux desktop dependency chain includes `glib` 0.18.5, affected by
[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html).
A string iterator has a memory-safety bug that can cause a null-pointer
crash when used. The fix is in `glib` 0.20 and later, which cannot directly
replace the version required by the current GTK3/WebKit/Tauri chain.
[Tauri tracks the issue pending its GTK migration](https://github.com/tauri-apps/tauri/blob/dev/.cargo/audit.toml).

The Windows dependency graph does not include this affected crate. Source
review found no direct callers outside `glib`, but Linux runtime reachability
has not been verified. This remains an unresolved dependency advisory;
absence of a known caller is not proof that Linux builds are unaffected.

## Local files and history

Notes, configuration and history are stored on disk without application-level
encryption. Backup files include vault history and are also unencrypted. A
private backup destination and disk encryption are the user's responsibility.

The core checks vault-relative paths and rejects many forms of traversal and
links. Do not treat opening an arbitrary shared vault, especially one carrying
its own Git configuration, as a sandboxed operation.

Edits use local Git history, with human typing batched before committing.
Trash and undo help recover changes; they do not protect against disk failure,
filesystem corruption or programs that change files outside KastenFlow.

Atomic creation requires filesystem support for hard links. Unsupported
filesystems fail instead of falling back to a potentially overwriting rename.
Private application paths reject symbolic links and Windows reparse points.
These checks do not isolate the vault from programs running as the same user.

Backup networking uses machine Git configuration, not configuration supplied
by the vault. Included Git configuration is refused; put required helper
settings directly in your machine configuration. Saved tokens remain scoped
to their server and SSH agent authentication remains available.

## AI and network access

AI is optional. When enabled, note context is sent to the selected provider.
API keys and backup credentials are stored through the operating system's
keychain. Custom provider destinations and backup remotes have local
confirmation controls.

KastenFlow's MCP and chat tools enforce operation and review rules. Routine
operations may run without confirmation; locked notes are readable by agents
but protected from their edits. These controls do not constrain an external
agent given shell access or direct access to the vault files.

The HTTP MCP server binds to loopback, requires a bearer token, and rejects
requests with browser Origin headers. Protect its token and the vault folder
from other local users. Loopback access is not isolation from local programs.

Tokens use operating-system cryptographic randomness and private file
permissions. Older tokens rotate on first use of the updated server; refresh
the token in HTTP clients. If private storage cannot be established, the
server does not start with a weaker token.

Public-page fetching connects directly so a proxy cannot bypass destination
address checks. Networks requiring a proxy may therefore be unable to clip
public pages. Explicitly requested intranet pages and model connections may
use system proxies.

## Slides and external content

PowerPoint import limits archive entries, unpacked bytes and XML complexity.
Exports filter unsupported object content. Slide embeds may load external
web pages during presentation; those servers can observe the requests.

Desktop navigation guards are not a network firewall. On Windows, WebView2
may send a GET request before a navigation is cancelled, even when the app
page stays in place. Do not rely on navigation cancellation to prevent
contact with a destination. See [WebView2's cancellation behavior](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2navigationstartingeventargs#get_cancel).

The command-line slide renderer uses a sandboxed browser by default and
blocks external page requests. Disabling its sandbox weakens that protection.
Its browser control port is local, so render under an isolated user or
container on a computer shared with untrusted users.

## Diagnostics and updates

Logs remain local. Panic reports may contain paths or excerpts from content;
inspect them before sharing. File privacy depends on platform permissions.

Automatic updates require a configured signing key. An update signature is
separate from Windows code signing or macOS notarization. Source builds and
unsigned installers should not be described as signed releases.

## Limits

KastenFlow does not defend against someone who can run programs as your user or
read your files. Keep the app and dependencies updated. Report suspected
vulnerabilities privately without sharing credentials or personal notes.
