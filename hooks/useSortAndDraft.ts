"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
import { isAbort, postJson } from "@/lib/client/api";
import type { Intent } from "@/lib/intents";
import { REQUEST_LIMITS } from "@/lib/limits";
import type { Action } from "@/lib/review-state";
import { ClassifyResponseSchema, DraftResponseSchema, type Classification, type Message, type Mode } from "@/lib/schema";

export type Stage = { label: string; done: number; total: number };

const chunk = <T,>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

const describe = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

// Runs sorting and then drafting in small requests, so each serverless call stays short
// and the progress bar moves. Partial results are kept: if sorting stops partway, the
// sorted messages are reviewed; if drafting stops, the rest get template replies.
export function useSortAndDraft(dispatch: Dispatch<Action>) {
  const [stage, setStage] = useState<Stage | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const cancel = useCallback(() => controller.current?.abort(), []);

  const run = useCallback(
    async (messages: Message[], mode: Mode, inputProblems: string[] = []) => {
      controller.current?.abort();
      const ctl = new AbortController();
      controller.current = ctl;
      const notes: string[] = [];
      const problems = [...inputProblems];
      dispatch({ type: "start", messages });
      setErrors(problems);
      setWarnings([]);
      const started = performance.now();

      // 1. Sort
      const classes = new Map<string, Classification>();
      let info: { method: "llm" | "keyword"; promptVersion?: string } = { method: "keyword" };
      // Each chunk is its own request and may be answered by a different model after a
      // failover, so the run reports every model that answered, not just the last one.
      const models = new Set<string>();
      try {
        for (const part of chunk(messages, REQUEST_LIMITS.classifyMessagesMax)) {
          setStage({ label: "Sorting", done: classes.size, total: messages.length });
          const data = await postJson("/api/classify", { messages: part, mode }, ClassifyResponseSchema, ctl.signal);
          for (const c of data.classifications) classes.set(c.id, c);
          dispatch({ type: "classified", classifications: data.classifications });
          notes.push(...data.warnings);
          info = { method: data.method, promptVersion: data.promptVersion };
          for (const m of data.model?.split(" + ") ?? []) if (m !== "no model answered") models.add(m);
        }
      } catch (e) {
        const left = messages.length - classes.size;
        problems.push(isAbort(e) ? `Stopped. ${left} message${left === 1 ? " was" : "s were"} left unsorted.` : `Sorting stopped: ${describe(e)} ${left} message${left === 1 ? " was" : "s were"} left out.`);
      }

      if (!classes.size) {
        dispatch({ type: "reset" });
        setErrors(problems);
        setStage(null);
        return;
      }
      dispatch({ type: "dropUnsorted" });
      const model = models.size ? [...models].join(" + ") : info.method === "llm" ? "no model answered" : undefined;
      dispatch({ type: "sorted", run: { ...info, model, seconds: (performance.now() - started) / 1000 } });

      // 2. Draft. Sorted results are already on screen, so a failure here loses nothing.
      const sorted = messages.filter((m) => classes.has(m.id));
      const drafted = new Set<string>();
      try {
        for (const part of chunk(sorted, REQUEST_LIMITS.draftItemsMax)) {
          setStage({ label: "Drafting replies", done: drafted.size, total: sorted.length });
          const items = part.map((message) => ({ message, classification: classes.get(message.id)! }));
          const sentIntents: Record<string, Intent> = Object.fromEntries(items.map((it) => [it.message.id, it.classification.intent]));
          const data = await postJson("/api/draft", { items, mode }, DraftResponseSchema, ctl.signal);
          dispatch({ type: "drafted", drafts: data.drafts, sentIntents, reviewer: data.reviewerModel });
          for (const d of data.drafts) drafted.add(d.id);
          notes.push(...data.warnings);
        }
      } catch (e) {
        const rest = sorted.map((m) => m.id).filter((id) => !drafted.has(id));
        dispatch({ type: "useTemplates", ids: rest });
        problems.push(`${isAbort(e) ? "Stopped." : `Drafting stopped: ${describe(e)}`} ${rest.length} message${rest.length === 1 ? " got a template" : "s got templates"} instead.`);
      } finally {
        if (controller.current === ctl) controller.current = null;
        setStage(null);
        setErrors(problems);
        setWarnings([...new Set(notes)]);
      }
    },
    [dispatch],
  );

  return { stage, errors, warnings, run, cancel, setErrors };
}
