"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Composer } from "@/components/Composer";
import { Results } from "@/components/Results";
import { useSortAndDraft } from "@/hooks/useSortAndDraft";
import { getConfig } from "@/lib/client/api";
import { storage } from "@/lib/client/browser";
import { CLIENT_LIMITS, STORAGE_KEYS } from "@/lib/limits";
import { parseInbox } from "@/lib/parse";
import { initialState, reducer } from "@/lib/review-state";
import { ModeSchema, type Mode } from "@/lib/schema";
import { parseSession, serializeSession } from "@/lib/session";

export default function Home() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { stage, errors, warnings, run, cancel, setErrors } = useSortAndDraft(dispatch);
  const [raw, setRaw] = useState("");
  const [mode, setMode] = useState<Mode>("auto");
  const [llmAvailable, setLlmAvailable] = useState<boolean | null>(null);
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const [storageFull, setStorageFull] = useState(false);
  const loaded = useRef(false);
  const busy = stage !== null;

  // Load settings and any saved review work once, on the client.
  useEffect(() => {
    const ctl = new AbortController();
    getConfig(ctl.signal).then((c) => setLlmAvailable(c.llmAvailable)).catch(() => setLlmAvailable(null));

    const savedMode = ModeSchema.safeParse(storage.get(STORAGE_KEYS.mode));
    if (savedMode.success) setMode(savedMode.data);
    dispatch({ type: "setRecruiter", name: storage.get(STORAGE_KEYS.recruiter) ?? "" });
    const session = parseSession(storage.get(STORAGE_KEYS.session));
    if (session) {
      const { savedAt, ...rest } = session;
      dispatch({ type: "restore", state: rest });
      setRestoredAt(savedAt);
    } else {
      // Unusable, expired or absent: make sure a bad copy can't break the next visit.
      storage.remove(STORAGE_KEYS.session);
    }
    loaded.current = true;
    return () => ctl.abort();
  }, []);

  // Save review work shortly after changes stop, never mid-run.
  useEffect(() => {
    if (!loaded.current || busy) return;
    const timer = setTimeout(() => {
      const serialized = serializeSession(state);
      if (serialized) setStorageFull(!storage.set(STORAGE_KEYS.session, serialized));
      storage.set(STORAGE_KEYS.recruiter, state.recruiter);
    }, CLIENT_LIMITS.sessionSaveDebounceMs);
    return () => clearTimeout(timer);
  }, [state, busy]);

  // Parsing runs on a deferred copy, so typing in a big paste stays responsive.
  const deferredRaw = useDeferredValue(raw);
  const parsed = useMemo(() => parseInbox(deferredRaw), [deferredRaw]);

  // If AI isn't configured on the server, don't leave the user on a mode that will fail.
  const effectiveMode: Mode = mode === "llm" && llmAvailable === false ? "auto" : mode;

  const changeMode = useCallback((m: Mode) => {
    setMode(m);
    storage.set(STORAGE_KEYS.mode, m);
  }, []);

  function startOver() {
    cancel();
    dispatch({ type: "reset" });
    storage.remove(STORAGE_KEYS.session);
    setRestoredAt(null);
    setErrors([]);
  }

  function onRun() {
    // Parse the current text, not the deferred copy, so a fast click can't use stale input.
    const now = parseInbox(raw);
    if (!now.messages.length) return;
    setRestoredAt(null);
    void run(now.messages, effectiveMode, now.errors.filter((e) => e !== "Input is empty."));
  }

  async function loadSample() {
    try {
      const res = await fetch("/sample-inbox.json", { cache: "force-cache" });
      if (!res.ok) throw new Error();
      setRaw(await res.text());
      setErrors([]);
    } catch {
      setErrors(["Couldn't load the sample inbox."]);
    }
  }

  const hasResults = state.run !== null && state.messages.length > 0;

  return (
    <main>
      <div className="container">
        <h1 className="page-title">Sort the inbox</h1>
        <p className="page-lead">
          Paste candidate messages or upload a file. They get grouped by what each person wants, each one gets a draft
          reply, and you approve or edit every reply. Nothing is ever sent automatically.
        </p>

        <Composer
          raw={raw}
          onRawChange={setRaw}
          parsed={parsed}
          mode={effectiveMode}
          onModeChange={changeMode}
          llmAvailable={llmAvailable}
          stage={stage}
          onRun={onRun}
          onCancel={cancel}
          onLoadSample={loadSample}
          onClear={() => {
            setRaw("");
            startOver();
          }}
          onError={(e) => setErrors([e])}
        />

        {errors.length > 0 && (
          <div className="alert alert-danger" role="alert">
            <strong>Something didn&apos;t work.</strong>
            <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="alert alert-warn" role="status">
            <ul style={{ marginLeft: 18 }}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}
        {storageFull && (
          <div className="alert alert-warn" role="status">
            This browser couldn&apos;t save your review progress. It will be lost if you reload the page.
          </div>
        )}
        {restoredAt && hasResults && (
          <div className="alert alert-warn restored" role="status">
            <span>
              Picked up where you left off (saved {new Date(restoredAt).toLocaleString()}). Saved work is kept in this
              browser for {CLIENT_LIMITS.sessionTtlMs / 86_400_000} days.
            </span>
            <button type="button" className="btn btn-sm" onClick={startOver}>Start over and delete it</button>
          </div>
        )}

        {hasResults ? (
          <Results state={state} dispatch={dispatch} busy={busy} />
        ) : (
          !busy && (
            <div className="empty">
              <h3>Nothing sorted yet</h3>
              <p>Load the sample inbox to see how it works, or paste your own messages.</p>
            </div>
          )
        )}
      </div>
    </main>
  );
}
