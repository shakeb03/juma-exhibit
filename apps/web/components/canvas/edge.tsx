"use client";

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { Lock } from "lucide-react";
import { useCanvasUi } from "./ui-context";

export interface PassportEdgeData extends Record<string, unknown> {
  label?: string;
  /** What flows through this connection, from the data passport. */
  status?: "approved" | "partial" | "restricted" | "explicit";
  shared?: number;
  nodeId?: string;
  onLabel?: (id: string, label: string) => void;
  onOpenPassport?: () => void;
}

const STROKE = { approved: "#075e61", explicit: "#075e61", partial: "#79500a", restricted: "#aa3434" } as const;

/**
 * A connection that says what flows through it. Approved information draws solid; a restricted client draws dashed
 * with a lock and "0 fields shared". Connecting never grants access, and the line says so literally.
 */
export function PassportEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected } = props;
  const data = (props.data ?? {}) as PassportEdgeData;
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const status = data.status ?? "approved";
  const restricted = status === "restricted";
  const ui = useCanvasUi();
  void ui;

  const chip =
    restricted ? "0 fields shared"
    : status === "partial" ? `${data.shared ?? 0} shared · partial`
    : status === "explicit" ? "your text"
    : `${data.shared ?? 0} shared`;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{ stroke: STROKE[status], strokeWidth: selected ? 3 : 2, strokeDasharray: restricted ? "7 5" : status === "partial" ? "2 4" : undefined }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
          style={{ left: labelX, top: labelY }}
        >
          <button
            type="button"
            onClick={() => data.onOpenPassport?.()}
            title="See what flows through this connection"
            className={`flex min-h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-medium ${restricted ? "border-danger/50 bg-danger-bg text-danger" : status === "partial" ? "border-amber-dark/40 bg-amber-light text-amber-dark" : "border-teal/30 bg-aqua text-teal"}`}
          >
            {restricted && <Lock size={11} aria-hidden />} {chip}
          </button>
          {(selected || data.label) && (
            <input
              aria-label="What to compare or combine"
              value={data.label ?? ""}
              placeholder="Compare visual styles"
              maxLength={200}
              onChange={(e) => data.onLabel?.(id, e.target.value)}
              className="w-44 rounded border border-border-strong bg-surface px-2 py-0.5 text-center text-[11px] placeholder:text-text-muted"
            />
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
