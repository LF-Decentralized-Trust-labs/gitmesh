import { describe, it, expect } from "vitest";
import { 
  normalizeProjectPrefix, 
  isGlobalPath, 
  extractProjectPrefixFromPath, 
  applyProjectPrefix,
  toProjectRelativePath
} from "./project-routes";

describe("project-routes", () => {
  describe("normalizeProjectPrefix", () => {
    it("trims and upper-cases the prefix", () => {
      expect(normalizeProjectPrefix("  abc  ")).toBe("ABC");
      expect(normalizeProjectPrefix("Gm")).toBe("GM");
    });
  });

  describe("isGlobalPath", () => {
    it("returns true for root path", () => {
      expect(isGlobalPath("/")).toBe(true);
    });

    it("returns true for global routes like auth and docs", () => {
      expect(isGlobalPath("/auth")).toBe(true);
      expect(isGlobalPath("/docs/getting-started")).toBe(true);
    });

    it("returns false for board routes", () => {
      expect(isGlobalPath("/dashboard")).toBe(false);
      expect(isGlobalPath("/issues/123")).toBe(false);
    });
  });

  describe("extractProjectPrefixFromPath", () => {
    it("returns null for global or known board roots", () => {
      expect(extractProjectPrefixFromPath("/auth")).toBe(null);
      expect(extractProjectPrefixFromPath("/dashboard")).toBe(null);
    });

    it("extracts the prefix if the first segment is not a known root", () => {
      expect(extractProjectPrefixFromPath("/MYPROJ/dashboard")).toBe("MYPROJ");
    });
  });

  describe("applyProjectPrefix", () => {
    it("prefixes the path if it is a board path and prefix is provided", () => {
      expect(applyProjectPrefix("/dashboard", "GM")).toBe("/GM/dashboard");
    });

    it("does not prefix if the path is already prefixed", () => {
      expect(applyProjectPrefix("/GM/dashboard", "GM")).toBe("/GM/dashboard");
    });

    it("does not prefix global paths", () => {
      expect(applyProjectPrefix("/auth", "GM")).toBe("/auth");
    });

    it("maintains search params and hashes", () => {
      expect(applyProjectPrefix("/issues?status=open#bottom", "GM")).toBe("/GM/issues?status=open#bottom");
    });
  });

  describe("toProjectRelativePath", () => {
    it("removes the project prefix from the path", () => {
      expect(toProjectRelativePath("/GM/dashboard")).toBe("/dashboard");
    });

    it("returns the original path if no prefix is found", () => {
      expect(toProjectRelativePath("/dashboard")).toBe("/dashboard");
    });
  });
});
