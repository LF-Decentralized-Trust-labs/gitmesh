import { describe, it, expect } from "vitest";
import { groupBy } from "../lib/groupBy";

describe("groupBy", () => {
  it("groups items by a string key", () => {
    const items = [
      { id: 1, type: "a" },
      { id: 2, type: "b" },
      { id: 3, type: "a" },
    ];
    const result = groupBy(items, (item) => item.type);
    expect(result).toEqual({
      a: [
        { id: 1, type: "a" },
        { id: 3, type: "a" },
      ],
      b: [{ id: 2, type: "b" }],
    });
  });

  it("handles empty array", () => {
    const result = groupBy([], (item: any) => item.type);
    expect(result).toEqual({});
  });

  it("groups by a derived key", () => {
    const items = [1, 2, 3, 4, 5];
    const result = groupBy(items, (n) => (n % 2 === 0 ? "even" : "odd"));
    expect(result).toEqual({
      odd: [1, 3, 5],
      even: [2, 4],
    });
  });

  it("handles all items having the same key", () => {
    const items = [
      { id: 1, type: "a" },
      { id: 2, type: "a" },
    ];
    const result = groupBy(items, (item) => item.type);
    expect(result).toEqual({
      a: [
        { id: 1, type: "a" },
        { id: 2, type: "a" },
      ],
    });
  });
});
