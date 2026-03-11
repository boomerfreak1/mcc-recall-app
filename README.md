# Recall — Project Intelligence Platform

Recall indexes a project's document corpus, extracts structured knowledge (decisions, dependencies, gaps, stakeholders, milestones), and provides a living dashboard, risk radar, and auto-generated briefings.

## Tech Stack

- **Next.js 14** (App Router, TypeScript, Tailwind CSS)
- **SQLite** (better-sqlite3) — structured data (documents, chunks, entities)
- **ChromaDB** — vector storage for semantic search
- **Ollama** (nomic-embed-text) — local embeddings, zero API cost
- **Anthropic Claude** — entity extraction (Haiku) and answer generation (Sonnet)
- **GitHub** — document repository with webhook-triggered indexing

## Local Setup

### Prerequisites

- Node.js 18+
- [Ollama](https://ollama.com) installed locally
- [ChromaDB](https://docs.trychroma.com) server

### 1. Install Ollama and pull the embedding model

```bash
# Install Ollama (macOS)
brew install ollama

# Start Ollama
ollama serve

# Pull the embedding model (~300MB)
ollama pull nomic-embed-text
```

### 2. Install and start ChromaDB

```bash
# Install via pip
pip install chromadb

# Start ChromaDB server with persistent storage
chroma run --path ./data/chroma
```

ChromaDB will run on `http://localhost:8000` by default.

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

Edit `.env` with your values:

- `GITHUB_TOKEN` — GitHub personal access token with repo read access
- `GITHUB_REPO` — Target repo in `owner/repo` format
- `ANTHROPIC_API_KEY` — Your Anthropic API key
- `EMBEDDING_PROVIDER` — `ollama` (default)
- `OLLAMA_BASE_URL` — `http://localhost:11434` (default)
- `CHROMA_HOST` — `localhost` (default)
- `CHROMA_PORT` — `8000` (default)
- `DATA_DIR` — `./data` (default, for SQLite database)

### 5. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the health check dashboard.

### 6. Index your documents

Click the **"Index Now"** button on the home page. This will:
1. Pull all supported files from the configured GitHub repo
2. Parse them (.docx, .xlsx, .csv, .md, .pdf)
3. Chunk them along natural boundaries (headings, sheets, pages)
4. Generate embeddings via Ollama
5. Store in SQLite (structured data) and ChromaDB (vectors)

Then navigate to `/chat` to ask questions about your documents.

## Project Structure

```
app/                    # Next.js App Router routes
  api/
    ask/                # POST /api/ask — RAG question answering (streamed)
    health/             # GET /api/health — service health checks
    index/              # POST /api/index — trigger full indexing pipeline
    webhooks/github/    # POST /api/webhooks/github — push event handler
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
```

## Supported Document Formats

| Format | Parser | Structure Extraction |
|--------|--------|---------------------|
| .docx  | mammoth | Headings (H1-H6) |
| .xlsx/.xls | SheetJS | Sheets, header rows |
| .csv   | papaparse | Header columns |
| .md    | Regex | ATX headings (# - ######) |
| .pdf   | pdf-parse | Pages, heuristic headings |

## GitHub Webhook Setup

To enable automatic re-indexing when documents are pushed:

1. Go to your repo → Settings → Webhooks → Add webhook
2. Payload URL: `https://your-domain/api/webhooks/github`
3. Content type: `application/json`
4. Secret: Set the same value as `GITHUB_WEBHOOK_SECRET` in your `.env`
5. Events: Select "Just the push event"
