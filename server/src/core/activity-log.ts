import type { Db } from "@gitmesh/data";
import { activityLog } from "@gitmesh/data";
import { publishLiveEvent } from "./live-events.js";
import { sanitizeRecord } from "../redaction.js";
import { attestationService } from "./attestation.js";

export interface LogActivityInput {
  projectId: string;
  actorType: "agent" | "user" | "system";
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  agentId?: string | null;
  runId?: string | null;
  details?: Record<string, unknown> | null;
  policyVersion?: number | null;
  policyOutcome?: string | null;
}

export async function logActivity(db: Db, input: LogActivityInput) {
  const sanitizedDetails = input.details ? sanitizeRecord(input.details) : null;
  const policyVersion = input.policyVersion ?? readPolicyVersion(sanitizedDetails);
  const policyOutcome = input.policyOutcome ?? readPolicyOutcome(sanitizedDetails);
  const inserted = await db
    .insert(activityLog)
    .values({
      projectId: input.projectId,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      agentId: input.agentId ?? null,
      runId: input.runId ?? null,
      details: sanitizedDetails,
      policyVersion,
      policyOutcome,
    })
    .returning({ id: activityLog.id });

  const activityId = inserted[0]?.id;

  // Fire-and-forget enqueue for attestation. Failures here must not
  // block the audit-log insert path; the worker will retry from the
  // queue table or skip after maxAttempts.
  if (activityId) {
    try {
      await attestationService(db).queueSign({
        activityId,
        projectId: input.projectId,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        "[activity-log] failed to enqueue attestation:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  publishLiveEvent({
    projectId: input.projectId,
    type: "activity.logged",
    payload: {
      activityId: activityId ?? null,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      agentId: input.agentId ?? null,
      runId: input.runId ?? null,
      details: sanitizedDetails,
      policyVersion,
      policyOutcome,
    },
  });
}

function readPolicyVersion(details: Record<string, unknown> | null): number | null {
  const value = details?.policyVersion;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function readPolicyOutcome(details: Record<string, unknown> | null): string | null {
  const value = details?.policyOutcome;
  return typeof value === "string" && value.length > 0 ? value : null;
}
