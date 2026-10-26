# Back up to GitHub

Back up your notes to a private GitHub repository of your own, so a lost or
broken computer never loses them. The backup holds your notes and their whole
history. It is not live sync: KastenFlow sends your changes a few minutes
after you make them and brings in changes from another computer when you ask
or when it is safe.

- [Set it up](#set-it-up)
- [Sign in](#sign-in)
- [See how the backup is doing](#see-how-the-backup-is-doing)
- [Use your notes on another computer](#use-your-notes-on-another-computer)
- [What is not in the backup](#what-is-not-in-the-backup)
- [Files over 100 MB](#files-over-100-mb)
- [If the repository becomes public](#if-the-repository-becomes-public)
- [If the copy on GitHub was changed](#if-the-copy-on-github-was-changed)
- [Settings → Backup](#settings--backup)

## Set it up

You can start from any of these:

- the **Set up backup** button in the status bar, when backup is off;
- the **Keep your notes safe** notice that appears after you create a vault, the
  card on Home while backup is off (**Not now** hides it for a week), or the
  line "History is on this computer only" in History (**Back it up**);
- **Set up backup** in the command palette (Ctrl+K) or in Settings → Backup.

The setup is one panel, in three steps:

1. **Where.** Choose the **GitHub** card. The same panel also offers another
   Git host and a folder (a backup file in a folder such as Dropbox or a disk).
2. **Sign in.** See [Sign in](#sign-in). If you are already signed in, this step
   is skipped.
3. **A private repository.** Choose **Create private repo** (its name is filled in
   and checked for you), or pick one of your own private repositories from the
   list. The list shows repositories that earlier KastenFlow backups made first,
   and you can search it.

Then the first backup runs, with a bar that shows how many changes are left
and how many megabytes. When it finishes, the panel says so and you are done.
You can close the panel at any time with Escape: your place is kept and the
setup starts again where you left it.

A repository you pick is looked at first. An empty one is used at once. One
that already holds this vault's history is joined, and **Get latest** runs
before anything is sent. One that holds something else is never written to:
the panel says so and offers **Restore** (to open it as a vault in an empty
folder) or **Pick another**.

## Sign in

Choose the way that suits you. All three end the same way.

- **Sign in with GitHub** (the usual way). KastenFlow shows a short code, copies
  it, and opens GitHub's sign-in page in your browser. Confirm there and the
  panel moves on by itself. If the code runs out, press **Get a new code**.
- **A token.** Choose the token option and KastenFlow opens GitHub's token page
  with the name and the permissions it needs already filled in. Paste the token
  back. It is checked (that you are signed in, that the repository is visible
  and that you may write to it) before it is saved.
- **The GitHub command line.** If `gh` is already signed in on this computer,
  one button uses it. The option only appears when `gh` is found.

Your token is kept in your system's keychain and is sent only to GitHub. If the
keychain is not available, KastenFlow keeps the sign-in until you close it and
says so. **Sign out** (Settings → Backup) removes it from this computer and
gives you the link to revoke it on GitHub.

## See how the backup is doing

The status bar shows one line, for example **Backed up 2 minutes ago** or
**Backed up · 3 waiting**. Click it for the details:

- how many changes are waiting, and whether the copy on GitHub was checked;
- a line if the backup is behind another computer's;
- warnings: the repository is public, the history was changed, backing up keeps
  failing, or some files were left out;
- buttons: **Back up now**, **Get latest**, **Open on GitHub**, **Backup settings**.

**Back up now** always answers with a notice: it is done, there was nothing to
do, or why it could not. The same commands are in the palette: *Back up now*,
*Get latest* and *Open backup on GitHub*.

## Use your notes on another computer

1. On the new computer, choose **Restore from a backup** where you open a vault.
2. Choose **Sign in to open my backup from GitHub**. Your repositories are listed,
   KastenFlow backups first, with a search box.
3. Pick the repository and an **empty** folder to restore into.

Your notes come back with every page and the whole history, and the backup is
set up on the new computer too.

Afterwards, **Get latest** brings in changes made on the other computer. It never
overwrites. By default (Settings → Backup → *Changes from other computers*) it
does this by itself every 15 minutes, but only when it is safe: nothing here is
waiting to be backed up, no open page has unsaved changes, and no merge is
needed. You see a notice, "Brought in 3 changes from another computer", with **See
changes**. If it is not safe, KastenFlow asks you once. If both computers
changed the same page, the other version is kept beside yours as a copy.

## What is not in the backup

- **Saved chats and app settings.** They stay on each computer, in the app's own
  folder. Set them up again on a new computer.
- **Your keys and tokens.** API keys and the GitHub token live in the system
  keychain.
- **Files over 100 MB.** See below.

Backup copies your notes' history too, so a note you deleted a long time ago is
still in the repository. Keep the repository private.

## Files over 100 MB

GitHub does not accept files over 100 MB. KastenFlow leaves such a file out of
the backup, keeps working with it normally on your computer, and lists it so you
can see what was skipped. The status line says how many files are left out;
**Show it** points to them. To back one up, make it smaller or keep it outside
the vault. The list is a small file in the vault, `.kasten/backup-skip.yaml`
([the format](vault-format.md)). A file between 50 and 100 MB is backed up, with
a warning that it is large.

## If the repository becomes public

Your notes are private, so the backup must be too. KastenFlow checks the
repository when you link it, shortly after you open the vault, and once a day. If
it finds it public, **backup pauses**: nothing is sent anywhere until you decide.
The status line is red and offers:

- **Make it private** (one click), or
- **I want a public backup** (it is remembered on this computer).

Linking a public repository is refused in the first place.

## If the copy on GitHub was changed

KastenFlow never rewrites the history on GitHub and never forces anything. If it
finds that the copy there no longer holds what it sent before (for example
someone reset it), it **stops backing up** rather than guess, and says so. You
can then:

- **Save this computer's full history to a safety branch** (a new branch named
  `kasten/recovered-` and today's date, with your whole history), or
- **Carry on with the backup as it is now.**

Where your GitHub plan allows it, KastenFlow also asks GitHub to protect the
repository against force pushes and deletion, and tells you plainly in
Settings → Backup → Safety when your plan does not.

## Settings → Backup

Everything in one place; each row has a plain sentence.

- **Set up backup**, the GitHub account (sign in, sign out) and the backup address.
- **When to back up:** *As I work* (a few minutes after changes), *Every hour*, or
  *Only when I close or by hand*.
- **Changes from other computers:** *Automatically when safe* (default), *Ask me*
  or *Only by hand*, and how many minutes between looks (0 turns looking off).
- **Backup files:** if you also write backup files to a folder, how many to keep
  (7 by default, from 3 to 60).
- **Safety:** whether the repository is private, whether it is protected, when
  that was last checked, which files are not backed up and how large the history
  is. A fact that is not known yet reads "Not checked yet".
- **What is not in the backup**, in words.

Other ways to back up (any Git host, or a backup file in a folder) and restoring a
point in time are in the [user guide](guide.md#backup-and-restore).
