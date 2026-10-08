"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type {
  ArtifactSummary, ArtifactVersionView, ClientProfile, ClientSummary, ConversationView, ExecutionEventView, ExecutionView, ModelCallView,
  CanvasConversationView, CanvasState, ExecutionDetail, ModelPayload, PassportView, RepoFile, RepoTree, RepositoryMeta, SourcePreview, SourceSummary,
} from "./types";

export const useClients = () =>
  useQuery({ queryKey: ["clients"], queryFn: async () => (await api<{ clients: ClientSummary[] }>("/clients")).clients });

export const useSources = () =>
  useQuery({ queryKey: ["sources"], queryFn: async () => (await api<{ sources: SourceSummary[] }>("/sources")).sources });

export const useClientProfile = (clientId: string) =>
  useQuery({ queryKey: ["client", clientId], queryFn: () => api<ClientProfile>(`/clients/${clientId}`) });

export const useSourcePreview = (sourceId: string | null) =>
  useQuery({
    queryKey: ["source-preview", sourceId],
    queryFn: () => api<SourcePreview>(`/sources/${sourceId}/preview`),
    enabled: Boolean(sourceId),
    staleTime: Infinity,
  });

/** The conversation refreshes every two seconds while any turn is still running, then stops. */
export const useConversation = (clientId: string) =>
  useQuery({
    queryKey: ["conversation", clientId],
    queryFn: () => api<ConversationView>(`/clients/${clientId}/conversation`),
    refetchInterval: (query) => (query.state.data?.turns.some((t) => t.status === "queued" || t.status === "running") ? 2000 : false),
  });

export const useArtifactVersion = (versionId: string | null) =>
  useQuery({
    queryKey: ["artifact-version", versionId],
    queryFn: () => api<ArtifactVersionView>(`/artifact-versions/${versionId}`),
    enabled: Boolean(versionId),
    staleTime: Infinity, // versions never change once saved
  });

export const useArtifact = (artifactId: string | null, latestVersionId: string | null) =>
  useQuery({
    queryKey: ["artifact", artifactId, latestVersionId],
    queryFn: () => api<ArtifactSummary>(`/artifacts/${artifactId}`),
    enabled: Boolean(artifactId),
  });

export const useExecution = (executionId: string | null) =>
  useQuery({
    queryKey: ["execution", executionId],
    queryFn: () => api<ExecutionView>(`/executions/${executionId}`),
    enabled: Boolean(executionId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "succeeded" || status === "failed" || status === "cancelled" ? false : 1500;
    },
  });

/**
 * Progress events for one execution. Uses an ordered cursor, so each poll fetches only what is new,
 * and a refreshed page reconnects to the same run.
 */
export function useExecutionEvents(executionId: string | null, active: boolean) {
  const client = useQueryClient();
  return useQuery({
    queryKey: ["events", executionId],
    enabled: Boolean(executionId),
    refetchInterval: active ? 1500 : false,
    queryFn: async () => {
      const previous = client.getQueryData<{ events: ExecutionEventView[]; nextCursor: number; status: string }>(["events", executionId]);
      const cursor = previous?.nextCursor ?? 0;
      const fresh = await api<{ events: ExecutionEventView[]; nextCursor: number; status: string }>(`/executions/${executionId}/events?after=${cursor}`);
      return { status: fresh.status, nextCursor: fresh.nextCursor, events: [...(previous?.events ?? []), ...fresh.events] };
    },
  });
}

export function useSubmitTurn(clientId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { message: string; attachmentSourceIds: string[]; referencedVersionId?: string; key?: string }) =>
      api<{ turnId: string; executionId: string }>(`/clients/${clientId}/turns`, {
        method: "POST",
        idempotencyKey: input.key ?? crypto.randomUUID(),
        body: { message: input.message, attachmentSourceIds: input.attachmentSourceIds, referencedVersionId: input.referencedVersionId },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["conversation", clientId] }),
  });
}

export function useCancelExecution(clientId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (executionId: string) => api<{ status: string }>(`/executions/${executionId}/cancel`, { method: "POST", body: {} }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["conversation", clientId] }),
  });
}

