import { afterEach, describe, expect, test } from "bun:test";
import {
  execManagedCommand,
  killAllManagedProcesses,
  killManagedProcessesForScope,
  listManagedProcesses,
} from "./process-registry.ts";

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await Bun.sleep(20);
  }
}

afterEach(async () => {
  killAllManagedProcesses("test_cleanup");
  await waitFor(() => listManagedProcesses().length === 0, 1500).catch(() => {});
});

describe("process registry", () => {
  test("removes completed commands from the registry", async () => {
    let output = "";
    const result = await execManagedCommand("printf hello", process.cwd(), {
      onData: (data) => {
        output += data.toString();
      },
      chatId: 1,
      scopeId: "completed-run",
    });

    expect(result.exitCode).toBe(0);
    expect(output).toBe("hello");
    expect(listManagedProcesses()).toHaveLength(0);
  });

  test("times out and removes long-running commands", async () => {
    await expect(
      execManagedCommand("sleep 5", process.cwd(), {
        onData: () => {},
        timeout: 0.1,
        chatId: 1,
        scopeId: "timeout-run",
      }),
    ).rejects.toThrow("timeout:0.1");

    await waitFor(() => listManagedProcesses().length === 0);
  });

  test("kills only processes in the requested scope", async () => {
    const first = execManagedCommand("sleep 30", process.cwd(), {
      onData: () => {},
      chatId: 1,
      scopeId: "run-a",
    }).catch((err: unknown) => err);
    const second = execManagedCommand("sleep 30", process.cwd(), {
      onData: () => {},
      chatId: 1,
      scopeId: "run-b",
    }).catch((err: unknown) => err);

    await waitFor(() => listManagedProcesses().length === 2);

    expect(killManagedProcessesForScope("run-a", "test_scope_kill")).toBe(1);
    await waitFor(() => listManagedProcesses().length === 1);

    const remaining = listManagedProcesses();
    expect(remaining[0]?.scopeId).toBe("run-b");

    killAllManagedProcesses("test_done");
    await Promise.allSettled([first, second]);
    await waitFor(() => listManagedProcesses().length === 0);
  });
});
