"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Metric } from "@/lib/types";

interface EvidenceTarget {
  metric: Metric;
  trigger: HTMLElement | null;
}

interface WorkspaceState {
  /** Files attached to the next request. They add explicit context and grant nothing. */
  attachments: string[];
  addAttachment: (sourceId: string) => void;
  removeAttachment: (sourceId: string) => void;
  clearAttachments: () => void;
  /** The run shown in the sidebar overview. Survives navigation within the app. */
  activeExecutionId: string | null;
  setActiveExecutionId: (id: string | null) => void;
  evidence: EvidenceTarget | null;
  openEvidence: (metric: Metric, trigger: HTMLElement | null) => void;
  closeEvidence: () => void;
  /** Suggestions only fill the composer; the user decides when to send. */
  pendingFill: string | null;
  fillComposer: (text: string) => void;
  clearFill: () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  /** X-ray overlays where every claim came from: metric IDs, checks, and the models involved. */
  xray: boolean;
  setXray: (on: boolean) => void;
  /** The geek panel: a layer above the workspace that shows what happened under the hood for a turn. */
  geek: { open: boolean; executionId: string | null; tab: "run" | "code"; trigger: HTMLElement | null };
  openGeek: (executionId: string | null, options?: { tab?: "run" | "code"; trigger?: HTMLElement | null }) => void;
  closeGeek: () => void;
  setGeekExecution: (executionId: string) => void;
  setGeekTab: (tab: "run" | "code") => void;
  /** Turns of the conversation being viewed, for previous and next controls inside the panel. */
  geekTurns: { executionId: string; seq: number; label: string }[];
  setGeekTurns: (turns: { executionId: string; seq: number; label: string }[]) => void;
}

const Context = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [attachments, setAttachments] = useState<string[]>([]);
  const [activeExecutionId, setActiveExecutionId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<EvidenceTarget | null>(null);
  const [pendingFill, setPendingFill] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [xray, setXray] = useState(false);
  const [geek, setGeek] = useState<WorkspaceState["geek"]>({ open: false, executionId: null, tab: "run", trigger: null });
  const [geekTurns, setGeekTurns] = useState<WorkspaceState["geekTurns"]>([]);

  // Callbacks are stable, so effects that depend on them do not re-run on every state change.
  const addAttachment = useCallback((id: string) => setAttachments((list) => (list.includes(id) || list.length >= 5 ? list : [...list, id])), []);
  const removeAttachment = useCallback((id: string) => setAttachments((list) => (list.includes(id) ? list.filter((x) => x !== id) : list)), []);
  const clearAttachments = useCallback(() => setAttachments((list) => (list.length === 0 ? list : [])), []);
  const openEvidence = useCallback((metric: Metric, trigger: HTMLElement | null) => setEvidence({ metric, trigger }), []);
  const closeEvidence = useCallback(() => setEvidence(null), []);
  const clearFill = useCallback(() => setPendingFill(null), []);
  const openGeek = useCallback<WorkspaceState["openGeek"]>(
    (executionId, options) => setGeek({ open: true, executionId, tab: options?.tab ?? "run", trigger: options?.trigger ?? null }),
    [],
  );
  const closeGeek = useCallback(() => setGeek((g) => ({ ...g, open: false })), []);
  const setGeekExecution = useCallback((executionId: string) => setGeek((g) => ({ ...g, executionId })), []);
  const setGeekTab = useCallback((tab: "run" | "code") => setGeek((g) => ({ ...g, tab })), []);

  const value = useMemo<WorkspaceState>(
    () => ({
      attachments, addAttachment, removeAttachment, clearAttachments,
      activeExecutionId, setActiveExecutionId,
      evidence, openEvidence, closeEvidence,
      pendingFill, fillComposer: setPendingFill, clearFill,
      sidebarOpen, setSidebarOpen,
      xray, setXray,
      geek, openGeek, closeGeek, setGeekExecution, setGeekTab, geekTurns, setGeekTurns,
    }),
    [geek, openGeek, closeGeek, setGeekExecution, setGeekTab, geekTurns, xray, attachments, addAttachment, removeAttachment, clearAttachments, activeExecutionId, evidence, openEvidence, closeEvidence, pendingFill, clearFill, sidebarOpen],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const value = useContext(Context);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider.");
  return value;
}

/** Stable callback for components that only need to open the drawer. */
export function useOpenEvidence() {
  const { openEvidence } = useWorkspace();
  return useCallback((metric: Metric, trigger: HTMLElement | null) => openEvidence(metric, trigger), [openEvidence]);
}
