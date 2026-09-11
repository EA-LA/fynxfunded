import { afterEach, describe, expect, it, vi } from "vitest";
import { shouldUseRedirectFallback } from "@/services/auth";

afterEach(() => vi.unstubAllGlobals());

describe("OAuth redirect fallback", () => {
  it("recovers from popup-blocked errors in every browser", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Chrome/140.0 Safari/537.36" });
    expect(shouldUseRedirectFallback({ code: "auth/popup-blocked" })).toBe(true);
  });

  it("recovers from Firebase internal popup errors in Safari", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Version/20.0 Safari/620.1" });
    expect(shouldUseRedirectFallback({ code: "auth/internal-error" })).toBe(true);
  });

  it("does not hide internal errors in non-Safari browsers", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Chrome/140.0 Safari/537.36" });
    expect(shouldUseRedirectFallback({ code: "auth/internal-error" })).toBe(false);
  });
});
