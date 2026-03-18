FROM node:20-bookworm-slim

# Install system dependencies for better-sqlite3, Ollama, ChromaDB
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    zstd \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install ChromaDB in a virtual environment
RUN python3 -m venv /opt/chroma-venv && \
    /opt/chroma-venv/bin/pip install --no-cache-dir chromadb

# Install Ollama
RUN curl -fsSL https://ollama.com/install.sh | sh

# Pull the embedding model during build
# Start Ollama temporarily to pull the model, then stop it
RUN ollama serve & \
    sleep 5 && \
    ollama pull nomic-embed-text && \
    ollama pull llama3.2:1b && \
    pkill ollama || true

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci --production=false

# Copy source code
COPY . .

# Build the Next.js application
RUN npm run build

# Create data directory
RUN mkdir -p /data

# Copy startup script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 3000

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV OLLAMA_BASE_URL=http://localhost:11434
ENV CHROMA_HOST=localhost
ENV CHROMA_PORT=8000
ENV OLLAMA_CHAT_MODEL=llama3.2:1b
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["/app/start.sh"]
