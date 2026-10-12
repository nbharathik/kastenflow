## Install

| System | File |
| --- | --- |
| Windows 10 and 11 | `KastenFlow_*_x64-setup.exe` (or the `.msi`) |
| macOS 12 or later, Apple silicon | `KastenFlow_*_aarch64.dmg` |
| macOS 12 or later, Intel | `KastenFlow_*_x64.dmg` |
| Debian, Ubuntu | `KastenFlow_*_amd64.deb`: `sudo apt install ./KastenFlow_*_amd64.deb` |
| Fedora, openSUSE | `KastenFlow-*.x86_64.rpm`: `sudo dnf install ./KastenFlow-*.x86_64.rpm` |

These builds are not code-signed yet. Windows may say "Windows protected
your PC": choose **More info**, then **Run anyway**. macOS may refuse to
open KastenFlow the first time: open **System Settings → Privacy & Security**
and choose **Open Anyway**.

`SHA256SUMS.txt` lists every file's checksum.

## Connect AI agents

The installed app is its own MCP server: `kasten-app --mcp --vault <folder>`.
Settings → AI agents copies the exact command for Claude Code and the
`mcpServers` entry for Claude Desktop and other MCP apps.

The `kasten-cli-*` archives hold the `kastenflow` command-line tool (capture,
search, verify, history, restore, review and undo agent sessions; `kasten`
still works as an alias) and the standalone `kasten-mcp` server.
