export function canSendInlineToGemini(mimeType: string): boolean {
  const lower = mimeType.toLowerCase();
  return lower.startsWith("image/") ||
    lower.startsWith("audio/") ||
    lower.startsWith("video/") ||
    lower === "application/pdf";
}
