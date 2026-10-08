"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type {
  ArtifactSummary, ArtifactVersionView, ClientProfile, ClientSummary, ConversationView, ExecutionEventView, ExecutionView,
  SourcePreview, SourceSummary,
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
    onSuccess: () => client.invalidateQueries({ queryKey: ["clients"] }),
  });
}
