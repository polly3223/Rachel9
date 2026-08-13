import type { AgentMessage, ContentPart } from "./runtime/types.ts";

export type GeminiThinkingLevel = "minimal" | "low" | "medium" | "high";

export function normalizeThinkingLevelForModel(
  model: string,
  level: GeminiThinkingLevel,
): GeminiThinkingLevel {
  if (model.toLowerCase().startsWith("gemini-3.7") && level === "minimal") return "low";
  return level;
}

export interface ThinkingClassificationInput {
  text: string;
  media?: ContentPart[];
  recentMessages?: AgentMessage[];
}

const FILE_OR_OUTPUT_MARKERS = [
  ".pdf", ".pptx", ".xlsx", ".docx", ".csv", ".html", ".css", ".js", ".ts", ".tsx", ".py", ".json",
  "[file:", "[photo]", "[audio:", "[video:", "[video note]", "spreadsheet", "presentation", "powerpoint",
  "document", "website", "landing page",
];

const CODE_OR_INFRA_MARKERS = [
  "```", "=>", "const ", "let ", "function ", "import ", "export ", "class ", "interface ",
  "src/", "docker", "deploy", "restart", "commit", "push", "branch", "pr ", "pull request",
  "error:", "exception", "stack trace", "traceback", "typecheck", "test failed", "build failed",
];

const COMPLEX_ACTION_ROOTS = [
  "debug", "fix", "implement", "refactor", "deploy", "review", "audit", "investig", "research",
  "analy", "compare", "optimi", "architect", "migrat", "build", "create", "generate", "design", "writ",
  "correg", "risolv", "analizz", "ricerc", "confront", "costru", "crea", "proget", "sistem", "scriv",
  "arregl", "resolv", "investig", "diseñ", "compar", "constru", "crear", "escrib",
  "corrig", "resoud", "recherch", "concev", "compar", "ecrir",
  "korrig", "lös", "forsch", "vergleich", "entwerf", "bau", "erstell", "schreib",
];

const SIMPLE_ACKS = new Set([
  "ok", "okay", "yes", "no", "yep", "yeah", "sure", "thanks", "thank you", "ciao", "hi", "hello",
  "perfetto", "va bene", "sì", "si", "nope", "grazie", "oui", "non", "ja", "nein", "vale", "gracias",
]);

const CONTINUATION_MARKERS = [
  "yes", "yep", "yeah", "sure", "ok", "okay", "do it", "go ahead", "continue", "proceed",
  "sì", "si", "fallo", "procedi", "continua", "ok vai", "perfetto",
];

function normalize(text: string): string {
  return text.trim().toLowerCase().normalize("NFKC");
}

function wordCount(text: string): number {
  return text.split(/\s+/u).filter(Boolean).length;
}

function includesAny(text: string, markers: readonly string[]): boolean {
  return markers.some((marker) => text.includes(marker));
}

function hasActionRoot(text: string): boolean {
  return COMPLEX_ACTION_ROOTS.some((root) => text.includes(root));
}

function hasStructuredCode(text: string): boolean {
  return /[{}[\]();]/.test(text) && /\b(const|let|function|class|import|export|return|type|interface)\b/.test(text);
}

function isSimpleAck(clean: string): boolean {
  if (SIMPLE_ACKS.has(clean)) return true;
  return clean.length <= 24 && CONTINUATION_MARKERS.some((marker) => clean === marker || clean.startsWith(`${marker} `));
}

function recentContextLooksComplex(messages: AgentMessage[] | undefined): boolean {
  if (!messages?.length) return false;
  const recentText = messages
    .slice(-6)
    .flatMap((message) => message.content)
    .filter((part): part is Extract<ContentPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text.toLowerCase())
    .join("\n");

  return includesAny(recentText, FILE_OR_OUTPUT_MARKERS) ||
    includesAny(recentText, CODE_OR_INFRA_MARKERS) ||
    hasActionRoot(recentText);
}

export function determineThinkingLevel(input: ThinkingClassificationInput): GeminiThinkingLevel {
  const clean = normalize(input.text);
  const words = wordCount(clean);
  const hasMedia = Boolean(input.media?.length);
  const complexContext = recentContextLooksComplex(input.recentMessages);

  if (!hasMedia && isSimpleAck(clean) && !complexContext) return "minimal";

  let score = 1; // low baseline

  if (hasMedia) score += 2;
  if (clean.length > 500 || words > 80) score += 1;
  if (clean.length > 1_500 || words > 220) score += 1;
  if (includesAny(clean, FILE_OR_OUTPUT_MARKERS)) score += 2;
  if (includesAny(clean, CODE_OR_INFRA_MARKERS) || hasStructuredCode(clean)) score += 2;
  if (hasActionRoot(clean)) score += 1;
  if (complexContext && isSimpleAck(clean)) score += 2;
  if (/\b(deep|thorough|detailed|audit|production|security|legal|financial)\b/.test(clean)) score += 2;

  if (score >= 4) return "high";
  if (score >= 2) return "medium";
  return "low";
}
