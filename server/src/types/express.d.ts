import "express";
export {};

declare global {
  namespace Express {
    interface Request {
      actor: RequestActor;
    }
  }
}