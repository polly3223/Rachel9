import { logger } from "../../lib/logger.ts";

/**
 * Simple async queue that processes one task at a time.
 * Used to prevent concurrent agent runs for the same chat.
 */
class ChatQueue {
  private tasks: (() => Promise<void>)[] = [];
  private running = false;

  /**
   * Enqueue a task. Returns when the task completes (not when it's enqueued).
   */
  async enqueue(fn: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.tasks.push(async () => {
        try {
          await fn();
          resolve();
        } catch (err) {
          reject(err as Error);
        }
      });
      void this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.running || this.tasks.length === 0) return;
    this.running = true;

    const task = this.tasks.shift()!;
    try {
      await task();
    } finally {
      this.running = false;
      void this.processNext();
    }
  }

  get pending(): number {
    return this.tasks.length;
  }
}

/**
 * Map of per-chat queues. One queue per chatId.
 * Ensures messages for the same chat are processed sequentially.
 */
const queues = new Map<number, ChatQueue>();

/**
 * Enqueue a task for a specific chat.
 * If the chat has a pending task, the new task waits.
 */
export async function enqueueForChat(chatId: number, fn: () => Promise<void>): Promise<void> {
  let queue = queues.get(chatId);
  if (!queue) {
    queue = new ChatQueue();
    queues.set(chatId, queue);
  }

  logger.debug("Chat queue", { chatId, pending: queue.pending });
  await queue.enqueue(fn);
}
