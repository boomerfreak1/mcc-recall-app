# Deploy and Host Recall with Railway

Recall is a project intelligence platform that indexes workflow documents from GitHub, extracts entities with a multi-model LLM pipeline, and surfaces gaps, risks, and health scores through an interactive dashboard. Built on Next.js 14 with SQLite, ChromaDB, and local Ollama embeddings, it deploys in days as a single Docker container on Railway.

## About Hosting Recall

Recall turns a project's document corpus into a living intelligence layer. It parses DOCX, XLSX, CSV, Markdown, and PDF files, chunks them along structural boundaries, generates local embeddings via Ollama, and extracts six entity types (decisions, dependencies, gaps, stakeholders, milestones, workflows) using LLM-powered analysis. The platform provides a dashboard with domain health scores, a RAG chat interface for querying documents, automated gap tracking across domains, workflow blueprint browsing, a cross-workflow overlap heatmap, and a risk radar with six detection rules. Incremental SHA-based indexing means only changed documents are reprocessed on updates.

## Common Use Cases

- **Project Discovery Intelligence**: Index interview transcripts and workflow analysis documents to surface gaps, entities, and relationships automatically
- **Gap Tracking at Scale**: Track hundreds of discovery gaps across multiple domains with automated staleness detection and risk escalation
- **Document-Grounded Q&A**: Ask natural language questions about your project corpus with cited, source-grounded answers via RAG chat
- **Cross-Workflow Analysis**: Generate overlap heatmaps to identify shared capabilities and consolidation opportunities across workflows
- **Stakeholder Readiness Dashboards**: Quantify project readiness with composite health scores based on gap resolution, dependency coverage, decision freshness, and ownership distribution

## Dependencies for Recall Hosting

### Deployment Dependencies

- **[Node.js 20](https://nodejs.org/)** - Runtime for Next.js application server
- **[Ollama](https://ollama.com/)** - Local LLM inference for embeddings (nomic-embed-text) and chat (llama3.2:1b), bundled in Docker image
- **[ChromaDB](https://www.trychroma.com/)** - Vector database for semantic search over document chunks, bundled in Docker image
- **[SQLite](https://www.sqlite.org/)** via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - Relational storage for entities, documents, gaps, and risk items

### Implementation Details

All three services (Next.js, Ollama, ChromaDB) run inside a single Docker container orchestrated by `start.sh`. The startup script waits for Ollama and ChromaDB to become healthy before launching the Next.js server.

**Indexing pipeline:**
```
GitHub Docs -> Parse (5 formats) -> Chunk (structure-aware, 512 tokens)
  -> Embed (nomic-embed-text, 768-dim) -> Extract (6 entity types via LLM)
  -> Store (SQLite + ChromaDB) -> Serve (Next.js API + UI)
```

**Health check endpoint:** `GET /api/health` returns status for all services (server, ollama, sqlite, chromadb, github, chatModel) plus index statistics.

**Environment variables:**

| Variable | Required | Prompted at Deploy | Description |
|----------|----------|-------------------|-------------|
| `ADMIN_PASSWORD` | Yes | Yes (auto-generated) | Password for triggering indexing from the dashboard |
| `GITHUB_TOKEN` | Yes | Yes | GitHub personal access token with `repo` scope |
| `GITHUB_REPO` | Yes | Yes | Repository to index (`owner/repo` format) |
| `GITHUB_WEBHOOK_SECRET` | No | Yes (auto-generated) | Secret for verifying GitHub webhook signatures |
| `MISTRAL_API_KEY` | No | Yes | Mistral API key for cloud-based extraction (falls back to local Ollama) |
| `DATA_DIR` | No | No | Persistent data directory (default: `/data`) |
| `PORT` | No | No | Server port (default: `3000`) |

### Why Deploy Recall on Railway?

Railway's persistent volumes, single-container Docker support, and automatic health checks make it ideal for Recall's architecture. The `/data` volume preserves the SQLite database and ChromaDB vector store across deploys, so reindexing is only needed when documents change. Railway's built-in domain provisioning and environment variable management eliminate the need for separate infrastructure for secrets, DNS, and TLS. The entire platform runs as one service with no external database dependencies to manage.

## Quick Start

1. **Deploy from template** - Click the Railway deploy button or connect your fork in Railway
2. **Fill in the setup form** - Railway prompts for the required variables:
   - `GITHUB_TOKEN` — GitHub personal access token with `repo` scope ([generate one](https://github.com/settings/tokens))
   - `GITHUB_REPO` — repository to index in `owner/repo` format
   - `ADMIN_PASSWORD` — auto-generated; copy it somewhere safe for dashboard login
   - `GITHUB_WEBHOOK_SECRET` (optional) — auto-generated; copy into your GitHub webhook config
   - `MISTRAL_API_KEY` (optional) — for faster cloud-based entity extraction
3. **Add a volume** - Mount path: `/data` (stores SQLite + ChromaDB data)
4. **Deploy** - Railway builds the Docker image with Ollama + ChromaDB bundled
5. **Index** - Open the app, enter the admin password, and click "Index New Files"
6. **Set up webhook** (optional) - Point GitHub push events to `https://<domain>/api/webhooks/github` with your `GITHUB_WEBHOOK_SECRET`

## Supported Document Formats

| Format | Parser | Structure Extraction |
|--------|--------|---------------------|
| .docx  | mammoth | Headings (H1-H6) |
| .xlsx/.xls | SheetJS | Sheets, header rows |
| .csv   | papaparse | Header columns |
| .md    | remark | ATX headings (# - ######) |
| .pdf   | pdf-parse | Pages, heuristic headings |

## Project Structure

```
app/                    # Next.js App Router routes
  api/
    ask/                # POST /api/ask - RAG question answering (streamed)
    health/             # GET /api/health - service health checks
    index/              # POST /api/index - trigger indexing pipeline
    gaps/               # Gap CRUD endpoints
    risks/              # Risk radar endpoints
    webhooks/github/    # Verified push event handler
  chat/                 # Chat UI
  gaps/                 # Gap tracker UI
lib/
  indexing/             # SHA-based pipeline + structure-aware chunker
  ai/                   # Entity extractor, query classifier, 4-strategy retriever
  parsers/              # 5 format-specific document parsers
  embeddings/           # Ollama embedding client
  storage/              # SQLite (db.ts) + ChromaDB (vectorstore.ts)
  github/               # GitHub API client
  gaps/                 # Excel gap tracker import
  risk/                 # 6-rule risk detector + 4-factor health scoring
Dockerfile              # Single-container build (Node.js + Ollama + ChromaDB)
start.sh                # Startup: launches Ollama, ChromaDB, waits for health, then Next.js
railway.toml            # Railway deployment configuration
```

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
    "chatModel": true
  },
  "index": {
    "documents": 33,
    "chunks": 1847,
    "totalTokens": 450000,
    "vectorCount": 1847
  }
}
```

## Local Development

```bash
# Prerequisites: Node.js 18+, Ollama, ChromaDB

# 1. Start Ollama and pull models
ollama serve
ollama pull nomic-embed-text
ollama pull llama3.2:1b

# 2. Start ChromaDB
pip install chromadb
chroma run --path ./data/chroma

# 3. Install and run
git clone https://github.com/boomerfreak1/mcc-recall-app.git
cd mcc-recall-app
npm install
cp .env.example .env  # Edit with your values, set DATA_DIR=./data
npm run dev
```
