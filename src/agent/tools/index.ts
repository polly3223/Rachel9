import { Type, type Static } from "@sinclair/typebox";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ToolDefinition, ToolResult, ToolUpdateCallback } from "../runtime/types.ts";
import { textPart } from "../runtime/types.ts";
import { createWebSearchTool } from "./web-search.ts";
import { createWebFetchTool } from "./web-fetch.ts";
import { createTelegramSendFileTool } from "./telegram.ts";
import { logger } from "../../lib/logger.ts";
import { errorMessage } from "../../lib/errors.ts";
import { execManagedCommand } from "../../lib/process-registry.ts";

export interface ToolDependencies {
  cwd: string;
  sendFile: (filePath: string, caption?: string) => Promise<void>;
  chatId?: number;
  getRunId?: () => string | null;
}

const DEFAULT_BASH_TIMEOUT_SECONDS = Number(Bun.env["BASH_TOOL_TIMEOUT_SECONDS"] ?? "180");
const DEFAULT_TOOL_TIMEOUT_MS = Number(Bun.env["TOOL_TIMEOUT_MS"] ?? 180_000);
const TOOL_OUTPUT_MAX_CHARS = Number(Bun.env["TOOL_OUTPUT_MAX_CHARS"] ?? 50_000);

const TOOL_POLICIES: Record<string, { timeoutMs?: number; mutating?: boolean }> = {
  bash: { timeoutMs: DEFAULT_BASH_TIMEOUT_SECONDS * 1000, mutating: true },
  edit: { mutating: true },
  write: { mutating: true },
  telegram_send_file: { mutating: true },
  web_fetch: { timeoutMs: 20_000 },
  web_search: { timeoutMs: 20_000 },
};

const ReadSchema = Type.Object({
  file_path: Type.String({ description: "Absolute or relative path to read" }),
  max_chars: Type.Optional(Type.Number({ description: "Maximum characters to return" })),
});

const WriteSchema = Type.Object({
  file_path: Type.String({ description: "Absolute or relative path to write" }),
  content: Type.String({ description: "Full file content" }),
});

const EditSchema = Type.Object({
  file_path: Type.String({ description: "Absolute or relative path to edit" }),
  old_string: Type.String({ description: "Exact text to replace" }),
  new_string: Type.String({ description: "Replacement text" }),
  replace_all: Type.Optional(Type.Boolean({ description: "Replace all matches instead of exactly one" })),
});

const BashSchema = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds" })),
  cwd: Type.Optional(Type.String({ description: "Optional working directory" })),
});

const GrepSchema = Type.Object({
  pattern: Type.String({ description: "Regex pattern to search for" }),
  path: Type.Optional(Type.String({ description: "Path to search, defaults to cwd" })),
});

const FindSchema = Type.Object({
  path: Type.Optional(Type.String({ description: "Directory to search, defaults to cwd" })),
  name: Type.Optional(Type.String({ description: "Filename glob, e.g. *.ts" })),
  max_results: Type.Optional(Type.Number({ description: "Maximum results to return" })),
});

const LsSchema = Type.Object({
  path: Type.Optional(Type.String({ description: "Directory to list, defaults to cwd" })),
});

type ReadParams = Static<typeof ReadSchema>;
type WriteParams = Static<typeof WriteSchema>;
type EditParams = Static<typeof EditSchema>;
type BashParams = Static<typeof BashSchema>;
type GrepParams = Static<typeof GrepSchema>;
type FindParams = Static<typeof FindSchema>;
type LsParams = Static<typeof LsSchema>;

