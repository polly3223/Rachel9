/**
 * Generate a CET/CEST timestamp string for prepending to user messages.
 * Format: "DD/MM HH:MMCET" or "DD/MM HH:MMCEST"
 * Uses Europe/Zurich timezone (auto-detects daylight saving).
 */
export function timestamp(): string {
  const now = new Date();
  const dt = now.toLocaleString("en-GB", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  // Detect CET vs CEST by comparing UTC hour to local hour
  const utcH = now.getUTCHours();
  const localH = Number(dt.split(", ")[1]?.split(":")[0] ?? "0");
  const offset = ((localH - utcH) + 24) % 24;
  const tz = offset === 2 ? "CEST" : "CET";
  return dt.replace(", ", " ") + tz;
}
