FROM node:22-slim

# Runtime dependencies for network enforcement + diagnostics
RUN apt-get update && apt-get install -y --no-install-recommends \
    iptables curl dnsutils iproute2 procps jq ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Install arc402-cli globally — Linux-compiled native binaries (better-sqlite3, etc.)
# This runs at image build time so native addons compile for Linux, not the host OS.
# ARG allows pinning a specific version: docker build --build-arg ARC402_CLI_VERSION=1.4.19
ARG ARC402_CLI_VERSION=latest
RUN npm install -g arc402-cli@${ARC402_CLI_VERSION} --build-from-source 2>&1 | tail -5
# Stamp the CLI version as an image label so workroom start can detect stale images.
LABEL arc402.cli.version=${ARC402_CLI_VERSION}

# Create workroom user with the same UID/GID as the host user (default: 1000).
# This ensures bind-mounted volumes are readable/writable without permission fights.
# Override at build time: docker build --build-arg HOST_UID=1001 --build-arg HOST_GID=1001
ARG HOST_UID=1000
ARG HOST_GID=1000
# node:22-slim already has a 'node' user at UID 1000. Rename it to 'workroom'
# so the container user matches the host user (bind mount permissions).
RUN usermod -l workroom -d /workroom -m node \
    && groupmod -n workroom node \
    && usermod -u ${HOST_UID} workroom 2>/dev/null || true \
    && groupmod -g ${HOST_GID} workroom 2>/dev/null || true

# Workroom scripts
COPY entrypoint.sh /entrypoint.sh
COPY dns-refresh.sh /dns-refresh.sh
COPY policy-parser.sh /policy-parser.sh
COPY derive-policy.sh /derive-policy.sh
RUN chmod +x /entrypoint.sh /dns-refresh.sh /policy-parser.sh /derive-policy.sh

# Job workspace directory
RUN mkdir -p /workroom/jobs && chown workroom:workroom /workroom/jobs

# OpenClaw runtime directory (mounted from host)
RUN mkdir -p /workroom/openclaw && chown workroom:workroom /workroom/openclaw

# Worker specialisation directories (created by worker init, but ensure they exist)
RUN mkdir -p /workroom/.arc402/worker/{knowledge,datasets,skills,memory} \
    && chown -R workroom:workroom /workroom/.arc402

# Home directory for workroom user (auth files mounted here)
RUN mkdir -p /home/workroom/.openclaw && chown -R workroom:workroom /home/workroom

# Arena directories — feed index, profile cache, daemon state, approval queue
RUN mkdir -p /workroom/arena/{feed,profile,state,queue} \
    && chown -R workroom:workroom /workroom/arena

# Default arena policy (can be overridden by mount)
COPY arena-policy.yaml /workroom/defaults/arena-policy.yaml

WORKDIR /workroom
ENTRYPOINT ["/entrypoint.sh"]
