import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { logger } from "../../lib/logger.ts";

const TelegramSendFileSchema = Type.Object({
  file_path: Type.String({ description: "Absolute path to the file to send" }),
  caption: Type.Optional(Type.String({ description: "Optional caption for the file" })),
});

type TelegramSendFileParams = Static<typeof TelegramSendFileSchema>;

/**
 * Creates a tool that sends files to the bot owner via Telegram.
 * The sendFn is injected to avoid circular dependency with bot module.
 */
export function createTelegramSendFileTool(
  sendFn: (filePath: string, caption?: string) => Promise<void>,
): AgentTool<typeof TelegramSendFileSchema> {
  return {
    name: "telegram_send_file",
    label: "Send File",
    description: "Send a file (image, document, video, audio) to the user via Telegram. Provide the absolute file path.",
    parameters: TelegramSendFileSchema,
    execute: async (_toolCallId: string, params: TelegramSendFileParams): Promise<AgentToolResult<unknown>> => {
      logger.debug("Telegram send file", { path: params.file_path });

      try {
        const file = Bun.file(params.file_path);
        if (!(await file.exists())) {
          return {
            content: [{ type: "text", text: `File not found: ${params.file_path}` }],
            details: { error: "not_found" },
          };
        }

        await sendFn(params.file_path, params.caption);

        return {
          content: [{ type: "text", text: `File sent: ${params.file_path}${params.caption ? ` (caption: "${params.caption}")` : ""}` }],
          details: { sent: true },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Failed to send file: ${msg}` }],
          details: { error: msg },
        };
      }
    },
  };
}
