import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { timeAgo } from "../lib/timeAgo";

describe("timeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for very recent dates", () => {
    const now = new Date();
    vi.setSystemTime(now);
    expect(timeAgo(now)).toBe("just now");
    
    const fiveSecondsAgo = new Date(now.getTime() - 5000);
    expect(timeAgo(fiveSecondsAgo)).toBe("just now");
  });

  it("returns minutes ago", () => {
    const now = new Date();
    vi.setSystemTime(now);
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    expect(timeAgo(fiveMinutesAgo)).toBe("5m ago");
  });

  it("returns hours ago", () => {
    const now = new Date();
    vi.setSystemTime(now);
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    expect(timeAgo(threeHoursAgo)).toBe("3h ago");
  });

  it("returns days ago", () => {
    const now = new Date();
    vi.setSystemTime(now);
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    expect(timeAgo(twoDaysAgo)).toBe("2d ago");
  });

  it("returns weeks ago", () => {
    const now = new Date();
    vi.setSystemTime(now);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    expect(timeAgo(twoWeeksAgo)).toBe("2w ago");
  });

  it("returns months ago", () => {
    const now = new Date();
    vi.setSystemTime(now);
    const twoMonthsAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    expect(timeAgo(twoMonthsAgo)).toBe("2mo ago");
  });

  it("handles string dates", () => {
    const now = new Date();
    vi.setSystemTime(now);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    expect(timeAgo(yesterday)).toBe("1d ago");
  });
});
