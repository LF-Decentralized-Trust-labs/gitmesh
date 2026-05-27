import { describe, it, expect, beforeEach, vi } from "vitest";
import { 
  getProjectOrderStorageKey, 
  readProjectOrder, 
  writeProjectOrder, 
  sortProjectsByStoredOrder,
  SUBPROJECT_ORDER_UPDATED_EVENT
} from "../lib/subproject-order";

describe("subproject-order", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe("getProjectOrderStorageKey", () => {
    it("returns key with project and user ID", () => {
      expect(getProjectOrderStorageKey("p1", "u1")).toBe("gitmesh-agents.projectOrder:p1:u1");
    });

    it("uses anonymous for null/empty user ID", () => {
      expect(getProjectOrderStorageKey("p1", null)).toBe("gitmesh-agents.projectOrder:p1:anonymous");
      expect(getProjectOrderStorageKey("p1", "")).toBe("gitmesh-agents.projectOrder:p1:anonymous");
      expect(getProjectOrderStorageKey("p1", "  ")).toBe("gitmesh-agents.projectOrder:p1:anonymous");
    });
  });

  describe("readProjectOrder", () => {
    it("returns empty array if nothing stored", () => {
      expect(readProjectOrder("key")).toEqual([]);
    });

    it("returns parsed and normalized IDs", () => {
      localStorage.setItem("key", JSON.stringify(["id1", "id2", 123, ""]));
      expect(readProjectOrder("key")).toEqual(["id1", "id2"]);
    });
  });

  describe("writeProjectOrder", () => {
    it("writes normalized IDs to localStorage and dispatches event", () => {
      const dispatchSpy = vi.spyOn(window, "dispatchEvent");
      writeProjectOrder("key", ["id1", "id2", ""]);
      
      expect(JSON.parse(localStorage.getItem("key")!)).toEqual(["id1", "id2"]);
      expect(dispatchSpy).toHaveBeenCalled();
      const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
      expect(event.type).toBe(SUBPROJECT_ORDER_UPDATED_EVENT);
      expect(event.detail.orderedIds).toEqual(["id1", "id2"]);
    });
  });

  describe("sortProjectsByStoredOrder", () => {
    const projects = [
      { id: "p1", name: "P1" },
      { id: "p2", name: "P2" },
      { id: "p3", name: "P3" },
    ] as any[];

    it("sorts by orderedIds and appends remaining", () => {
      const orderedIds = ["p2", "p3"];
      const sorted = sortProjectsByStoredOrder(projects, orderedIds);
      expect(sorted.map(p => p.id)).toEqual(["p2", "p3", "p1"]);
    });

    it("handles missing projects in orderedIds", () => {
      const orderedIds = ["p2", "non-existent", "p1"];
      const sorted = sortProjectsByStoredOrder(projects, orderedIds);
      expect(sorted.map(p => p.id)).toEqual(["p2", "p1", "p3"]);
    });

    it("returns original projects if orderedIds is empty", () => {
      expect(sortProjectsByStoredOrder(projects, [])).toEqual(projects);
    });
  });
});
