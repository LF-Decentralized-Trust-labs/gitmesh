/**
 * `approval` subcommands.
 *
 * Same spec-driven shape as `issue.ts`. Decision-style endpoints (approve /
 * reject / request-revision) collapse into a single internal helper because
 * the only thing that differs between them is the URL suffix and the schema
 * used to validate the body.
 */
import { Command } from "commander";
import {
  createApprovalSchema,
  requestApprovalRevisionSchema,
  resolveApprovalSchema,
  resubmitApprovalSchema,
  type Approval,
  type ApprovalComment,
} from "@gitmesh/core";
import {
  defineClientCommand,
  formatInlineRecord,
  printOutput,
  type ResolvedClientContext,
} from "../_shared/define.js";
import { buildQueryString, parseCsvOptional, parseJsonObject } from "../_shared/parse.js";
import type { BaseClientOptions } from "./common.js";
import type { z } from "zod";

interface ApprovalListOpts extends BaseClientOptions {
  status?: string;
}

interface ApprovalCreateOpts extends BaseClientOptions {
  type: string;
  requestedByAgentId?: string;
  payload: string;
  issueIds?: string;
}

interface ApprovalDecisionOpts extends BaseClientOptions {
  decisionNote?: string;
}

interface ApprovalResubmitOpts extends BaseClientOptions {
  payload?: string;
}

interface ApprovalCommentOpts extends BaseClientOptions {
  body: string;
}

// Decision endpoints share the exact same input options + a tiny URL suffix +
// a schema. Capturing that as a shape keeps the registration block flat.
type DecisionSchema = typeof resolveApprovalSchema | typeof requestApprovalRevisionSchema;
interface DecisionRoute {
  name: string;
  describe: string;
  endpoint: string; // path tail under /api/approvals/<id>/
  schema: DecisionSchema;
}

const DECISION_ROUTES: DecisionRoute[] = [
  {
    name: "approve",
    describe: "Approve an approval request",
    endpoint: "approve",
    schema: resolveApprovalSchema,
  },
  {
    name: "reject",
    describe: "Reject an approval request",
    endpoint: "reject",
    schema: resolveApprovalSchema,
  },
  {
    name: "request-revision",
    describe: "Request revision for an approval",
    endpoint: "request-revision",
    schema: requestApprovalRevisionSchema,
  },
];

function renderApprovalRow(row: Approval): string {
  return formatInlineRecord({
    id: row.id,
    type: row.type,
    status: row.status,
    requestedByAgentId: row.requestedByAgentId,
    requestedByUserId: row.requestedByUserId,
  });
}

async function runDecision(
  ctx: ResolvedClientContext,
  approvalId: string,
  options: ApprovalDecisionOpts,
  schema: z.ZodType,
  endpoint: string,
): Promise<void> {
  const payload = schema.parse({
    decisionNote: options.decisionNote,
  });
  const updated = await ctx.api.post<Approval>(
    `/api/approvals/${approvalId}/${endpoint}`,
    payload,
  );
  printOutput(updated, { json: ctx.json });
}

export function registerApprovalCommands(program: Command): void {
  const approval = program.command("approval").description("Approval operations");

  defineClientCommand<ApprovalListOpts>(approval, {
    name: "list",
    describe: "List approvals for a project",
    options: [
      { flag: "-P, --project-id <id>", desc: "Project ID", required: true },
      { flag: "--status <status>", desc: "Status filter" },
    ],
    requireProject: true,
    async run(ctx, { options }) {
      const path = `/api/projects/${ctx.projectId}/approvals${buildQueryString({
        status: options.status,
      })}`;
      const rows = (await ctx.api.get<Approval[]>(path)) ?? [];

      if (ctx.json) {
        printOutput(rows, { json: true });
        return;
      }
      if (rows.length === 0) {
        printOutput([], { json: false });
        return;
      }
      for (const row of rows) console.log(renderApprovalRow(row));
    },
  });

  defineClientCommand<BaseClientOptions>(approval, {
    name: "get",
    describe: "Get one approval",
    positional: [{ name: "approvalId", desc: "Approval ID" }],
    async run(ctx, { positional }) {
      const [approvalId] = positional;
      const row = await ctx.api.get<Approval>(`/api/approvals/${approvalId}`);
      printOutput(row, { json: ctx.json });
    },
  });

  defineClientCommand<ApprovalCreateOpts>(approval, {
    name: "create",
    describe: "Create an approval request",
    options: [
      { flag: "-P, --project-id <id>", desc: "Project ID", required: true },
      {
        flag: "--type <type>",
        desc: "Approval type (enable_agent|approve_admin_strategy)",
        required: true,
      },
      { flag: "--payload <json>", desc: "Approval payload as JSON object", required: true },
      { flag: "--requested-by-agent-id <id>", desc: "Requesting agent ID" },
      { flag: "--issue-ids <csv>", desc: "Comma-separated linked issue IDs" },
    ],
    requireProject: true,
    async run(ctx, { options }) {
      const payload = createApprovalSchema.parse({
        type: options.type,
        payload: parseJsonObject(options.payload, "payload"),
        requestedByAgentId: options.requestedByAgentId,
        issueIds: parseCsvOptional(options.issueIds),
      });
      const created = await ctx.api.post<Approval>(
        `/api/projects/${ctx.projectId}/approvals`,
        payload,
      );
      printOutput(created, { json: ctx.json });
    },
  });

  // Register approve/reject/request-revision in a loop — see DECISION_ROUTES.
  for (const route of DECISION_ROUTES) {
    defineClientCommand<ApprovalDecisionOpts>(approval, {
      name: route.name,
      describe: route.describe,
      positional: [{ name: "approvalId", desc: "Approval ID" }],
      options: [
        { flag: "--decision-note <text>", desc: "Decision note" },
      ],
      async run(ctx, { positional, options }) {
        const [approvalId] = positional;
        await runDecision(ctx, approvalId, options, route.schema, route.endpoint);
      },
    });
  }

  defineClientCommand<ApprovalResubmitOpts>(approval, {
    name: "resubmit",
    describe: "Resubmit an approval (optionally with new payload)",
    positional: [{ name: "approvalId", desc: "Approval ID" }],
    options: [{ flag: "--payload <json>", desc: "Payload JSON object" }],
    async run(ctx, { positional, options }) {
      const [approvalId] = positional;
      const payload = resubmitApprovalSchema.parse({
        payload: options.payload ? parseJsonObject(options.payload, "payload") : undefined,
      });
      const updated = await ctx.api.post<Approval>(
        `/api/approvals/${approvalId}/resubmit`,
        payload,
      );
      printOutput(updated, { json: ctx.json });
    },
  });

  defineClientCommand<ApprovalCommentOpts>(approval, {
    name: "comment",
    describe: "Add comment to an approval",
    positional: [{ name: "approvalId", desc: "Approval ID" }],
    options: [{ flag: "--body <text>", desc: "Comment body", required: true }],
    async run(ctx, { positional, options }) {
      const [approvalId] = positional;
      const created = await ctx.api.post<ApprovalComment>(
        `/api/approvals/${approvalId}/comments`,
        { body: options.body },
      );
      printOutput(created, { json: ctx.json });
    },
  });
}
