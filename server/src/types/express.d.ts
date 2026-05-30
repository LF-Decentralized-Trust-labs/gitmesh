import "express";
export {};

export interface RequestActor {
  type: "operator" | "agent" | "none";
  userId?: string;
  agentId?: string;
  projectId?: string;
  keyId?: string;
  runId?: string;
  projectIds?: string[];
  isInstanceAdmin?: boolean;
  source: "local_implicit" | "session" | "agent_jwt" | "agent_key" | "none";
}

declare global {
  namespace Express {
    interface Request {
      actor: RequestActor;
    }
  }
}