export function useUpdateSharing() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { clientId: string; performancePatterns: boolean; creativeAssets: boolean }) =>
      api(`/clients/${input.clientId}/sharing`, { method: "PATCH", body: { performancePatterns: input.performancePatterns, creativeAssets: input.creativeAssets } }),
    // A sharing change alters what a chat may see, so the passport and any saved results are re-read.
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["clients"] });
      client.invalidateQueries({ queryKey: ["passport"] });
      client.invalidateQueries({ queryKey: ["canvas-conversation"] });
    },
  });
}

export const useModelCalls = (executionId: string | null, enabled = true) =>
  useQuery({
    queryKey: ["model-calls", executionId],
    queryFn: async () => (await api<{ calls: ModelCallView[] }>(`/executions/${executionId}/model-calls`)).calls,
    enabled: Boolean(executionId) && enabled,
    staleTime: 30_000,
  });

export const useExecutionDetail = (executionId: string | null) =>
  useQuery({
    queryKey: ["execution-detail", executionId],
    queryFn: () => api<ExecutionDetail>(`/executions/${executionId}/detail`),
    enabled: Boolean(executionId),
    staleTime: 10_000,
  });

export const useModelPayload = (callId: string | null) =>
  useQuery({
    queryKey: ["model-payload", callId],
    queryFn: () => api<ModelPayload>(`/model-calls/${callId}/payload`),
    enabled: Boolean(callId),
    staleTime: Infinity,
  });

export const useRepositoryMeta = (enabled: boolean) =>
  useQuery({ queryKey: ["repo-meta"], queryFn: () => api<RepositoryMeta>("/repository"), enabled, staleTime: 60_000 });

export const useFrontendCommit = (enabled: boolean) =>
  useQuery({
    queryKey: ["frontend-commit"],
    enabled,
    staleTime: Infinity,
    queryFn: async () => {
      const response = await fetch("/api/meta", { cache: "no-store" });
      return ((await response.json()) as { frontendCommit: string | null }).frontendCommit;
    },
  });

export const useRepoTree = (enabled: boolean) =>
  useQuery({ queryKey: ["repo-tree"], queryFn: () => api<RepoTree>("/repository/tree"), enabled, staleTime: 5 * 60_000, retry: false });

export const useRepoFile = (path: string | null, ref: string | null) =>
  useQuery({
    queryKey: ["repo-file", ref, path],
    queryFn: () => api<RepoFile>(`/repository/file?path=${encodeURIComponent(path!)}${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`),
    enabled: Boolean(path),
    staleTime: Infinity,
    retry: false,
  });

export const useCanvas = () => useQuery({ queryKey: ["canvas"], queryFn: () => api<CanvasState>("/canvas"), staleTime: Infinity, refetchOnMount: "always" });

export const usePassport = (chatNodeId: string | null, revision: number | null) =>
  useQuery({
    queryKey: ["passport", chatNodeId, revision],
    queryFn: () => api<PassportView>(`/canvas/passport?chatNodeId=${encodeURIComponent(chatNodeId!)}`),
    enabled: Boolean(chatNodeId) && revision !== null,
  });

export const useCanvasConversation = (nodeId: string | null) =>
  useQuery({
    queryKey: ["canvas-conversation", nodeId],
    queryFn: () => api<CanvasConversationView>(`/canvas/chats/${encodeURIComponent(nodeId!)}/conversation`),
    enabled: Boolean(nodeId),
    refetchInterval: (query) => (query.state.data?.turns.some((t) => t.status === "queued" || t.status === "running") ? 2000 : false),
  });

export function useSubmitCanvasTurn(nodeId: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { message: string; referencedVersionId?: string; key?: string }) =>
      api<{ turnId: string; executionId: string; canvasRevision: number }>(`/canvas/chats/${encodeURIComponent(nodeId!)}/turns`, {
        method: "POST",
        idempotencyKey: input.key ?? crypto.randomUUID(),
        body: { message: input.message, referencedVersionId: input.referencedVersionId },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["canvas-conversation", nodeId] }),
  });
}

export function useCancelCanvasExecution(nodeId: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (executionId: string) => api<{ status: string }>(`/executions/${executionId}/cancel`, { method: "POST", body: {} }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["canvas-conversation", nodeId] }),
  });
}
