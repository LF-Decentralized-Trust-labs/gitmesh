import type { Actor } from "@gitmesh/core";

declare global {
  namespace Express {
    interface Request {
      actor: Actor;
    }
  }
}
