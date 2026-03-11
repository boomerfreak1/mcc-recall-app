# Recall — Project Intelligence Platform

Recall indexes a project's document corpus, extracts structured knowledge (decisions, dependencies, gaps, stakeholders, milestones), and provides a living dashboard, risk radar, and auto-generated briefings.

## Tech Stack

- **Next.js 14** (App Router, TypeScript, Tailwind CSS)
- **SQLite** (better-sqlite3) — structured data (documents, chunks, entities)
- **ChromaDB** — vector storage for semantic search
- **Ollama** (nomic-embed-text) — local embeddings, zero API cost
- **Anthropic Claude** — entity extraction (Haiku) and answer generation (Sonnet)
- **GitHub** — document repository with webhook-triggered indexing

## Railway Deployment

### 1. Create a new Railway project

1. Go to [railway.app](https://railway.app) and create a new project
2. Select "Deploy from GitHub repo" and connect `boomerfreak1/mcc-recall-app`
3. Railway will detect the Dockerfile and build automatically

### 2. Add a persistent volume

1. In your Railway service, go to **Settings → Volumes**
2. Click **Add Volume**
3. Mount path: `/data`
4. This stores the SQLite database and ChromaDB data across deploys

### 3. Set environment variables

In **Settings → Variables**, add:

| Variable | Value |
|----------|-------|
| `GITHUB_TOKEN` | Your GitHub personal access token (repo scope) |
| `GITHUB_REPO` | `boomerfreak1/mcc-recall-app` |
| `GITHUB_WEBHOOK_SECRET` | A random string for webhook verification |
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `DATA_DIR` | `/data` |
| `PORT` | `3000` |

The following have defaults and don't need to be set unless you're customizing:
- `EMBEDDING_PROVIDER` (default: `ollama`)
- `OLLAMA_BASE_URL` (default: `http://localhost:11434`)
- `CHROMA_HOST` (default: `localhost`)
- `CHROMA_PORT` (default: `8000`)

### 4. Deploy

Railway will build the Docker image (installs Ollama + nomic-embed-text model + ChromaDB), then start all services via the `start.sh` script.

### 5. Set up the GitHub webhook

1. Go to your GitHub repo → **Settings → Webhooks → Add webhook**
2. Payload URL: `https://<your-railway-domain>/api/webhooks/github`
3. Content type: `application/json`
4. Secret: Same value as `GITHUB_WEBHOOK_SECRET` in Railway
5. Events: Select **"Just the push event"**

### 6. Initial index

After deploy, open your Railway app URL and click **"Index Now"** to run the first full index. Subsequent pushes to the repo will trigger incremental re-indexing automatically via the webhook.

## Local Development

### Prerequisites

- Node.js 18+
- [Ollama](https://ollama.com) installed locally
- [ChromaDB](https://docs.trychroma.com) server

### 1. Install Ollama and pull the embedding model

```bash
# Install Ollama (macOS)
brew install ollama

# Start Ollama (in a separate terminal)
ollama serve

# Pull the embedding model (~300MB)
ollama pull nomic-embed-text
```

### 2. Install and start ChromaDB

```bash
# Install via pip
pip install chromadb

# Start ChromaDB server (in a separate terminal)
chroma run --path ./data/chroma
```

### 3. Clone and install

```bash
git clone https://github.com/boomerfreak1/mcc-recall-app.git
cd mcc-recall-app
npm install
```

### 4. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values (see Railway variables table above). For local dev, set `DATA_DIR=./data`.

### 5. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the health check dashboard. Click **"Index Now"** to index your documents, then navigate to `/chat` to ask questions.

## Project Structure

```
app/                    # Next.js App Router routes
  api/
    ask/                # POST /api/ask — RAG question answering (streamed)
    health/             # GET /api/health — service health checks (JSON booleans)
    index/              # POST /api/index — trigger full indexing pipeline
    webhooks/github/    # POST /api/webhooks/github — verified push event handler
  chat/                 # Chat UI for Q&A
components/ui/          # shadcn/ui components (button, card, input, dialog)
lib/
  github/               # GitHub API client
  embeddings/           # Embedding provider interface (Ollama)
  parsers/              # Document parsers (.docx, .xlsx, .csv, .md, .pdf)
  indexing/             # Chunking engine + indexing pipeline
  storage/              # SQLite (db.ts) + ChromaDB (vectorstore.ts)
  ai/                   # Anthropic API wrappers (TODO)
scripts/                # Test and utility scripts
Dockerfile              # Single-container build (Node.js + Ollama + ChromaDB)
start.sh                # Startup script: launches Ollama, ChromaDB, then Next.js
```

## Supported Document Formats

| Format | Parser | Structure Extraction |
|--------|--------|---------------------|
| .docx  | mammoth | Headings (H1-H6) |
| .xlsx/.xls | SheetJS | Sheets, header rows |
| .csv   | papaparse | Header columns |
| .md    | Regex | ATX headings (# - ######) |
| .pdf   | pdf-parse | Pages, heuristic headings |

## Health Check

`GET /api/health` returns:

```json
{
  "status": "healthy",
  "checks": {
    "server": true,
    "ollama": true,
    "sqlite": true,
    "chromadb": true,
    "github": true,
    "anthropic": true
  },
  "details": { ... },
  "index": {
    "documents": 25,
    "chunks": 600,
    "totalTokens": 150000,
    "vectorCount": 600
  }
}
```
