import { describe, expect, it } from "vitest";

import { parseJsonc } from "./jsonc.js";

describe("parseJsonc", () => {
  it("drops line and block comments and trailing commas", () => {
    expect(parseJsonc('{\n  // note\n  "a": [1, 2,], /* b */\n  "c": {"d": true,},\n}')).toEqual({
      a: [1, 2],
      c: { d: true },
    });
  });

  it("leaves comment markers and commas inside strings alone", () => {
    expect(parseJsonc('{"url": "http://x/*", "csv": "a,}"}')).toEqual({ url: "http://x/*", csv: "a,}" });
  });

  it("returns undefined for malformed input", () => {
    expect(parseJsonc("not json")).toBeUndefined();
    expect(parseJsonc('{"a": ')).toBeUndefined();
  });
});
