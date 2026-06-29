# GitHub Branch Tools

A small **locally-run** web app with two pages:

1. **Branch Cleaner** (`/`) - bulk-delete remote branches on any repo. Paste a
   remote URL, tick the branches you want to **keep**, and it deletes the rest.
2. **Force-Push Recovery** (`/recover`) - find recent force-push events on a
   repo and restore the pre-force commit (as a new branch, or by force-updating
   the branch in place).

The Cleaner only ever runs:

- `git ls-remote` to list branch names, and
- `git push <url> --delete <branch...>` to delete them.

The Recovery page only ever calls the GitHub REST API via `gh api` (Activity
API to find force pushes, Git Refs API to restore).

In both cases, branch **contents are never fetched, cloned, checked out, or
merged**, so "infected" or unwanted branches can't run any code on your machine.

## Why a local app (and no PAT)

The backend shells out to the `git` binary on your own machine, so it
authenticates with your existing git credential helper / SSH agent. Any private
repo you already have push access to just works. No personal access token is
created, entered, or stored anywhere.

> Because it uses your local credentials, run it locally only. Do not deploy it
> to a shared server.

## Requirements

- Node.js 18+ (tested on Node 20)
- `git` installed and on your `PATH` (Branch Cleaner)
- Push access to the repos you want to clean (via your normal git credentials)
- For the **Recovery** page: the GitHub CLI (`gh`) installed and authenticated
  via `gh auth login`. The recovery calls run as your authenticated `gh` user,
  so no PAT is stored. Force-updating a branch in place requires push access.

## Setup

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

For a production-style run:

```bash
npm run build
npm run start
```

## How to use

1. Paste a remote URL, e.g. `https://github.com/org/repo.git` or
   `git@github.com:org/repo.git`, and click **Load branches**.
2. Every branch is listed. Tick the ones you want to **keep**. The repo's
   **default branch** is always kept and cannot be unticked (the remote refuses
   to delete it anyway).
3. The red panel shows exactly which branches **will be deleted**.
4. Leave **Dry run** checked to just preview. Uncheck it to enable the delete
   button.
5. Click **Delete**, type `DELETE` in the confirmation dialog, and confirm.
6. Per-branch results (deleted / failed) are shown. Protected branches will
   appear under "failed" with the reason from git.

## How to recover a force-pushed branch

1. Open the **Force-Push Recovery** page from the top nav.
2. Enter a repo (`owner/repo` or a GitHub URL) and, optionally, a branch to
   narrow the search. Click **Find force pushes**.
3. Each force-push event shows the `before` (recoverable) and `after` commits,
   who did it, when, and a **view lost commits** link comparing the two on
   GitHub.
4. Click **Recover** on the relevant event and choose either:
   - **Create a new branch** (recommended, non-destructive) - the recovered
     commit is pushed to a brand-new ref so nothing is overwritten, or
   - **Force-update the branch in place** - moves the existing branch tip back
     to the recovered commit (overwrites the current remote tip).
5. Type `RESTORE` to confirm. The result modal links to the recovered branch.

> The Activity API only retains recent events, so very old force pushes may not
> appear. As long as the `before` commit is still referenced (e.g. by the
> recovery branch you create), GitHub will not garbage-collect it.

## Safety features

- Dry-run is on by default; deletion requires unchecking it.
- A confirmation dialog requires typing `DELETE`.
- The default branch is locked as "keep" in the UI and hard-blocked on the
  server.
- **Protected branches are never deleted**: `master`, `main`, `develop`,
  `release`, `staging` (matched by exact name, case-insensitive). Namespaced
  branches such as `develop/demand` or `release/1.2` are NOT protected and can
  be deleted. The protected names are locked in the UI and hard-blocked on the
  server in `lib/git.ts` (`PROTECTED_BRANCHES`), so they cannot be deleted even
  via a direct API call.
- All git/gh calls use `execFile(...)` (no shell), and repo slugs, URLs, branch
  names, and commit SHAs are validated to prevent argument injection.
- A branch is only reported as "deleted" if git's `--porcelain` output confirms
  it; anything else is reported as "failed".
- Recovery requires typing `RESTORE`; the default (recommended) mode creates a
  new branch and never overwrites anything.

## Project structure

- `app/page.tsx` - Branch Cleaner UI (URL input, keep-list, preview, confirm).
- `app/recover/page.tsx` - Force-Push Recovery UI (find events, mode, confirm).
- `app/components/Nav.tsx` - top navigation between the two pages.
- `app/api/branches/route.ts` - lists remote branches + default branch.
- `app/api/delete/route.ts` - deletes the selected branches.
- `app/api/recover/activity/route.ts` - lists recent force-push events.
- `app/api/recover/restore/route.ts` - restores a commit (new / in-place).
- `lib/git.ts` - `execFile`-based git wrappers with validation.
- `lib/gh.ts` - `execFile`-based `gh api` wrappers with validation.

## Caveats

- Protected branches / branch-protection rules will reject deletion; those show
  up as failures, which is expected.
- The default branch can never be deleted by a remote.

## License

[MIT](LICENSE)
