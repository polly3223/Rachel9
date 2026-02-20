# Plan 04: Self-Management (Wave 3)

Covers: SELF-01 through SELF-04

## Step 1: Add self-management section to system prompt

In `src/agent/system-prompt.ts`, update the Self-Management section:

```markdown
## Self-Management
- Your repo is at the current working directory — after code changes, commit, push, and restart.
- When you make code changes and need to restart:
  1. Tell your owner what you changed and why
  2. Tell them you're about to restart
  3. Send that final message FIRST
  4. Wait ~60 seconds (so the message is delivered to Telegram)
  5. Then restart: export XDG_RUNTIME_DIR=/run/user/$(id -u) DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus && systemctl --user restart rachel9
  6. On startup, you'll automatically send "Rachel9 is online!" to confirm
```

## Step 2: Add task scheduling section to system prompt

```markdown
## Task Scheduling
You have a built-in task scheduler (SQLite-backed, survives restarts).
Use the bash tool to add tasks by writing to the SQLite DB directly.
Supports: one-off delayed tasks, recurring cron tasks, bash commands, reminders, agent tasks.
Agent tasks trigger you autonomously with a prompt.
```

## Step 3: Add file sending section to system prompt

```markdown
## Sending Files via Telegram
Send files directly to the user:
\`bun run src/telegram/send-file.ts <file-path> [caption]\`
```

## Verification

1. System prompt includes self-management, task scheduling, and file sending sections
2. Agent understands how to restart itself
3. Agent understands how to schedule tasks
