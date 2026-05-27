import { describe, it, expect, vi, beforeEach } from "vitest";
import { api, ApiError } from "../api/client";

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("performs a GET request", async () => {
    const mockData = { id: 1 };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const result = await api.get("/test");
    expect(fetch).toHaveBeenCalledWith("/api/test", expect.objectContaining({
      headers: expect.any(Headers),
      credentials: "include",
    }));
    expect(result).toEqual(mockData);
  });

  it("performs a POST request with JSON body", async () => {
    const mockData = { ok: true };
    const body = { name: "test" };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const result = await api.post("/test", body);
    expect(fetch).toHaveBeenCalledWith("/api/test", expect.objectContaining({
      method: "POST",
      body: JSON.stringify(body),
    }));
    const headers = (fetch as any).mock.calls[0][1].headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("throws ApiError on failure", async () => {
    const errorBody = { error: "Not Found" };
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => errorBody,
    });

    await expect(api.get("/test")).rejects.toThrow(ApiError);
    try {
      await api.get("/test");
    } catch (e: any) {
      expect(e.status).toBe(404);
      expect(e.body).toEqual(errorBody);
      expect(e.message).toBe("Not Found");
    }
  });

  it("uses default error message if body is not JSON", async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error("not json"); },
    });

    await expect(api.get("/test")).rejects.toThrow("Request failed: 500");
  });
});
