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

WORKDIR /workroom
ENTRYPOINT ["/entrypoint.sh"]
