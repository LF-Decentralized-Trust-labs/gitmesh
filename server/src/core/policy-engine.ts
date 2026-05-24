/**
 * Policy Engine Service
 *
 * Evaluates governance policies for agent actions within a project.
 * Policies define rules about what agents can and cannot do, with
 * support for:
 *
 * 1. Action-based matching (glob patterns on action names)
 * 2. Conditional evaluation (role-based, branch-based, etc.)
 * 3. Multiple effects: allow, block, require_approval
 * 4. Priority-ordered evaluation with first-match semantics
 * 5. Audit trail integration (every evaluation is logged to activity_log)
 */

import { eq, and, asc } from "@gitmesh/data";
import type { Db } from "@gitmesh/data";
import { agentPolicies, agents } from "@gitmesh/data";
import {
  DEFAULT_POLICY_TEMPLATES,
  type PolicyEffect,
  type PolicyTemplate,
} from "./policy-default-templates.js";
import { getDefaultEnabledTemplates } from "./policy-templates-loader.js";
import { logActivity } from "./activity-log.js";

export { DEFAULT_POLICY_TEMPLATES };
export type { PolicyEffect, PolicyTemplate };

type OpaInstance = {
  setData?: (data: unknown) => void;
  evaluate?: (input: unknown) => unknown;
};

const opaPolicyCache = new Map<string, OpaInstance>();

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PolicyEvaluationInput {
  projectId: string;
  agentId: string;
  action: string;
  context?: Record<string, unknown>;
}

export interface PolicyEvaluationResult {
  effect: PolicyEffect;
  policyId: string | null;
  policyName: string | null;
  policyVersion: number | null;
  reason: string;
  effectConfig?: Record<string, unknown>;
}

// ─── Service Factory ─────────────────────────────────────────────────────────

