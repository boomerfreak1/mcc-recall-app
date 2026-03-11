# Recall — Project Intelligence Platform

Recall indexes a project's document corpus, extracts structured knowledge (decisions, dependencies, gaps, stakeholders, milestones), and provides a living dashboard, risk radar, and auto-generated briefings.

## Tech Stack

- **Next.js 14** (App Router, TypeScript, Tailwind CSS)
- **SQLite** — structured data (documents, entities, risk items)
- **ChromaDB** — vector storage for semantic search
- **Ollama** (nomic-embed-text) — local embeddings, zero API cost
- **Anthropic Claude** — entity extraction (Haiku) and answer generation (Sonnet)
- **GitHub** — document repository with webhook-triggered indexing

## Local Setup

### Prerequisites

- Node.js 18+
- [Ollama](https://ollama.com) installed locally

### 1. Install Ollama and pull the embedding model

```bash
# Install Ollama (macOS)
brew install ollama

# Start Ollama
ollama serve

# Pull the embedding model (~300MB)
ollama pull nomic-embed-text
```

Verify Ollama is running:

```bash
curl http://localhost:11434/api/tags
```

### 2. Clone and install

```bash
git clone https://github.com/boomerfreak1/mcc-recall-app.git
cd mcc-recall-app
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

- `GITHUB_TOKEN` — GitHub personal access token with repo read access
- `GITHUB_REPO` — Target repo in `owner/repo` format
- `ANTHROPIC_API_KEY` — Your Anthropic API key
- `EMBEDDING_PROVIDER` — `ollama` (default)
- `OLLAMA_BASE_URL` — `http://localhost:11434` (default)

### 4. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the health check dashboard.

## Project Structure

```
app/                    # Next.js App Router routes
  api/
    health/             # GET /api/health — service health checks
    webhooks/github/    # POST /api/webhooks/github — push event handler
components/ui/          # shadcn/ui components (button, card, input, dialog)
lib/
  github/               # GitHub API client
  embeddings/           # Embedding provider interface (Ollama)
  parsers/              # Document parsers (TODO)
  indexing/             # Indexing pipeline (TODO)
  storage/              # SQLite + ChromaDB interfaces (TODO)
  ai/                   # Anthropic API wrappers (TODO)
```

## GitHub Webhook Setup

To enable automatic re-indexing when documents are pushed:

1. Go to your repo → Settings → Webhooks → Add webhook
2. Payload URL: `https://your-domain/api/webhooks/github`
3. Content type: `application/json`
4. Secret: Set the same value as `GITHUB_WEBHOOK_SECRET` in your `.env`
5. Events: Select "Just the push event"
