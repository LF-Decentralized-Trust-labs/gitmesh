import type {
  AgentAdapterType,
  InstanceUserRole,
  InviteJoinType,
  InviteType,
  JoinRequestStatus,
  JoinRequestType,
  MembershipStatus,
  PermissionKey,
  PrincipalType,
} from "../constants.js";

export interface ProjectMembership {
  id: string;
  projectId: string;
  principalType: PrincipalType;
  principalId: string;
  status: MembershipStatus;
  membershipRole: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrincipalPermissionGrant {
  id: string;
  projectId: string;
  principalType: PrincipalType;
  principalId: string;
  permissionKey: PermissionKey;
  scope: Record<string, unknown> | null;
  grantedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Invite {
  id: string;
  projectId: string | null;
  inviteType: InviteType;
  tokenHash: string;
  allowedJoinTypes: InviteJoinType;
  defaultsPayload: Record<string, unknown> | null;
  expiresAt: Date;
  invitedByUserId: string | null;
  revokedAt: Date | null;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface JoinRequest {
  id: string;
  inviteId: string;
  projectId: string;
  requestType: JoinRequestType;
  status: JoinRequestStatus;
  requestIp: string;
  requestingUserId: string | null;
  requestEmailSnapshot: string | null;
  agentName: string | null;
  adapterType: AgentAdapterType | null;
  capabilities: string | null;
  agentDefaultsPayload: Record<string, unknown> | null;
  claimSecretExpiresAt: Date | null;
  claimSecretConsumedAt: Date | null;
  createdAgentId: string | null;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  rejectedByUserId: string | null;
  rejectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InstanceUserRoleGrant {
  id: string;
  userId: string;
  role: InstanceUserRole;
  createdAt: Date;
  updatedAt: Date;
}

export type Actor =
  | {
      type: "operator";
      userId: string;
      projectIds?: string[];
      isInstanceAdmin: boolean;
      runId?: string;
      source: "local_implicit" | "session";
    }
  | {
      type: "agent";
      agentId: string;
      projectId: string;
      keyId?: string;
      runId?: string;
      source: "agent_jwt" | "agent_key";
    }
  | { type: "none"; source: "none"; runId?: string };
