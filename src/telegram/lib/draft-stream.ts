import type { Api } from "grammy";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { logger } from "../../lib/logger.ts";
import { CONSTANTS } from "../../config/constants.ts";

/**
 * Streams agent text output to Telegram via sendMessageDraft (Bot API 9.5+).
 *
 * Shows an animated draft bubble that fills in as the LLM generates text.
 * Falls back gracefully — if sendMessageDraft fails (e.g. group chat),
 * it just stops sending drafts (the typing indicator is still running).
 *
 * Usage:
 *   const drafter = new DraftStream(api, chatId);
 *   const unsub = agent.subscribe(drafter.handleEvent);
 *   // ... agent runs ...
 *   unsub();
 *   drafter.stop();
 */
export class DraftStream {
  private api: Api;
  private chatId: number;
  private draftId: number;
  private buffer = "";
  private lastSentLength = 0;
  private lastSendTime = 0;
  private pendingSend: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private failed = false; // If sendMessageDraft fails, stop trying

  constructor(api: Api, chatId: number) {
    this.api = api;
    this.chatId = chatId;
    // draft_id must be non-zero; use a random positive int
    this.draftId = Math.floor(Math.random() * 2_000_000_000) + 1;
  }

  /**
   * Event handler — pass directly to agent.subscribe().
   * Arrow function so `this` is bound.
   */
  handleEvent = (event: AgentEvent): void => {
    if (this.stopped || this.failed) return;

    switch (event.type) {
      case "message_update": {
        const ame = event.assistantMessageEvent;
        if (ame.type === "text_delta") {
          this.buffer += ame.delta;
          this.scheduleFlush();
        }
        break;
      }
      case "tool_execution_start": {
        // During tool execution, show a status line
        const toolLabel = formatToolName(event.toolName);
        this.sendDraft(`${this.buffer}\n\n_${toolLabel}..._`.trimStart());
        break;
      }
      case "tool_execution_end": {
        break;
      }
      case "message_start": {
        // New message — if there was tool execution text, the LLM is now
        // generating the next text chunk. Buffer continues accumulating.
        break;
      }
    }
  };

  /**
   * Schedule a throttled flush of the buffer to Telegram.
   */
  private scheduleFlush(): void {
    if (this.pendingSend) return; // Already scheduled

    const elapsed = Date.now() - this.lastSendTime;
    const delay = Math.max(0, CONSTANTS.STREAM_THROTTLE_MS - elapsed);

    this.pendingSend = setTimeout(() => {
      this.pendingSend = null;
      this.flush();
    }, delay);
  }

  /**
   * Send the current buffer as a draft message.
   */
  private flush(): void {
    if (this.stopped || this.failed) return;

    const text = this.buffer.trim();
    if (!text || text.length === this.lastSentLength) return;
    // Telegram requires at least some content, and drafts < 30 chars
    // won't show the bubble — but we send anyway so it's ready when it crosses 30
    this.sendDraft(text);
  }

  /**
   * Actually call sendMessageDraft. If it fails, set failed=true and stop.
   */
  private sendDraft(text: string): void {
    if (this.stopped || this.failed) return;

    // Truncate to Telegram's limit
    const truncated = text.length > CONSTANTS.STREAM_EDIT_TRUNCATE
      ? text.slice(0, CONSTANTS.STREAM_EDIT_TRUNCATE) + "..."
      : text;

    this.lastSentLength = truncated.length;
    this.lastSendTime = Date.now();

    // Fire and forget — don't await
    this.api.sendMessageDraft(this.chatId, this.draftId, truncated).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      // Expected failures: groups, channels, old clients
      if (!this.failed) {
        logger.debug("sendMessageDraft failed, disabling for this response", {
          chatId: this.chatId,
          error: msg,
        });
        this.failed = true;
      }
    });
  }

  /**
   * Stop the drafter. Call this when the agent is done.
   * Sends an empty draft to clear the bubble (Telegram will show the final message instead).
   */
  stop(): void {
    this.stopped = true;
    if (this.pendingSend) {
      clearTimeout(this.pendingSend);
      this.pendingSend = null;
    }
  }

  /**
   * Whether drafting is available (hasn't failed).
   */
  get isActive(): boolean {
    return !this.failed && !this.stopped;
  }
}

/**
 * Format a tool name for display in the draft bubble.
 */
function formatToolName(name: string): string {
  // Convert snake_case to readable: "web_search" → "Searching the web"
  const map: Record<string, string> = {
    bash: "Running command",
    read_file: "Reading file",
    write_file: "Writing file",
    edit_file: "Editing file",
    web_search: "Searching the web",
    web_fetch: "Fetching webpage",
    glob_files: "Finding files",
    grep_search: "Searching code",
    telegram_send_file: "Sending file",
    list_directory: "Listing directory",
  };
  return map[name] ?? `Using ${name.replace(/_/g, " ")}`;
}
