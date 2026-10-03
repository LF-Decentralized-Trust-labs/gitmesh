import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { auditLogApi } from "../../api/audit-log";
import { agentsApi } from "../../api/agents";
import { issuesApi } from "../../api/issues";
import { subprojectsApi } from "../../api/subprojects";
import { milestonesApi } from "../../api/milestones";
import {
  attestationsApi,
  type AttestationStatusBulkResponse,
} from "../../api/attestations";
import { useProject } from "../../context/ProjectContext";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { queryKeys } from "../../lib/queryKeys";
import { ActivityRow } from "../../components/ActivityRow";
import { PageSkeleton } from "../../components/PageSkeleton";
import { cn } from "../../lib/utils";
import { useNavigate } from "@/lib/router";
import type { Agent, ActivityEvent } from "@gitmesh/core";

// ─── Filter taxonomy ────────────────────────────────────────────────────────
//
// The Ledger uses a tag-style filter pill bar. Multiple pills can be active
// across categories (logical AND across categories, OR within a category).

type OutcomeKey = "allowed" | "blocked" | "pending";
const OUTCOME_KEYS: OutcomeKey[] = ["allowed", "blocked", "pending"];

const ENTITY_KEYS = [
  "agent_policy",
  "issue",
  "agent",
  "heartbeat_run",
] as const;
type EntityKey = (typeof ENTITY_KEYS)[number];

type GroupMode = "none" | "hour" | "day";

// ─── Helpers ───────────────────────────────────────────────────────────────

function eventOutcomeKey(e: ActivityEvent): OutcomeKey | null {
  if (e.policyOutcome === "allowed") return "allowed";
  if (e.policyOutcome === "blocked") return "blocked";
  if (e.policyOutcome === "require_approval") return "pending";
  return null;
}

function verdictColorVar(e: ActivityEvent): string {
  switch (e.policyOutcome) {
    case "allowed":
      return "var(--verdict-allow)";
    case "blocked":
      return "var(--verdict-block)";
    case "require_approval":
      return "var(--verdict-pending)";
    default:
      return "var(--verdict-attested)";
  }
}

function bucketKey(date: Date, mode: GroupMode): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  if (mode === "day") return `${y}-${m}-${d}`;
  if (mode === "hour") {
    const h = String(date.getUTCHours()).padStart(2, "0");
    return `${y}-${m}-${d} · ${h}h`;
  }
  return "";
}

// ─── Page ──────────────────────────────────────────────────────────────────

