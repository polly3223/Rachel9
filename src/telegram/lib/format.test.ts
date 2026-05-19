import { describe, expect, test } from "bun:test";
import { markdownToHtml, splitMessage } from "./format.ts";

describe("markdownToHtml", () => {
  test("converts bold containing inline code without breaking nesting", () => {
    expect(markdownToHtml("**Direct `@google/genai` Integration**")).toBe(
      "<b>Direct <code>@google/genai</code> Integration</b>",
    );
  });

  test("converts markdown bullets without treating leading asterisks as italic", () => {
    expect(markdownToHtml("* first\n- second")).toBe("• first\n• second");
  });

  test("escapes html outside code", () => {
    expect(markdownToHtml("Use <tag> & keep going")).toBe("Use &lt;tag&gt; &amp; keep going");
  });

  test("preserves escaped code block content", () => {
    expect(markdownToHtml("```ts\nconst x = a < b && c > d;\n```")).toBe(
      "<pre>const x = a &lt; b &amp;&amp; c &gt; d;</pre>",
    );
  });

  test("converts links", () => {
    expect(markdownToHtml("[docs](https://example.com/a?x=1&y=2)")).toBe(
      '<a href="https://example.com/a?x=1&amp;y=2">docs</a>',
    );
  });
});

describe("splitMessage", () => {
  test("keeps short messages intact", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
  });
});
