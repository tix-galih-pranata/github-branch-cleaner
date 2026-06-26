# GitHub Branch Cleaner

A small **locally-run** web app to bulk-delete remote branches on any repo. You
paste a remote URL, tick the branches you want to **keep**, and it deletes all
the rest.

It only ever runs:

- `git ls-remote` to list branch names, and
- `git push <url> --delete <branch...>` to delete them.

Branch **contents are never fetched, checked out, or merged**, so "infected" or
unwanted branches can't run any code on your machine. Deleting a remote branch
is a push of a deletion, not a pull.

## Why a local app (and no PAT)

The backend shells out to the `git` binary on your own machine, so it
authenticates with your existing git credential helper / SSH agent. Any private
repo you already have push access to just works. No personal access token is
created, entered, or stored anywhere.

> Because it uses your local credentials, run it locally only. Do not deploy it
> to a shared server.

## Requirements

- Node.js 18+ (tested on Node 20)
- `git` installed and on your `PATH`
- Push access to the repos you want to clean (via your normal git credentials)

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
- All git calls use `execFile('git', [...args])` (no shell), and the URL and
  branch names are validated to prevent argument injection.
- A branch is only reported as "deleted" if git's `--porcelain` output confirms
  it; anything else is reported as "failed".

## Project structure

- `app/page.tsx` - the UI (URL input, keep-list checkboxes, preview, confirm).
- `app/api/branches/route.ts` - lists remote branches + default branch.
- `app/api/delete/route.ts` - deletes the selected branches.
- `lib/git.ts` - `execFile`-based git wrappers with validation.

## Caveats

- Protected branches / branch-protection rules will reject deletion; those show
  up as failures, which is expected.
- The default branch can never be deleted by a remote.

## License

[MIT](LICENSE)
