import { describe, expect, test } from "bun:test";
import {
  isPermanentGeminiQuotaError,
  isTransientGeminiError,
} from "./gemini.ts";

describe("Gemini error classification", () => {
  test("recognizes a monthly spending cap as permanent for the current request", () => {
    const error = new Error(
      '{"error":{"code":429,"message":"Your project has exceeded its monthly spending cap."}}',
    );

    expect(isPermanentGeminiQuotaError(error)).toBe(true);
    expect(isTransientGeminiError(error)).toBe(true);
  });

  test("keeps ordinary service outages transient", () => {
    const error = new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}');

    expect(isPermanentGeminiQuotaError(error)).toBe(false);
    expect(isTransientGeminiError(error)).toBe(true);
  });
});