function pathInCwd(cwd: string, path: string): string {
  return path.startsWith("/") ? path : resolve(cwd, path);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function trimText(value: string): string {
  return value.length > TOOL_OUTPUT_MAX_CHARS
    ? `${value.slice(0, TOOL_OUTPUT_MAX_CHARS)}\n\n[...tool output truncated at ${TOOL_OUTPUT_MAX_CHARS} chars]`
    : value;
}

function capOutput(result: ToolResult<unknown>): ToolResult<unknown> {
  return {
    ...result,
    content: result.content.map((part) => part.type === "text" ? { ...part, text: trimText(part.text) } : part),
    details: typeof result.details === "string" ? trimText(result.details) : result.details,
  };
}

function makeTimeoutSignal(parent: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(`Tool timed out after ${timeoutMs}ms`), timeoutMs);
  const onAbort = () => controller.abort(parent?.reason ?? "Parent signal aborted");
  if (parent) {
    if (parent.aborted) onAbort();
    else parent.addEventListener("abort", onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

async function withHardTimeout<T>(promise: Promise<T>, timeoutMs: number, toolName: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Tool ${toolName} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function withToolRuntimePolicy(tool: ToolDefinition<any>, chatId?: number): ToolDefinition<any> {
  const execute = tool.execute.bind(tool);
  const policy = TOOL_POLICIES[tool.name] ?? {};
  const timeoutMs = policy.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;

  return {
    ...tool,
    description: `${tool.description}\n\nRachel runtime policy: timeout=${Math.round(timeoutMs / 1000)}s, output cap=${TOOL_OUTPUT_MAX_CHARS} chars${policy.mutating ? ", mutating tool" : ""}.`,
    execute: async (
      toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
      onUpdate?: ToolUpdateCallback,
    ) => {
      const startedAt = Date.now();
      const { signal: timeoutSignal, cleanup } = makeTimeoutSignal(signal, timeoutMs);
      logger.info("Tool runtime start", { chatId, tool: tool.name, toolCallId, timeoutMs, mutating: policy.mutating ?? false });

      try {
        const result = await withHardTimeout(
          execute(toolCallId, params, timeoutSignal, onUpdate),
          timeoutMs + 250,
          tool.name,
        );
        logger.info("Tool runtime end", { chatId, tool: tool.name, toolCallId, durationMs: Date.now() - startedAt });
        return capOutput(result);
      } catch (err) {
        logger.warn("Tool runtime error", {
          chatId,
          tool: tool.name,
          toolCallId,
          durationMs: Date.now() - startedAt,
          error: errorMessage(err),
        });
        return {
          content: [textPart(`Tool ${tool.name} failed: ${errorMessage(err)}`)],
          details: { error: errorMessage(err) },
        };
      } finally {
        cleanup();
      }
    },
  };
}

function createReadTool(cwd: string): ToolDefinition<ReadParams> {
  return {
    name: "read",
    label: "Read File",
    description: "Read a text file from disk.",
    parameters: ReadSchema,
    execute: async (_id, params) => {
      const filePath = pathInCwd(cwd, params.file_path);
      const maxChars = params.max_chars ?? TOOL_OUTPUT_MAX_CHARS;
      const content = await readFile(filePath, "utf-8");
      const text = content.length > maxChars
        ? `${content.slice(0, maxChars)}\n\n[...file truncated at ${maxChars} chars]`
        : content;
      return { content: [textPart(text)], details: { filePath, length: content.length } };
    },
  };
}

function createWriteTool(cwd: string): ToolDefinition<WriteParams> {
  return {
    name: "write",
    label: "Write File",
    description: "Write a complete text file to disk, creating parent directories if needed.",
    parameters: WriteSchema,
    execute: async (_id, params) => {
      const filePath = pathInCwd(cwd, params.file_path);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, params.content);
      return { content: [textPart(`Wrote ${filePath}`)], details: { filePath, length: params.content.length } };
    },
  };
}

function createEditTool(cwd: string): ToolDefinition<EditParams> {
  return {
    name: "edit",
    label: "Edit File",
    description: "Replace exact text in a text file. By default, exactly one match is required.",
    parameters: EditSchema,
    execute: async (_id, params) => {
      const filePath = pathInCwd(cwd, params.file_path);
      const content = await readFile(filePath, "utf-8");
      const matches = content.split(params.old_string).length - 1;
      if (matches === 0) throw new Error("old_string not found");
      if (!params.replace_all && matches !== 1) {
        throw new Error(`old_string matched ${matches} times; set replace_all=true or provide a more specific string`);
      }
      const next = params.replace_all
        ? content.split(params.old_string).join(params.new_string)
        : content.replace(params.old_string, params.new_string);
      await writeFile(filePath, next);
      return { content: [textPart(`Edited ${filePath}`)], details: { filePath, replacements: params.replace_all ? matches : 1 } };
    },
  };
}

function createBashTool(deps: ToolDependencies): ToolDefinition<BashParams> {
  return {
    name: "bash",
    label: "Bash",
    description: "Run a bash command in the workspace. Use non-interactive commands.",
    parameters: BashSchema,
    execute: async (_id, params, signal) => {
      const workingDir = params.cwd ? pathInCwd(deps.cwd, params.cwd) : deps.cwd;
      let output = "";
      const result = await execManagedCommand(params.command, workingDir, {
        timeout: params.timeout ?? DEFAULT_BASH_TIMEOUT_SECONDS,
        signal,
        chatId: deps.chatId,
        scopeId: deps.getRunId?.() ?? null,
        onData: (data) => {
          output += data.toString("utf-8");
        },
      });
      const text = output.trim() || `(command exited with code ${result.exitCode ?? "null"} and no output)`;
      return { content: [textPart(text)], details: { exitCode: result.exitCode, cwd: workingDir } };
    },
  };
}

function createGrepTool(deps: ToolDependencies): ToolDefinition<GrepParams> {
  return {
    name: "grep",
    label: "Grep",
    description: "Search file contents using ripgrep.",
    parameters: GrepSchema,
    execute: async (_id, params, signal) => {
      const searchPath = params.path ? pathInCwd(deps.cwd, params.path) : deps.cwd;
      let output = "";
      const result = await execManagedCommand(`rg --line-number -- ${shellQuote(params.pattern)} ${shellQuote(searchPath)}`, deps.cwd, {
        timeout: 30,
        signal,
        chatId: deps.chatId,
        scopeId: deps.getRunId?.() ?? null,
        onData: (data) => {
          output += data.toString("utf-8");
        },
      });
      return {
        content: [textPart(output.trim() || `No matches (exit ${result.exitCode})`)],
        details: { exitCode: result.exitCode, path: searchPath },
      };
    },
  };
}

function createFindTool(deps: ToolDependencies): ToolDefinition<FindParams> {
  return {
    name: "find",
    label: "Find Files",
    description: "Find files by name using the system find command.",
    parameters: FindSchema,
    execute: async (_id, params, signal) => {
      const basePath = params.path ? pathInCwd(deps.cwd, params.path) : deps.cwd;
      const max = params.max_results ?? 200;
      const nameArg = params.name ? ` -name ${shellQuote(params.name)}` : "";
      let output = "";
      await execManagedCommand(`find ${shellQuote(basePath)}${nameArg} -maxdepth 8 | head -${Math.max(1, max)}`, deps.cwd, {
        timeout: 30,
        signal,
        chatId: deps.chatId,
        scopeId: deps.getRunId?.() ?? null,
        onData: (data) => {
          output += data.toString("utf-8");
        },
      });
      return { content: [textPart(output.trim() || "No files found")], details: { path: basePath } };
    },
  };
}

function createLsTool(cwd: string): ToolDefinition<LsParams> {
  return {
    name: "ls",
    label: "List Directory",
    description: "List files and directories.",
    parameters: LsSchema,
    execute: async (_id, params) => {
      const dir = params.path ? pathInCwd(cwd, params.path) : cwd;
      if (!existsSync(dir)) throw new Error(`Path does not exist: ${dir}`);
      const entries = await readdir(dir, { withFileTypes: true });
      const lines = entries
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => `${entry.isDirectory() ? "d" : "-"} ${entry.name}`);
      return { content: [textPart(lines.join("\n") || "(empty)")], details: { path: dir, count: entries.length } };
    },
  };
}

export function createAgentTools(deps: ToolDependencies): ToolDefinition[] {
  const tools: ToolDefinition<any>[] = [
    createReadTool(deps.cwd),
    createBashTool(deps),
    createEditTool(deps.cwd),
    createWriteTool(deps.cwd),
    createGrepTool(deps),
    createFindTool(deps),
    createLsTool(deps.cwd),
    createWebSearchTool(),
    createWebFetchTool(),
    createTelegramSendFileTool(deps.sendFile),
  ];

  return tools.map((tool) => withToolRuntimePolicy(tool, deps.chatId));
}
