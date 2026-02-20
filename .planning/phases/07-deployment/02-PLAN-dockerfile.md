# Plan 02: Dockerfile + Container Support (Wave 1)

Covers: DEPLOY-05

## Step 1: Create `Dockerfile`

Multi-stage build, much simpler than Rachel8's (no Claude CLI!):

```dockerfile
# Stage 1: Builder
FROM oven/bun:latest AS builder
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production
COPY . .

# Stage 2: Runtime
FROM oven/bun:latest
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ffmpeg python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd -g 1001 rachel && useradd -m -u 1001 -g rachel rachel
WORKDIR /app
COPY --from=builder --chown=rachel:rachel /app /app

# Create data volume mount point
RUN mkdir -p /data && chown rachel:rachel /data

# Create empty .env so env.ts doesn't exit
RUN touch /app/.env && chown rachel:rachel /app/.env

USER rachel
EXPOSE 8443

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:8443/health || exit 1

CMD ["bun", "run", "src/index.ts"]
```

Key differences from Rachel8:
- No Claude CLI installation (~500MB smaller)
- No entrypoint.sh credential symlinks
- No glibc dependency workarounds
- Simpler health check
- Direct `CMD ["bun", "run", "src/index.ts"]`

## Step 2: Create `.dockerignore`

```
node_modules/
.git/
.env
.planning/
*.md
!skills/**/*.md
```

## Verification

1. `docker build -t rachel9:latest .` builds successfully
2. Container starts in webhook mode with `RACHEL_CLOUD=true`
3. Health check passes at `/health`
4. Container size significantly smaller than Rachel8
