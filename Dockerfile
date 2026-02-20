# Rachel9 — Multi-stage Dockerfile
# Much simpler than Rachel8: no Claude CLI, no OAuth tokens, no credential sync.
# Just Bun + pi-mono + Z.ai API key.

# ---------------------------------------------------------------------------
# Stage 1: Builder — install dependencies
# ---------------------------------------------------------------------------
FROM oven/bun:latest AS builder
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

COPY . .

# ---------------------------------------------------------------------------
# Stage 2: Runtime — lean production image
# ---------------------------------------------------------------------------
FROM oven/bun:latest

# System dependencies + Python ecosystem
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ffmpeg \
    python3 \
    python3-pip \
    python3-venv \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install UV (fast Python package manager — replaces pip/venv for scripts)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
    && mv /root/.local/bin/uv /usr/local/bin/uv \
    && mv /root/.local/bin/uvx /usr/local/bin/uvx

# Non-root user (UID 1001 matches Rachel Cloud orchestrator expectations)
RUN groupadd -g 1001 rachel && useradd -m -u 1001 -g rachel rachel

WORKDIR /app
COPY --from=builder --chown=rachel:rachel /app /app

# Data volume mount point (persistent storage)
RUN mkdir -p /data && chown rachel:rachel /data

# Create empty .env so env.ts doesn't exit on missing file
# (container env vars are passed via Docker, not .env file)
RUN touch /app/.env && chown rachel:rachel /app/.env

USER rachel

# Webhook port (Rachel Cloud containers)
EXPOSE 8443

# Health check for orchestrator monitoring
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:8443/health || exit 1

CMD ["bun", "run", "src/index.ts"]