export function AuditLog() {
  const { selectedProjectId } = useProject();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();

  // NOTE: All hooks must be called unconditionally - see rules-of-hooks.
  // Early returns live below the hook block; new useState/useMemo/useEffect
  // additions must go *above* the early-return guards.
  const [activeOutcomes, setActiveOutcomes] = useState<Set<OutcomeKey>>(new Set());
  const [activeEntities, setActiveEntities] = useState<Set<EntityKey>>(new Set());
  const [groupMode, setGroupMode] = useState<GroupMode>("none");
  const [filterText, setFilterText] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const rowsContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Ledger" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.auditLog(selectedProjectId!),
    queryFn: () => auditLogApi.list(selectedProjectId!),
    enabled: !!selectedProjectId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedProjectId!),
    queryFn: () => agentsApi.list(selectedProjectId!),
    enabled: !!selectedProjectId,
  });

  const { data: issues } = useQuery({
    queryKey: queryKeys.issues.list(selectedProjectId!),
    queryFn: () => issuesApi.list(selectedProjectId!),
    enabled: !!selectedProjectId,
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.subprojects.list(selectedProjectId!),
    queryFn: () => subprojectsApi.list(selectedProjectId!),
    enabled: !!selectedProjectId,
  });

  const { data: goals } = useQuery({
    queryKey: queryKeys.milestones.list(selectedProjectId!),
    queryFn: () => milestonesApi.list(selectedProjectId!),
    enabled: !!selectedProjectId,
  });

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  const entityNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? []) map.set(`issue:${i.id}`, i.identifier ?? i.id.slice(0, 8));
    for (const a of agents ?? []) map.set(`agent:${a.id}`, a.name);
    for (const p of projects ?? []) map.set(`project:${p.id}`, p.name);
    for (const g of goals ?? []) map.set(`goal:${g.id}`, g.title);
    return map;
  }, [issues, agents, projects, goals]);

  const entityTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? []) map.set(`issue:${i.id}`, i.title);
    return map;
  }, [issues]);

  // Bulk attestation status for everything currently in the ledger. One
  // request replaces the per-row 404 fan-out the old useQueries call did.
  const auditEventIds = useMemo(
    () => (data ?? []).map((e) => e.id).filter((id): id is string => Boolean(id)),
    [data],
  );

  const { data: attestationStatuses } = useQuery<AttestationStatusBulkResponse>({
    queryKey: ["attestation-status", selectedProjectId, auditEventIds],
    queryFn: () => attestationsApi.bulkStatus(selectedProjectId!, auditEventIds),
    enabled: Boolean(selectedProjectId) && auditEventIds.length > 0,
    staleTime: 30_000,
  });

  const attestationCounts = useMemo(() => {
    const counts = { attested: 0, pending: 0, missing: 0 };
    if (!attestationStatuses) return counts;
    for (const status of Object.values(attestationStatuses.statuses)) {
      counts[status] += 1;
    }
    return counts;
  }, [attestationStatuses]);

  // Outcome counts (policy outcomes only). Attested-only rows have
  // policyOutcome === null and don't appear in any of these.
  const outcomeCounts = useMemo(() => {
    const c: Record<OutcomeKey, number> = { allowed: 0, blocked: 0, pending: 0 };
    for (const e of data ?? []) {
      const k = eventOutcomeKey(e);
      if (k) c[k] += 1;
    }
    return c;
  }, [data]);

  const entityCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of data ?? []) c[e.entityType] = (c[e.entityType] ?? 0) + 1;
    return c;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return null;
    const q = filterText.trim().toLowerCase();
    return data
      .filter((e) => {
        // Outcome filter (OR within category)
        if (activeOutcomes.size > 0) {
          const k = eventOutcomeKey(e);
          if (!k || !activeOutcomes.has(k)) return false;
        }
        // Entity filter (OR within category)
        if (activeEntities.size > 0) {
          if (!activeEntities.has(e.entityType as EntityKey)) return false;
        }
        // Free-text filter (substring across action / entityType / id)
        if (q) {
          const hay = `${e.action} ${e.entityType} ${e.entityId} ${e.actorId}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  }, [data, activeOutcomes, activeEntities, filterText]);

  // Grouped buckets (only when groupMode !== 'none').
  const grouped = useMemo(() => {
    if (!filtered || groupMode === "none") return null;
    const groups: { key: string; events: ActivityEvent[] }[] = [];
    const indexByKey = new Map<string, number>();
    for (const e of filtered) {
      const key = bucketKey(new Date(e.createdAt), groupMode);
      let idx = indexByKey.get(key);
      if (idx === undefined) {
        idx = groups.length;
        indexByKey.set(key, idx);
        groups.push({ key, events: [] });
      }
      groups[idx].events.push(e);
    }
    return groups;
  }, [filtered, groupMode]);

  // Reset focus when filter set changes.
  useEffect(() => {
    setFocusIndex(0);
  }, [activeOutcomes, activeEntities, filterText, groupMode]);

  // Build link target for `Enter` key.
  const eventHref = useCallback((e: ActivityEvent): string | null => {
    switch (e.entityType) {
      case "issue":
        return `/issues/${entityNameMap.get(`issue:${e.entityId}`) ?? e.entityId}`;
      case "agent":
        return `/agents/${e.entityId}`;
      case "project":
        return `/projects/${e.entityId}`;
      case "goal":
        return `/milestones/${e.entityId}`;
      case "approval":
        return `/approvals/${e.entityId}`;
      default:
        return null;
    }
  }, [entityNameMap]);

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const tgt = ev.target as HTMLElement | null;
      const inField =
        tgt &&
        (tgt.tagName === "INPUT" ||
          tgt.tagName === "TEXTAREA" ||
          tgt.isContentEditable);
      if (ev.key === "/" && !inField) {
        ev.preventDefault();
        filterInputRef.current?.focus();
        return;
      }
      if (inField) return;
      if (!filtered || filtered.length === 0) return;
      if (ev.key === "j" || ev.key === "ArrowDown") {
        ev.preventDefault();
        setFocusIndex((i) => Math.min(filtered.length - 1, i + 1));
      } else if (ev.key === "k" || ev.key === "ArrowUp") {
        ev.preventDefault();
        setFocusIndex((i) => Math.max(0, i - 1));
      } else if (ev.key === "Enter") {
        const e = filtered[focusIndex];
        if (!e) return;
        const href = eventHref(e);
        if (href) {
          ev.preventDefault();
          navigate(href);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, focusIndex, navigate, eventHref]);

  // Scroll focused row into view.
  useEffect(() => {
    const root = rowsContainerRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-row-index="${focusIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [focusIndex]);

  // ─── Render guards (after every hook above) ────────────────────────────
  if (!selectedProjectId) {
    return (
      <div className="font-mono text-xs text-text-tertiary">
        ledger empty · select a project
      </div>
    );
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  const totalEvents = data?.length ?? 0;
  const showing = filtered?.length ?? 0;

  const togglePill = <T,>(set: Set<T>, key: T, setter: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };

  // Pill renderer - mono, no rounded chips, no ring; underline-on-active.
  const Pill = ({
    label,
    count,
    active,
    onClick,
    accentVar,
  }: {
    label: string;
    count?: number;
    active: boolean;
    onClick: () => void;
    accentVar?: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "font-mono text-[11px] leading-none px-1.5 py-1 transition-colors cursor-pointer",
        "border-b",
        active
          ? "text-foreground border-current"
          : "text-text-tertiary border-transparent hover:text-foreground",
      )}
      style={active && accentVar ? { color: accentVar, borderColor: accentVar } : undefined}
    >
      {label}
      {typeof count === "number" && (
        <span className="ml-1 opacity-60">{count}</span>
      )}
    </button>
  );

  const renderRow = (event: ActivityEvent, index: number) => {
    const isFocused = index === focusIndex;
    return (
      <div
        key={event.id}
        data-row-index={index}
        onMouseEnter={() => setFocusIndex(index)}
        className={cn(
          "group relative flex items-center gap-2 pl-3 pr-2 border-b border-border",
          "h-6 min-h-6 overflow-hidden",
          isFocused && "bg-accent/30",
        )}
      >
        <span
          aria-hidden
          className="absolute left-0 top-0 bottom-0 w-[2px]"
          style={{ background: verdictColorVar(event) }}
        />
        <div className="flex-1 min-w-0 [&>div]:py-0 [&>div]:gap-2 [&_.text-sm]:text-xs [&_.text-sm]:font-mono [&_.text-sm]:truncate">
          <ActivityRow
            event={event}
            agentMap={agentMap}
            entityNameMap={entityNameMap}
            entityTitleMap={entityTitleMap}
            attestationStatus={attestationStatuses?.statuses[event.id]}
            className="!py-0"
          />
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3 font-mono">
      {/* Top strip - single mono line, three regions. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] leading-none border-b border-border pb-3">
        {/* Title + counts */}
        <div className="flex items-center gap-3">
          <span className="text-foreground">
            ledger
            <span className="text-text-tertiary"> · </span>
            <span className="tabular-nums">{totalEvents}</span> events
            {showing !== totalEvents && (
              <>
                <span className="text-text-tertiary"> · </span>
                <span className="tabular-nums">{showing}</span> shown
              </>
            )}
          </span>
          <span className="text-text-tertiary">
            <span style={{ color: "var(--verdict-attested)" }}>
              attested: <span className="tabular-nums">{attestationCounts.attested}</span>
            </span>
            <span> · </span>
            <span style={{ color: "var(--verdict-pending)" }}>
              pending: <span className="tabular-nums">{attestationCounts.pending}</span>
            </span>
            <span> · </span>
            <span className="opacity-60">
              missing: <span className="tabular-nums">{attestationCounts.missing}</span>
            </span>
          </span>
        </div>

        <div className="flex-1" />

        {selectedProjectId && (
          <span className="flex items-center gap-2 text-text-tertiary">
            export
            <a
              className="underline hover:text-foreground"
              href={auditLogApi.exportUrl(selectedProjectId, "json")}
            >
              json
            </a>
            <span>·</span>
            <a
              className="underline hover:text-foreground"
              href={auditLogApi.exportUrl(selectedProjectId, "csv")}
            >
              csv
            </a>
          </span>
        )}

        {/* Verifiability strip - informational, single line, top-right. */}
        <span className="text-text-tertiary">
          every signed row is verifiable - click the shield to copy a verify command.
        </span>
      </div>

      {/* Filter strip - mono input + tag-style pills. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] leading-none">
        <div className="flex items-center gap-1.5">
          <span className="text-text-tertiary">&gt;</span>
          <input
            ref={filterInputRef}
            value={filterText}
            onChange={(ev) => setFilterText(ev.target.value)}
            placeholder="filter ..."
            className={cn(
              "bg-transparent border-0 outline-none font-mono text-[11px]",
              "placeholder:text-text-tertiary text-foreground",
              "w-40 focus:w-56 transition-[width] py-1",
              "border-b border-border focus:border-foreground",
            )}
            aria-label="filter ledger"
          />
        </div>

        <span className="text-text-tertiary">|</span>

        {OUTCOME_KEYS.map((k) => {
          const accent =
            k === "allowed"
              ? "var(--verdict-allow)"
              : k === "blocked"
                ? "var(--verdict-block)"
                : "var(--verdict-pending)";
          return (
            <Pill
              key={k}
              label={`outcome:${k}`}
              count={outcomeCounts[k]}
              active={activeOutcomes.has(k)}
              accentVar={accent}
              onClick={() => togglePill(activeOutcomes, k, setActiveOutcomes)}
            />
          );
        })}

        <span className="text-text-tertiary">|</span>

        {ENTITY_KEYS.map((k) => (
          <Pill
            key={k}
            label={`entity:${k}`}
            count={entityCounts[k]}
            active={activeEntities.has(k)}
            onClick={() => togglePill(activeEntities, k, setActiveEntities)}
          />
        ))}

        <span className="text-text-tertiary">|</span>

        {(["none", "hour", "day"] as GroupMode[]).map((g) => (
          <Pill
            key={g}
            label={`group:${g}`}
            active={groupMode === g}
            onClick={() => setGroupMode(g)}
          />
        ))}
      </div>

      {error && (
        <p className="text-[11px] text-destructive font-mono">{error.message}</p>
      )}

      {/* Hairline-row event stream - NO card wrapper. */}
      <div ref={rowsContainerRef} className="border-t border-border">
        {filtered && filtered.length === 0 && (
          <div className="py-6 text-[11px] text-text-tertiary font-mono">
            ledger empty · no events
          </div>
        )}

        {filtered && filtered.length > 0 && groupMode === "none" && (
          <>{filtered.map((e, i) => renderRow(e, i))}</>
        )}

        {filtered &&
          filtered.length > 0 &&
          groupMode !== "none" &&
          grouped &&
          (() => {
            let runningIndex = 0;
            return grouped.map((bucket) => (
              <div key={bucket.key}>
                <div className="px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-text-tertiary border-b border-border bg-muted/20">
                  {bucket.key} · {bucket.events.length} events
                </div>
                {bucket.events.map((e) => {
                  const idx = runningIndex++;
                  return renderRow(e, idx);
                })}
              </div>
            ));
          })()}
      </div>

      {/* Footer keyboard hint. */}
      <div className="text-[10px] text-text-tertiary font-mono pt-1">
        j/k · ↵ open · / filter
      </div>
    </div>
  );
}
