"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ForcePushEvent, RecoverResult } from "@/lib/gh";

type Phase = "idle" | "loading" | "loaded" | "restoring";

type NoticeType = "success" | "error" | "warning";

interface Notice {
  type: NoticeType;
  message: string;
}

type RecoverMode = "new" | "inplace";

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function formatTime(ts: string): string {
  if (!ts) return "unknown time";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

export default function Recover() {
  const [repo, setRepo] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  const [repoSlug, setRepoSlug] = useState<string | null>(null);
  const [events, setEvents] = useState<ForcePushEvent[]>([]);

  const [selected, setSelected] = useState<ForcePushEvent | null>(null);
  const [mode, setMode] = useState<RecoverMode>("new");
  const [newBranch, setNewBranch] = useState("");
  const [confirmText, setConfirmText] = useState("");

  const [result, setResult] = useState<RecoverResult | null>(null);
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

  async function findEvents() {
    setError(null);
    setErrorDetail(null);
    setPhase("loading");
    try {
      const res = await fetch("/api/recover/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, branch: branchFilter }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load force-push events");
        setErrorDetail(data.detail ?? null);
        setPhase("idle");
        showNotice("error", data.error ?? "Failed to load force-push events");
        return;
      }
      const loaded: ForcePushEvent[] = data.events ?? [];
      setEvents(loaded);
      setRepoSlug(data.repo ?? null);
      setPhase("loaded");
      showNotice(
        loaded.length > 0 ? "success" : "warning",
        loaded.length > 0
          ? `Found ${loaded.length} force-push event${loaded.length === 1 ? "" : "s"}`
          : "No force-push events found in recent activity",
      );
    } catch {
      setError("Network error contacting the local server");
      setPhase("idle");
      showNotice("error", "Network error contacting the local server");
    }
  }

  function openRecover(ev: ForcePushEvent) {
    setSelected(ev);
    setMode("new");
    setNewBranch(ev.branch ? `${ev.branch}-recovered` : "recovered-branch");
    setConfirmText("");
  }

  function closeRecover() {
    setSelected(null);
    setConfirmText("");
  }

  async function runRestore() {
    if (!selected) return;
    const targetBranch = mode === "new" ? newBranch.trim() : selected.branch;
    setPhase("restoring");
    setError(null);
    setErrorDetail(null);
    try {
      const res = await fetch("/api/recover/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: repoSlug ?? repo,
          sha: selected.before,
          mode,
          branch: targetBranch,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to restore branch");
        setErrorDetail(data.detail ?? null);
        setPhase("loaded");
        showNotice("error", data.error ?? "Failed to restore branch");
        return;
      }
      setResult(data as RecoverResult);
      setSelected(null);
      setConfirmText("");
      setPhase("loaded");
    } catch {
      setError("Network error contacting the local server");
      setPhase("loaded");
      showNotice("error", "Network error contacting the local server");
    }
  }

  const expectedConfirm = "RESTORE";
  const canRestore =
    confirmText === expectedConfirm &&
    (mode === "inplace" || newBranch.trim().length > 0);

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
          Force-Push Recovery
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Finds recent force-push events on a remote repo and restores the
          pre-force commit. It uses the GitHub REST API via{" "}
          <code className="rounded bg-slate-200 px-1">gh api</code> only &mdash;
          nothing is ever cloned, fetched, or checked out locally. Requires the{" "}
          <code className="rounded bg-slate-200 px-1">gh</code> CLI to be
          authenticated (<code className="rounded bg-slate-200 px-1">gh auth login</code>).
        </p>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <label htmlFor="repo" className="block text-sm font-medium">
          Repository
        </label>
        <input
          id="repo"
          type="text"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder="owner/repo or https://github.com/owner/repo"
          className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
        />

        <label htmlFor="branch" className="mt-4 block text-sm font-medium">
          Branch <span className="font-normal text-slate-500">(optional)</span>
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="branch"
            type="text"
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && repo.trim()) findEvents();
            }}
            placeholder="Leave empty to search all branches"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
          />
          <button
            onClick={() => findEvents()}
            disabled={!repo.trim() || phase === "loading"}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase === "loading" ? "Searching..." : "Find force pushes"}
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

      {phase !== "idle" && phase !== "loading" && (
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-medium">
            Force-push events ({events.length})
          </h2>
          {events.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              No force-push events found. The Activity API only retains recent
              events, so very old force pushes may not appear.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {events.map((ev, i) => (
                <li
                  key={`${ev.ref}-${ev.before}-${i}`}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">
                        {ev.branch || "(unknown branch)"}
                      </span>
                      <span className="text-xs text-slate-500">
                        by {ev.actor} &middot; {formatTime(ev.timestamp)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <span>
                        before{" "}
                        <code className="rounded bg-emerald-100 px-1 font-mono text-emerald-800">
                          {shortSha(ev.before)}
                        </code>
                      </span>
                      <span className="text-slate-400">&rarr;</span>
                      <span>
                        after{" "}
                        <code className="rounded bg-red-100 px-1 font-mono text-red-800">
                          {shortSha(ev.after)}
                        </code>
                      </span>
                      {repoSlug && (
                        <a
                          href={`https://github.com/${repoSlug}/compare/${ev.after}...${ev.before}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 underline hover:text-blue-800"
                        >
                          view lost commits
                        </a>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => openRecover(ev)}
                    className="shrink-0 self-start rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 sm:self-center"
                  >
                    Recover
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {phase === "restoring" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          role="alertdialog"
          aria-busy="true"
          aria-label="Restoring branch"
        >
          <div className="flex flex-col items-center gap-4 rounded-lg bg-white px-8 py-7 shadow-xl">
            <svg
              className="h-8 w-8 animate-spin text-slate-700"
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
              Restoring branch&hellip;
            </p>
          </div>
        </div>
      )}

      {selected && phase !== "restoring" && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold">Recover commit</h3>
            <p className="mt-2 text-sm text-slate-600">
              Restoring{" "}
              <code className="rounded bg-emerald-100 px-1 font-mono text-emerald-800">
                {shortSha(selected.before)}
              </code>{" "}
              (the tip of{" "}
              <span className="font-mono">{selected.branch || "the branch"}</span>{" "}
              before it was force-pushed).
            </p>

            <fieldset className="mt-4 space-y-2">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "new"}
                  onChange={() => setMode("new")}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  <span className="font-medium">Create a new branch</span>
                  <span className="block text-xs text-slate-500">
                    Safe and non-destructive. Recommended.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "inplace"}
                  onChange={() => setMode("inplace")}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  <span className="font-medium">
                    Force-update{" "}
                    <span className="font-mono">{selected.branch || "branch"}</span>{" "}
                    in place
                  </span>
                  <span className="block text-xs text-amber-700">
                    Overwrites the current branch tip on the remote.
                  </span>
                </span>
              </label>
            </fieldset>

            {mode === "new" && (
              <div className="mt-3">
                <label
                  htmlFor="newBranch"
                  className="block text-sm font-medium"
                >
                  New branch name
                </label>
                <input
                  id="newBranch"
                  value={newBranch}
                  onChange={(e) => setNewBranch(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-slate-500"
                  placeholder="recovered-branch"
                />
              </div>
            )}

            <p className="mt-4 text-sm text-slate-600">
              Type{" "}
              <code className="rounded bg-slate-200 px-1">{expectedConfirm}</code>{" "}
              to confirm.
            </p>
            <input
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
              placeholder={expectedConfirm}
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={closeRecover}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={runRestore}
                disabled={!canRestore}
                className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                  mode === "inplace" ? "bg-amber-600" : "bg-emerald-600"
                }`}
              >
                {mode === "new" ? "Create branch" : "Force-update branch"}
              </button>
            </div>
          </div>
        </div>
      )}

      {result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
            <div className="border-b border-slate-100 px-6 py-4">
              <h3 className="text-lg font-semibold text-emerald-700">
                Branch recovered
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                {result.mode === "new"
                  ? "A new branch now points at the recovered commit."
                  : "The branch was force-updated to the recovered commit."}
              </p>
            </div>
            <div className="px-6 py-4 text-sm">
              <p>
                <span className="text-slate-500">Ref:</span>{" "}
                <span className="font-mono">{result.ref}</span>
              </p>
              <p className="mt-1">
                <span className="text-slate-500">Commit:</span>{" "}
                <span className="font-mono">{shortSha(result.sha)}</span>
              </p>
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-blue-600 underline hover:text-blue-800"
              >
                Open on GitHub
              </a>
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
    </main>
  );
}
