import type { ActivityEvent } from "@gitmesh/core";
import { api } from "./client";

export interface RunForIssue {
  runId: string;
  status: string;
  agentId: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  invocationSource: string;
  usageJson: Record<string, unknown> | null;
  resultJson: Record<string, unknown> | null;
}

export interface IssueForRun {
  issueId: string;
  identifier: string | null;
  title: string;
  status: string;
  priority: string;
}

export const auditLogApi = {
  list: (projectId: string) => api.get<ActivityEvent[]>(`/projects/${projectId}/audit-log`),
  forIssue: (issueId: string) => api.get<ActivityEvent[]>(`/issues/${issueId}/audit-log`),
  runsForIssue: (issueId: string) => api.get<RunForIssue[]>(`/issues/${issueId}/runs`),
  issuesForRun: (runId: string) => api.get<IssueForRun[]>(`/heartbeat-runs/${runId}/issues`),
  /** Download audit events with policyVersion / policyOutcome (#436). */
  exportUrl: (projectId: string, format: "json" | "csv" = "json") =>
    `/api/projects/${projectId}/audit-log/export?format=${format}`,
};
