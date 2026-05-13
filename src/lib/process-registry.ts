import { spawn, type ChildProcess } from "node:child_process";
import { logger } from "./logger.ts";
import { errorMessage } from "./errors.ts";

export interface ManagedProcess {
  id: string;
  chatId?: number;
  scopeId?: string;
  command: string;
  cwd: string;
  pid: number | null;
  startedAt: number;
}

const processes = new Map<string, ManagedProcess & { child: ChildProcess }>();

function killProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
    }
  }
}

export function listManagedProcesses(): ManagedProcess[] {
  return [...processes.values()].map(({ child: _child, ...proc }) => proc);
}

export function killManagedProcess(id: string, reason = "killed"): boolean {
  const proc = processes.get(id);
  if (!proc || !proc.pid) return false;
  logger.warn("Killing managed process", {
    id,
    chatId: proc.chatId,
    scopeId: proc.scopeId,
    pid: proc.pid,
    reason,
    command: proc.command,
  });
  killProcessGroup(proc.pid, "SIGTERM");
  setTimeout(() => {
    if (processes.has(id) && proc.pid) {
      killProcessGroup(proc.pid, "SIGKILL");
    }
  }, 2000);
  return true;
}

export function killAllManagedProcesses(reason = "kill_all"): number {
  let count = 0;
  for (const id of processes.keys()) {
    if (killManagedProcess(id, reason)) count++;
  }
  return count;
}

export function killManagedProcessesForChat(chatId: number, reason = "kill_chat"): number {
  let count = 0;
  for (const proc of processes.values()) {
    if (proc.chatId === chatId && killManagedProcess(proc.id, reason)) count++;
  }
  return count;
}

export function killManagedProcessesForScope(scopeId: string, reason = "kill_scope"): number {
  let count = 0;
  for (const proc of processes.values()) {
    if (proc.scopeId === scopeId && killManagedProcess(proc.id, reason)) count++;
  }
  return count;
}

export function execManagedCommand(
  command: string,
  cwd: string,
  options: {
    onData: (data: Buffer) => void;
    signal?: AbortSignal;
    timeout?: number;
    env?: NodeJS.ProcessEnv;
    chatId?: number;
    scopeId?: string | null;
  },
): Promise<{ exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const child = spawn("/bin/bash", ["-lc", command], {
      cwd,
      detached: true,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const record: ManagedProcess & { child: ChildProcess } = {
      id,
      chatId: options.chatId,
      scopeId: options.scopeId ?? undefined,
      command,
      cwd,
      pid: child.pid ?? null,
      startedAt: Date.now(),
      child,
    };
    processes.set(id, record);

    logger.info("Managed process started", {
      id,
      chatId: options.chatId,
      scopeId: options.scopeId ?? undefined,
      pid: child.pid,
      cwd,
      command,
    });

    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    if (options.timeout !== undefined && options.timeout > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        killManagedProcess(id, `timeout:${options.timeout}`);
      }, options.timeout * 1000);
    }

    const onAbort = () => {
      killManagedProcess(id, "abort_signal");
    };

    if (options.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", options.onData);
    child.stderr.on("data", options.onData);

    child.on("error", (err) => {
      processes.delete(id);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      options.signal?.removeEventListener("abort", onAbort);
      logger.warn("Managed process spawn error", { id, error: errorMessage(err) });
      reject(err);
    });

    child.on("close", (code) => {
      processes.delete(id);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      options.signal?.removeEventListener("abort", onAbort);
      logger.info("Managed process ended", {
        id,
        chatId: options.chatId,
        scopeId: options.scopeId ?? undefined,
        pid: child.pid,
        exitCode: code,
      });

      if (options.signal?.aborted) {
        reject(new Error("aborted"));
        return;
      }
      if (timedOut) {
        reject(new Error(`timeout:${options.timeout}`));
        return;
      }
      resolve({ exitCode: code });
    });
  });
}
