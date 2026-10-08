"use client";

import { createContext, useContext } from "react";
import type { ClientSummary, PassportEntry } from "@/lib/types";

/** What canvas nodes need from the board, supplied by context so node components stay simple and stable. */
export interface CanvasUi {
  clients: ClientSummary[];
  passportByNode: Map<string, PassportEntry>;
  selectedChatId: string | null;
  onSelectChat: (id: string) => void;
  update: (id: string, patch: { title?: string; text?: string }) => void;
  remove: (id: string) => void;
  /** Menu-based alternative to dragging a connection. */
  connect: (fromId: string, toId: string) => void;
  connectedTo: (chatId: string) => string[];
  isConnected: (a: string, b: string) => boolean;
  chatNodes: { id: string; title: string }[];
  /** Every non-chat node, for the chat node's own "connect a node" menu. */
  connectableNodes: { id: string; label: string }[];
  toggleSharing: (clientId: string, next: { performancePatterns: boolean; creativeAssets: boolean }) => void;
  sharingBusy: boolean;
  labelOf: (nodeId: string) => string;
}

const Context = createContext<CanvasUi | null>(null);
export const CanvasUiProvider = Context.Provider;
export function useCanvasUi(): CanvasUi {
  const value = useContext(Context);
  if (!value) throw new Error("useCanvasUi must be used inside the canvas board.");
  return value;
}
