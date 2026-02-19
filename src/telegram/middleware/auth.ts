import type { Context, NextFunction } from "grammy";
import { env } from "../../config/env.ts";
import { logger } from "../../lib/logger.ts";

/**
 * Auth middleware: only allows the bot owner through.
 * Silent rejection — unauthorized users get no response at all.
 */
export async function authGuard(ctx: Context, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;

  if (userId !== env.OWNER_TELEGRAM_USER_ID) {
    logger.warn("Unauthorized access attempt", { userId });
    return; // Silent — don't reveal bot exists
  }

  await next();
}
