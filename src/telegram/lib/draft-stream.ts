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
 * Throttled to ~100ms to avoid Telegram 429 rate limits.
 * Only streams actual LLM text — no tool status messages (they look bad
 * if they get "stuck" as the last visible draft).
 */
export class DraftStream {
  private api: Api;
  private chatId: number;
  private draftId: number;
  private buffer = "";
  private stopped = false;
  private failed = false;
  private draftsSent = 0;
  private deltaCount = 0;
  private totalDeltaChars = 0;
  private lastSendTime = 0;
  private pendingSend: ReturnType<typeof setTimeout> | null = null;

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

    if (event.type === "message_update") {
      const ame = event.assistantMessageEvent;
      if (ame.type === "text_delta" && ame.delta.length > 0) {
        if (this.buffer.length === 0) {
          logger.info("Draft stream: first text_delta", {
            chatId: this.chatId,
            deltaLen: ame.delta.length,
            delta: ame.delta.slice(0, 50),
          });
        }
        this.deltaCount++;
        this.totalDeltaChars += ame.delta.length;
        this.buffer += ame.delta;
        this.scheduleFlush();
      }
    }
  };

  /**
   * Schedule a flush with minimal throttle to avoid 429s.
   */
  private scheduleFlush(): void {
    if (this.pendingSend) return;

    const elapsed = Date.now() - this.lastSendTime;
    const MIN_INTERVAL = 100; // ms — enough to avoid 429
    const delay = Math.max(0, MIN_INTERVAL - elapsed);

    if (delay === 0) {
      this.flush();
    } else {
      this.pendingSend = setTimeout(() => {
        this.pendingSend = null;
        this.flush();
      }, delay);
    }
  }

  /**
   * Send the current buffer as a draft.
   */
  private flush(): void {
    if (this.stopped || this.failed) return;

    const text = this.buffer.trim();
    if (!text) return;

    // Truncate to Telegram's limit
    const truncated = text.length > CONSTANTS.STREAM_EDIT_TRUNCATE
      ? text.slice(0, CONSTANTS.STREAM_EDIT_TRUNCATE) + "..."
      : text;

    this.draftsSent++;
    this.lastSendTime = Date.now();

    // Fire and forget
    this.api.sendMessageDraft(this.chatId, this.draftId, truncated).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (!this.failed) {
        logger.info("sendMessageDraft failed, disabling", {
          chatId: this.chatId,
          error: msg,
        });
        this.failed = true;
      }
    });
  }

  /**
   * Stop the drafter. Call this when the agent is done.
   */
  stop(): void {
    this.stopped = true;
    if (this.pendingSend) {
      clearTimeout(this.pendingSend);
      this.pendingSend = null;
    }
    const avgDelta = this.deltaCount > 0 ? Math.round(this.totalDeltaChars / this.deltaCount) : 0;
    logger.info("Draft stream stopped", {
      chatId: this.chatId,
      draftsSent: this.draftsSent,
      deltaEvents: this.deltaCount,
      avgDeltaChars: avgDelta,
      totalChars: this.totalDeltaChars,
      failed: this.failed,
    });
  }

  get isActive(): boolean {
    return !this.failed && !this.stopped;
  }
}
