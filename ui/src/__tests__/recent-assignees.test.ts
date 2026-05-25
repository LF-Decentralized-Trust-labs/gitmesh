import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getRecentAssigneeIds, trackRecentAssignee, sortAgentsByRecency } from "../lib/recent-assignees";

describe("recent-assignees", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe("getRecentAssigneeIds", () => {
    it("returns empty array if nothing in localStorage", () => {
      expect(getRecentAssigneeIds()).toEqual([]);
    });

    it("returns parsed array from localStorage", () => {
      localStorage.setItem("gitmesh-agents:recent-assignees", JSON.stringify(["1", "2"]));
      expect(getRecentAssigneeIds()).toEqual(["1", "2"]);
    });

    it("returns empty array if localStorage content is invalid", () => {
      localStorage.setItem("gitmesh-agents:recent-assignees", "invalid-json");
      expect(getRecentAssigneeIds()).toEqual([]);
    });
  });

  describe("trackRecentAssignee", () => {
    it("adds a new assignee to the top", () => {
      trackRecentAssignee("1");
      expect(getRecentAssigneeIds()).toEqual(["1"]);
      
      trackRecentAssignee("2");
      expect(getRecentAssigneeIds()).toEqual(["2", "1"]);
    });

    it("moves existing assignee to the top", () => {
      trackRecentAssignee("1");
      trackRecentAssignee("2");
      trackRecentAssignee("1");
      expect(getRecentAssigneeIds()).toEqual(["1", "2"]);
    });

    it("respects MAX_RECENT limit", () => {
      for (let i = 0; i < 15; i++) {
        trackRecentAssignee(`agent-${i}`);
      }
      const recent = getRecentAssigneeIds();
      expect(recent.length).toBe(10);
      expect(recent[0]).toBe("agent-14");
    });
  });

  describe("sortAgentsByRecency", () => {
    it("sorts agents with recent ones first, then by name", () => {
      const agents = [
        { id: "3", name: "Charlie" },
        { id: "1", name: "Alice" },
        { id: "2", name: "Bob" },
        { id: "4", name: "David" },
      ];
      const recentIds = ["2", "1"];
      
      const sorted = sortAgentsByRecency(agents, recentIds);
      
      expect(sorted[0].id).toBe("2"); // Recent first
      expect(sorted[1].id).toBe("1"); // Recent second
      expect(sorted[2].id).toBe("3"); // Charlie comes before David alphabetically
      expect(sorted[3].id).toBe("4");
    });
  });
});
