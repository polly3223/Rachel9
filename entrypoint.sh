#!/bin/bash
# Entrypoint script for Rachel9 containers.
# Reads sensitive env vars into a temp file that only the Bun process reads,
# then unsets them from the environment so child processes (bash tool) can't see them.

# Write secrets to a file only readable by rachel user
SECRETS_FILE="/tmp/.rachel-secrets"
cat > "$SECRETS_FILE" <<EOF
GEMINI_API_KEY=${GEMINI_API_KEY:-}
ZAI_API_KEY=${ZAI_API_KEY:-}
GROQ_API_KEY=${GROQ_API_KEY:-}
OPENAI_API_KEY=${OPENAI_API_KEY:-}
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
EOF
chmod 400 "$SECRETS_FILE"

# Unset from environment — child processes won't inherit these
unset GEMINI_API_KEY
unset ZAI_API_KEY
unset GROQ_API_KEY
unset OPENAI_API_KEY
unset TELEGRAM_BOT_TOKEN

# Export path so the app knows where to find secrets
export RACHEL_SECRETS_FILE="$SECRETS_FILE"

# Start Rachel9
exec bun run src/index.ts
