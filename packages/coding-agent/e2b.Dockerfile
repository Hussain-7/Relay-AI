# E2B custom template for the Relay AI coding agent
# Build with: e2b template build --dockerfile e2b.Dockerfile --name relay-coding-agent

FROM node:20-slim

# Install system deps
RUN apt-get update && apt-get install -y \
    git \
    curl \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install the coding agent CLI globally
WORKDIR /opt/relay-agent
COPY package.json ./
COPY dist/ ./dist/
RUN npm install --production && npm link

# Verify it's accessible
RUN relay-agent --help || true

# Default workspace
RUN mkdir -p /workspace

WORKDIR /workspace
