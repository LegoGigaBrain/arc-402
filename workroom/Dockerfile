FROM node:22-slim

# Runtime dependencies for network enforcement + diagnostics
RUN apt-get update && apt-get install -y --no-install-recommends \
    iptables curl dnsutils iproute2 procps jq \
    && rm -rf /var/lib/apt/lists/*

# Non-root user for daemon execution
RUN useradd -m -s /bin/bash -d /workroom workroom

# Workroom scripts
COPY entrypoint.sh /entrypoint.sh
COPY dns-refresh.sh /dns-refresh.sh
COPY policy-parser.sh /policy-parser.sh
RUN chmod +x /entrypoint.sh /dns-refresh.sh /policy-parser.sh

# Job workspace directory
RUN mkdir -p /workroom/jobs && chown workroom:workroom /workroom/jobs

# Arena directories — feed index, profile cache, daemon state, approval queue
RUN mkdir -p /workroom/arena/{feed,profile,state,queue} \
    && chown -R workroom:workroom /workroom/arena

# Default arena policy (can be overridden by mount)
COPY arena-policy.yaml /workroom/defaults/arena-policy.yaml

WORKDIR /workroom
ENTRYPOINT ["/entrypoint.sh"]
