#!/bin/bash
set -e

# Clean up child processes on exit
cleanup() {
  echo "[start] Shutting down..."
  kill $CHROMA_PID $OLLAMA_PID 2>/dev/null || true
  wait $CHROMA_PID $OLLAMA_PID 2>/dev/null || true
  echo "[start] All processes stopped."
}
trap cleanup EXIT SIGTERM SIGINT

DATA_DIR="${DATA_DIR:-/data}"
CHROMA_PORT="${CHROMA_PORT:-8000}"

echo "[start] Creating data directories..."
mkdir -p "$DATA_DIR/chroma"
mkdir -p "$DATA_DIR/gaps"

# Seed gaps Excel from repo if not already on the volume
if [ ! -f "$DATA_DIR/gaps/Workflows-All-Domains.xlsx" ] && [ -f /app/data/gaps/Workflows-All-Domains.xlsx ]; then
  echo "[start] Copying gaps Excel to persistent volume..."
  cp /app/data/gaps/Workflows-All-Domains.xlsx "$DATA_DIR/gaps/"
fi

# Start ChromaDB in the background
echo "[start] Starting ChromaDB on port $CHROMA_PORT..."
/opt/chroma-venv/bin/chroma run \
  --path "$DATA_DIR/chroma" \
  --host 0.0.0.0 \
  --port "$CHROMA_PORT" \
  > "$DATA_DIR/chroma.log" 2>&1 &
CHROMA_PID=$!

# Start Ollama in the background
echo "[start] Starting Ollama..."
ollama serve &
OLLAMA_PID=$!

# Wait for Ollama to be ready (up to 60s)
echo "[start] Waiting for Ollama to be ready..."
for i in $(seq 1 60); do
  if curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "[start] Ollama is ready (${i}s)."
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "[start] WARNING: Ollama did not start within 60 seconds."
  fi
  sleep 1
done

# Verify nomic-embed-text is available
if curl -sf http://localhost:11434/api/tags | grep -q "nomic-embed-text"; then
  echo "[start] nomic-embed-text model is loaded."
else
  echo "[start] Pulling nomic-embed-text model..."
  ollama pull nomic-embed-text
fi

# Verify chat model is available
OLLAMA_CHAT_MODEL="${OLLAMA_CHAT_MODEL:-llama3.2:1b}"
MODEL_BASE=$(echo "$OLLAMA_CHAT_MODEL" | cut -d: -f1)
if curl -sf http://localhost:11434/api/tags | grep -q "$MODEL_BASE"; then
  echo "[start] $OLLAMA_CHAT_MODEL model is loaded."
else
  echo "[start] Pulling $OLLAMA_CHAT_MODEL model..."
  ollama pull "$OLLAMA_CHAT_MODEL"
fi

# Wait for ChromaDB to be ready (up to 60s)
echo "[start] Waiting for ChromaDB to be ready..."
for i in $(seq 1 60); do
  if curl -sf "http://localhost:$CHROMA_PORT/api/v1/heartbeat" > /dev/null 2>&1 || \
     curl -sf "http://localhost:$CHROMA_PORT/api/v2/heartbeat" > /dev/null 2>&1; then
    echo "[start] ChromaDB is ready (${i}s)."
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "[start] WARNING: ChromaDB did not start within 60 seconds. Check $DATA_DIR/chroma.log"
    cat "$DATA_DIR/chroma.log" 2>/dev/null || true
  fi
  sleep 1
done

# Start Next.js (exec replaces shell so signals propagate)
echo "[start] Starting Next.js on port ${PORT:-3000}..."
exec npx next start -p "${PORT:-3000}"
