"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isProtectedBranch, type DeleteResult } from "@/lib/branches";

type Phase = "idle" | "loading" | "loaded" | "deleting";

type NoticeType = "success" | "error" | "warning";

interface Notice {
  type: NoticeType;
  message: string;
}

function plural(n: number): string {
  return n === 1 ? "" : "es";
}

function BranchChipList({
  branches,
  variant,
}: {
  branches: string[];
  variant: "keep" | "delete";
}) {
  const chip =
    variant === "keep"
      ? "bg-emerald-100 text-emerald-800"
      : "bg-red-100 text-red-800";
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {branches.map((b) => (
        <span
          key={b}
          className={`rounded px-2 py-0.5 font-mono text-xs ${chip}`}
        >
          {b}
        </span>
      ))}
    </div>
  );
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  const [branches, setBranches] = useState<string[]>([]);
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null);
  const [keep, setKeep] = useState<Set<string>>(new Set());

  const [dryRun, setDryRun] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [result, setResult] = useState<DeleteResult | null>(null);
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = useCallback((type: NoticeType, message: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ type, message });
    noticeTimer.current = setTimeout(
      () => setNotice(null),
      type === "success" ? 5000 : 8000,
    );
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  // A branch is "locked" (can never be deleted) if it is the remote's default
  // branch or matches the protected list. Locked branches are excluded from the
  // delete set regardless of the keep checkboxes.
  const isLocked = useCallback(
    (b: string) => b === defaultBranch || isProtectedBranch(b),
    [defaultBranch],
  );
  const isKept = useCallback(
    (b: string) => keep.has(b) || isLocked(b),
    [keep, isLocked],
  );

  const toDelete = useMemo(
    () => branches.filter((b) => !isKept(b)),
    [branches, isKept],
  );

  const toKeep = useMemo(
    () => branches.filter((b) => isKept(b)),
    [branches, isKept],
  );

  // Visible branches after applying the search filter (case-insensitive) and
  // sorting kept branches to the top so it's easy to see what's selected. The
  // filter and ordering only affect what's shown, never the selection itself.
  const visibleBranches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? branches.filter((b) => b.toLowerCase().includes(q))
      : branches;
    return [...filtered].sort((a, b) => {
      const ak = isKept(a) ? 0 : 1;
      const bk = isKept(b) ? 0 : 1;
      if (ak !== bk) return ak - bk; // kept branches first
      return a.localeCompare(b); // then alphabetical within each group
    });
  }, [branches, filter, isKept]);

  async function loadBranches({ silent = false }: { silent?: boolean } = {}) {
    setError(null);
    setErrorDetail(null);
    setFilter("");
    setPhase("loading");
    try {
      const res = await fetch("/api/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load branches");
        setErrorDetail(data.detail ?? null);
        setPhase("idle");
        showNotice("error", data.error ?? "Failed to load branches");
        return;
      }
      const loaded: string[] = data.branches ?? [];
      const def: string | null = data.defaultBranch ?? null;
      setBranches(loaded);
      setDefaultBranch(def);
      // By default, keep all locked branches (default + protected) ticked. The
      // user explicitly opts into keeping anything more.
      const lockedKept = loaded.filter(
        (b) => b === def || isProtectedBranch(b),
      );
      setKeep(new Set(lockedKept));
      setPhase("loaded");
      if (!silent) {
        showNotice(
          "success",
          `Loaded ${loaded.length} branch${plural(loaded.length)}`,
        );
      }
    } catch {
      setError("Network error contacting the local server");
      setPhase("idle");
      showNotice("error", "Network error contacting the local server");
    }
  }

  function toggleKeep(branch: string) {
    if (isLocked(branch)) return;
    setKeep((prev) => {
      const next = new Set(prev);
      if (next.has(branch)) next.delete(branch);
      else next.add(branch);
      return next;
    });
  }

  function keepAll() {
    setKeep(new Set(branches));
  }

  function keepNoneButLocked() {
    setKeep(new Set(branches.filter(isLocked)));
  }

  function openConfirm() {
    setConfirmText("");
    setConfirmOpen(true);
  }

  async function runDeletion() {
    setConfirmOpen(false);
    setError(null);
    setErrorDetail(null);
    setPhase("deleting");
    try {
      const res = await fetch("/api/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, branches: toDelete }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to delete branches");
        setErrorDetail(data.detail ?? null);
        setPhase("loaded");
        showNotice("error", data.error ?? "Failed to delete branches");
        return;
      }
      // Setting result opens the summary modal (it renders when result != null),
      // which is the sole presenter of the deletion outcome.
      setResult(data as DeleteResult);
      // Refresh the branch list so deleted branches disappear. Silent so its
      // toast doesn't compete with the result modal.
      await loadBranches({ silent: true });
    } catch {
      setError("Network error contacting the local server");
      setPhase("loaded");
      showNotice("error", "Network error contacting the local server");
    }
  }

  const canDelete = phase === "loaded" && toDelete.length > 0;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed right-4 top-4 z-50 flex max-w-sm items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${
            notice.type === "success"
              ? "border-emerald-200 bg-emerald-50"
              : notice.type === "warning"
                ? "border-amber-200 bg-amber-50"
                : "border-red-200 bg-red-50"
          }`}
          style={{ animation: "gbc-slide-in 150ms ease-out" }}
        >
          <span
            className={`mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
              notice.type === "success"
                ? "bg-emerald-500"
                : notice.type === "warning"
                  ? "bg-amber-500"
                  : "bg-red-500"
            }`}
          />
          <p className="flex-1 text-slate-800">{notice.message}</p>
          <button
            onClick={() => setNotice(null)}
            aria-label="Dismiss notification"
            className="-mr-1 -mt-1 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            &times;
          </button>
        </div>
      )}

      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          GitHub Branch Cleaner
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Lists a remote repo&apos;s branches and deletes everything except the
          ones you keep. It only runs{" "}
          <code className="rounded bg-slate-200 px-1">git ls-remote</code> and{" "}
          <code className="rounded bg-slate-200 px-1">
            git push --delete
          </code>{" "}
          using your local git credentials. Branch contents are never fetched,
          checked out, or merged.
        </p>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <label htmlFor="url" className="block text-sm font-medium">
          Remote repository URL
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="url"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && url.trim()) loadBranches();
            }}
            placeholder="https://github.com/org/repo.git"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
          />
          <button
            onClick={() => loadBranches()}
            disabled={!url.trim() || phase === "loading"}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase === "loading" ? "Loading..." : "Load branches"}
          </button>
        </div>
      </section>

      {error && (
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">{error}</p>
          {errorDetail && (
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-red-700">
              {errorDetail}
            </pre>
          )}
        </div>
      )}

      {branches.length > 0 && (
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">
              Branches ({branches.length}) &mdash; tick the ones to{" "}
              <span className="font-semibold">keep</span>
            </h2>
            <div className="flex gap-2 text-xs">
              <button
                onClick={keepAll}
                className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
              >
                Keep all
              </button>
              <button
                onClick={keepNoneButLocked}
                className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
              >
                Keep none
              </button>
            </div>
          </div>

          <div className="relative mt-3">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search branches..."
              className="w-full rounded-md border border-slate-300 px-3 py-2 pr-16 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
            />
            {filter && (
              <button
                onClick={() => setFilter("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100"
              >
                Clear
              </button>
            )}
          </div>
          {filter && (
            <p className="mt-1 text-xs text-slate-500">
              Showing {visibleBranches.length} of {branches.length} branches
            </p>
          )}

          <ul className="mt-3 max-h-80 divide-y divide-slate-100 overflow-y-auto rounded border border-slate-100">
            {visibleBranches.length === 0 && (
              <li className="px-3 py-4 text-center text-sm text-slate-500">
                No branches match &ldquo;{filter}&rdquo;
              </li>
            )}
            {visibleBranches.map((b) => {
              const isDefault = b === defaultBranch;
              const isProtected = isProtectedBranch(b);
              const locked = isDefault || isProtected;
              const willDelete = !keep.has(b) && !locked;
              return (
                <li
                  key={b}
                  className={`flex items-center justify-between px-3 py-2 text-sm ${
                    willDelete ? "bg-red-50/60" : "bg-white"
                  }`}
                >
                  <label
                    className={`flex flex-1 items-center gap-2 ${
                      locked ? "cursor-not-allowed" : "cursor-pointer"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={keep.has(b)}
                      disabled={locked}
                      onChange={() => toggleKeep(b)}
                      className="h-4 w-4"
                    />
                    <span className="font-mono">{b}</span>
                    {isDefault && (
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                        default
                      </span>
                    )}
                    {isProtected && !isDefault && (
                      <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
                        protected
                      </span>
                    )}
                  </label>
                  <span
                    className={`text-xs font-medium ${
                      willDelete ? "text-red-600" : "text-emerald-600"
                    }`}
                  >
                    {willDelete ? "delete" : "keep"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {branches.length > 0 && (
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-medium text-emerald-700">
            {toKeep.length} branch{plural(toKeep.length)} will be kept
          </h2>
          {toKeep.length > 0 ? (
            <BranchChipList branches={toKeep} variant="keep" />
          ) : (
            <p className="mt-2 text-sm text-slate-500">
              No branches selected to keep.
            </p>
          )}
        </section>
      )}

      {branches.length > 0 && (
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-medium text-red-700">
            {toDelete.length} branch{plural(toDelete.length)} will be deleted
          </h2>
          {toDelete.length > 0 ? (
            <BranchChipList branches={toDelete} variant="delete" />
          ) : (
            <p className="mt-2 text-sm text-slate-500">
              Nothing selected for deletion.
            </p>
          )}

          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                className="h-4 w-4"
              />
              Dry run (preview only, do not delete)
            </label>
            <button
              onClick={openConfirm}
              disabled={!canDelete || dryRun}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              title={dryRun ? "Uncheck dry run to enable deletion" : undefined}
            >
              {phase === "deleting"
                ? "Deleting..."
                : `Delete ${toDelete.length} branch${plural(toDelete.length)}`}
            </button>
          </div>
        </section>
      )}

      {phase === "deleting" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          role="alertdialog"
          aria-busy="true"
          aria-label="Deleting branches"
        >
          <div className="flex flex-col items-center gap-4 rounded-lg bg-white px-8 py-7 shadow-xl">
            <svg
              className="h-8 w-8 animate-spin text-red-600"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
            <p className="text-sm font-medium text-slate-700">
              Deleting branches&hellip;
            </p>
          </div>
        </div>
      )}

      {result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-lg bg-white shadow-xl">
            <div className="border-b border-slate-100 px-6 py-4">
              <h3
                className={`text-lg font-semibold ${
                  result.failed.length === 0
                    ? "text-emerald-700"
                    : result.deleted.length > 0
                      ? "text-amber-700"
                      : "text-red-700"
                }`}
              >
                {result.failed.length === 0
                  ? "All branches deleted"
                  : result.deleted.length > 0
                    ? "Partially completed"
                    : "Deletion failed"}
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                {result.deleted.length} deleted
                {result.failed.length > 0
                  ? `, ${result.failed.length} failed`
                  : ""}
                .
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div>
                <p className="text-sm font-medium text-emerald-700">
                  Successfully deleted ({result.deleted.length})
                </p>
                {result.deleted.length > 0 ? (
                  <BranchChipList branches={result.deleted} variant="keep" />
                ) : (
                  <p className="mt-1 text-sm text-slate-500">None.</p>
                )}
              </div>

              {result.failed.length > 0 && (
                <div className="mt-5">
                  <p className="text-sm font-medium text-red-700">
                    Failed ({result.failed.length})
                  </p>
                  <ul className="mt-2 space-y-1.5 text-xs">
                    {result.failed.map((f) => (
                      <li key={f.name} className="text-red-700">
                        <span className="font-mono">{f.name}</span> &mdash;{" "}
                        {f.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-slate-100 px-6 py-4">
              <button
                onClick={() => setResult(null)}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-red-700">
              Confirm deletion
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              This permanently deletes{" "}
              <span className="font-semibold">{toDelete.length}</span> branch
              {plural(toDelete.length)} on the remote. This cannot be undone.
              Type <code className="rounded bg-slate-200 px-1">DELETE</code> to
              confirm.
            </p>
            <input
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
              placeholder="DELETE"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={runDeletion}
                disabled={confirmText !== "DELETE"}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
