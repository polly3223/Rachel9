import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";

/**
 * Install Rachel9 as a systemd user service.
 * Uses user-level systemd (no sudo required).
 * Requires `loginctl enable-linger` for persistence across logouts.
 */
export async function installSystemdService(): Promise<void> {
  const home = homedir();
  const serviceDir = join(home, ".config", "systemd", "user");
  await mkdir(serviceDir, { recursive: true });

  const cwd = process.cwd();
  const bunPath = join(home, ".bun", "bin", "bun");

  const service = `[Unit]
Description=Rachel9 AI Assistant
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=120
StartLimitBurst=3

[Service]
Type=simple
WorkingDirectory=${cwd}
ExecStart=${bunPath} run src/index.ts
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;

  const servicePath = join(serviceDir, "rachel9.service");
  await writeFile(servicePath, service);
  console.log(`Service file written to ${servicePath}`);

  try {
    execSync("loginctl enable-linger $(whoami)", { stdio: "pipe" });
    console.log("Lingering enabled (service persists after logout)");
  } catch {
    console.warn("Could not enable linger — you may need to run: loginctl enable-linger $(whoami)");
  }

  try {
    execSync("systemctl --user daemon-reload", { stdio: "pipe" });
    execSync("systemctl --user enable rachel9", { stdio: "pipe" });
    execSync("systemctl --user start rachel9", { stdio: "pipe" });
    console.log("Rachel9 service installed, enabled, and started!");
  } catch (err) {
    console.error("Failed to start service:", (err as Error).message);
    console.log("Try manually: systemctl --user start rachel9");
  }
}
