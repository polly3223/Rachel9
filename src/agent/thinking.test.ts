import { describe, expect, test } from "bun:test";
import { determineThinkingLevel } from "./thinking.ts";
import { textPart, type AgentMessage } from "./runtime/types.ts";

function assistant(text: string): AgentMessage {
  return { role: "assistant", content: [textPart(text)], timestamp: Date.now() };
}

describe("determineThinkingLevel", () => {
  test("uses minimal for simple acknowledgements without complex context", () => {
    expect(determineThinkingLevel({ text: "ok" })).toBe("minimal");
    expect(determineThinkingLevel({ text: "perfetto" })).toBe("minimal");
  });

  test("does not downgrade short confirmations after complex context", () => {
    expect(determineThinkingLevel({
      text: "yes do it",
      recentMessages: [assistant("I can build the Docker image, push the branch, and deploy all containers.")],
    })).toBe("medium");
  });

  test("uses high for code and deployment work", () => {
    expect(determineThinkingLevel({ text: "fix the TypeScript error and deploy the container" })).toBe("high");
  });

  test("uses high for file or document generation", () => {
    expect(determineThinkingLevel({ text: "Create a PowerPoint deck and export it as .pptx" })).toBe("high");
  });

  test("uses medium for normal action tasks", () => {
    expect(determineThinkingLevel({ text: "Write a short email to Marco about tomorrow's meeting" })).toBe("medium");
  });

  test("uses low for ordinary conversation", () => {
    expect(determineThinkingLevel({ text: "What do you think about this idea?" })).toBe("low");
  });

  test("escalates media prompts", () => {
    expect(determineThinkingLevel({
      text: "what is in this image?",
      media: [{ type: "media", data: "abc", mimeType: "image/jpeg" }],
    })).toBe("medium");
  });
});
