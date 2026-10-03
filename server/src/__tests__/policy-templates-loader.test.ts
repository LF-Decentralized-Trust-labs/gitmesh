import { describe, expect, it } from "vitest";
import {
  clearPolicyTemplateCache,
  findPolicyTemplate,
  getDefaultEnabledTemplates,
  loadPolicyTemplates,
} from "../core/policy-templates-loader.js";

describe("policy templates loader", () => {
  it("loads shipped policy templates without compile errors", () => {
    clearPolicyTemplateCache();

    const result = loadPolicyTemplates();

    expect(result.loadedFrom).toBeTruthy();
    expect(result.errors).toEqual([]);
    expect(result.templates.length).toBeGreaterThanOrEqual(5);
  });

  it("finds templates case-insensitively and exposes default-enabled templates", () => {
    clearPolicyTemplateCache();

    const ciTemplate = findPolicyTemplate("NO-CI-MODIFICATION");
    const defaultEnabled = getDefaultEnabledTemplates();

    expect(ciTemplate?.metadata.slug).toBe("no-ci-modification");
    expect(ciTemplate?.policies[0]?.effect).toBe("block");
    expect(defaultEnabled.map((template) => template.metadata.slug)).toContain("no-ci-modification");
  });
});