export function policyEngineService(db: Db) {
  return {
    // ── Policy CRUD ────────────────────────────────────────────────────

    /**
     * List all policies for a project, ordered by priority.
     */
    async listPolicies(projectId: string) {
      return db
        .select()
        .from(agentPolicies)
        .where(eq(agentPolicies.projectId, projectId))
        .orderBy(asc(agentPolicies.priority));
    },

    /**
     * Get a single policy by ID.
     */
    async getPolicy(policyId: string) {
      const rows = await db
        .select()
        .from(agentPolicies)
        .where(eq(agentPolicies.id, policyId));
      return rows[0] ?? null;
    },

    /**
     * Create a new policy.
     */
    async createPolicy(
      projectId: string,
      data: {
        name: string;
        description?: string;
        actionPattern: string;
        conditions?: Record<string, unknown>;
        effect: PolicyEffect;
        effectConfig?: Record<string, unknown>;
        priority?: number;
        createdByUserId?: string;
      },
    ) {
      const rows = await db
        .insert(agentPolicies)
        .values({
          projectId,
          name: data.name,
          description: data.description ?? null,
          actionPattern: data.actionPattern,
          conditions: data.conditions ?? null,
          effect: data.effect,
          effectConfig: data.effectConfig ?? null,
          priority: data.priority ?? 100,
          createdByUserId: data.createdByUserId ?? null,
        })
        .returning();
      return rows[0];
    },

    /**
     * Update a policy. Creates a new version (bumps version number).
     */
    async updatePolicy(
      policyId: string,
      data: Partial<{
        name: string;
        description: string;
        actionPattern: string;
        conditions: Record<string, unknown>;
        effect: PolicyEffect;
        effectConfig: Record<string, unknown>;
        priority: number;
        enabled: boolean;
      }>,
    ) {
      const current = await db
        .select()
        .from(agentPolicies)
        .where(eq(agentPolicies.id, policyId));

      if (!current[0]) return null;

      const rows = await db
        .update(agentPolicies)
        .set({
          ...data,
          version: current[0].version + 1,
          updatedAt: new Date(),
        })
        .where(eq(agentPolicies.id, policyId))
        .returning();

      return rows[0] ?? null;
    },

    /**
     * Delete a policy.
     */
    async deletePolicy(policyId: string) {
      const rows = await db
        .delete(agentPolicies)
        .where(eq(agentPolicies.id, policyId))
        .returning();
      return rows[0] ?? null;
    },

    /**
     * Initialize default policies for a new project.
     *
     * Reads templates flagged `defaultEnabled: true` from
     * `playbooks/policy-templates/` if available, and falls back to the
     * legacy hardcoded `DEFAULT_POLICY_TEMPLATES` if the templates dir is
     * missing (e.g. in tests that don't mount the playbooks tree).
     */
    async initializeDefaults(projectId: string, createdByUserId?: string) {
      const existing = await db
        .select()
        .from(agentPolicies)
        .where(eq(agentPolicies.projectId, projectId));

      if (existing.length > 0) return; // Already initialized

      const filesystemTemplates = getDefaultEnabledTemplates();
      const seedRows: Array<{
        name: string;
        description: string | null;
        actionPattern: string;
        conditions: Record<string, unknown> | null;
        effect: PolicyEffect;
        effectConfig: Record<string, unknown> | null;
        priority: number;
      }> = [];

      if (filesystemTemplates.length > 0) {
        for (const tmpl of filesystemTemplates) {
          for (const policy of tmpl.policies) {
            seedRows.push({
              name: policy.name,
              description: policy.description ?? null,
              actionPattern: policy.actionPattern,
              conditions: policy.conditions,
              effect: policy.effect,
              effectConfig: policy.effectConfig,
              priority: policy.priority,
            });
          }
        }
      } else {
        for (const template of DEFAULT_POLICY_TEMPLATES) {
          seedRows.push({
            name: template.name,
            description: template.description,
            actionPattern: template.actionPattern,
            conditions: template.conditions,
            effect: template.effect,
            effectConfig: template.effectConfig,
            priority: template.priority,
          });
        }
      }

      for (const row of seedRows) {
        await db.insert(agentPolicies).values({
          projectId,
          name: row.name,
          description: row.description,
          actionPattern: row.actionPattern,
          conditions: row.conditions,
          effect: row.effect,
          effectConfig: row.effectConfig,
          priority: row.priority,
          createdByUserId: createdByUserId ?? null,
        });
      }
    },

    // ── Policy Evaluation ──────────────────────────────────────────────

    /**
     * Evaluate whether an agent action is allowed by the project's policies.
     * Uses first-match semantics: policies are evaluated in priority order,
     * and the first matching policy determines the outcome.
     *
     * If no policy matches, the default is to allow the action.
     */
    async evaluate(input: PolicyEvaluationInput): Promise<PolicyEvaluationResult> {
      // Load enabled policies ordered by priority
      const policies = await db
        .select()
        .from(agentPolicies)
        .where(
          and(
            eq(agentPolicies.projectId, input.projectId),
            eq(agentPolicies.enabled, true),
          ),
        )
        .orderBy(asc(agentPolicies.priority));

      // Load the agent's role for condition matching
      const agentRows = await db
        .select()
        .from(agents)
        .where(eq(agents.id, input.agentId));
      const agent = agentRows[0];
      const agentRole = agent?.role ?? "general";

      // Evaluate each policy in order
      for (const policy of policies) {
        const evaluationContext = {
          agentRole,
          ...input.context,
        };

        const opaMatched = await evaluateWithOptionalOpa(policy.effectConfig as Record<string, unknown> | null, {
          action: input.action,
          projectId: input.projectId,
          agentId: input.agentId,
          context: evaluationContext,
        });

        if (opaMatched === null) {
          if (!matchesAction(policy.actionPattern, input.action)) continue;
          if (!matchesConditions(policy.conditions as Record<string, unknown> | null, evaluationContext)) continue;
        } else if (!opaMatched) {
          continue;
        }

        const result: PolicyEvaluationResult = {
          effect: policy.effect as PolicyEffect,
          policyId: policy.id,
          policyName: policy.name,
          policyVersion: policy.version,
          reason: `Matched policy "${policy.name}" (v${policy.version})`,
          effectConfig: policy.effectConfig as Record<string, unknown> | undefined,
        };

        // Log the evaluation to activity_log
        await logPolicyEvaluation(db, input, result);

        return result;
      }

      // Default: allow if no policy matched
      const defaultResult: PolicyEvaluationResult = {
        effect: "allow",
        policyId: null,
        policyName: null,
        policyVersion: null,
        reason: "No matching policy found; action allowed by default",
      };

      await logPolicyEvaluation(db, input, defaultResult);

      return defaultResult;
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Check if an action matches a policy's action pattern.
 * Supports exact match and wildcard (*) patterns.
 */
function matchesAction(pattern: string, action: string): boolean {
  if (pattern === "*") return true;
  if (pattern === action) return true;

  // Simple glob: convert * to regex .*
  const regexStr = "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$";
  try {
    return new RegExp(regexStr).test(action);
  } catch {
    return false;
  }
}

/**
 * Check if conditions are met for a policy to apply.
 * Conditions are key-value pairs where the value is an array of acceptable values.
 * All conditions must match (AND logic).
 */
function matchesConditions(
  conditions: Record<string, unknown> | null,
  context: Record<string, unknown>,
): boolean {
  if (!conditions || Object.keys(conditions).length === 0) return true;

  for (const [key, allowedValues] of Object.entries(conditions)) {
    if (!Array.isArray(allowedValues)) continue;
    const actual = context[key];
    if (typeof actual !== "string") return false;

    const matched = allowedValues.some((v) => {
      if (typeof v !== "string") return false;
      if (v.includes("*")) {
        const regexStr = "^" + v.replace(/\*/g, ".*") + "$";
        try {
          return new RegExp(regexStr).test(actual);
        } catch {
          return false;
        }
      }
      return v === actual;
    });

    if (!matched) return false;
  }

  return true;
}

/**
 * Log a policy evaluation outcome to the activity log.
 */
async function logPolicyEvaluation(
  db: Db,
  input: PolicyEvaluationInput,
  result: PolicyEvaluationResult,
): Promise<void> {
  await logActivity(db, {
    projectId: input.projectId,
    actorType: "agent",
    actorId: input.agentId,
    action: input.action,
    entityType: "policy_evaluation",
    entityId: result.policyId ?? "default",
    agentId: input.agentId,
    details: {
      effect: result.effect,
      policyName: result.policyName,
      policyVersion: result.policyVersion,
      reason: result.reason,
      context: input.context ?? null,
    },
    policyVersion: result.policyVersion,
    policyOutcome: result.effect,
  });
}

async function evaluateWithOptionalOpa(
  effectConfig: Record<string, unknown> | null,
  input: {
    action: string;
    projectId: string;
    agentId: string;
    context: Record<string, unknown>;
  },
): Promise<boolean | null> {
  const opa = effectConfig && typeof effectConfig === "object"
    ? (effectConfig["opa"] as Record<string, unknown> | undefined)
    : undefined;
  const wasmBase64 = opa && typeof opa["wasmBase64"] === "string" ? opa["wasmBase64"] : null;
  if (!wasmBase64) return null;

  try {
    let policy = opaPolicyCache.get(wasmBase64);
    if (!policy) {
      const mod = await import("@open-policy-agent/opa-wasm");
      const loadPolicy =
        (mod as unknown as { loadPolicy?: (buf: Uint8Array) => Promise<OpaInstance> }).loadPolicy ??
        ((mod as unknown as { default?: { loadPolicy?: (buf: Uint8Array) => Promise<OpaInstance> } }).default?.loadPolicy);

      if (typeof loadPolicy !== "function") return null;
      const wasmBuffer = Buffer.from(wasmBase64, "base64");
      policy = await loadPolicy(wasmBuffer);
      if (!policy) return null;
      opaPolicyCache.set(wasmBase64, policy);
    }

    const data = opa && typeof opa["data"] === "object" ? opa["data"] : undefined;
    if (policy.setData && data) {
      policy.setData(data);
    }

    const queryInput = {
      action: input.action,
      projectId: input.projectId,
      agentId: input.agentId,
      ...input.context,
    };
    const rawResult = policy.evaluate ? policy.evaluate(queryInput) : null;
    return normalizeOpaDecision(rawResult);
  } catch {
    return null;
  }
}

function normalizeOpaDecision(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return false;
    const first = value[0];
    if (typeof first === "boolean") return first;
    if (typeof first === "object" && first !== null) {
      const obj = first as Record<string, unknown>;
      if (typeof obj.result === "boolean") return obj.result;
      if (typeof obj.allow === "boolean") return obj.allow;
      if (typeof obj.decision === "boolean") return obj.decision;
      if (typeof obj.value === "boolean") return obj.value;
    }
    return false;
  }
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.result === "boolean") return obj.result;
    if (typeof obj.allow === "boolean") return obj.allow;
    if (typeof obj.decision === "boolean") return obj.decision;
    if (typeof obj.value === "boolean") return obj.value;
  }
  return false;
}
