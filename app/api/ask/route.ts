import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getEmbeddingProvider } from "@/lib/embeddings";
import { querySimilarChunks } from "@/lib/storage/vectorstore";

/**
 * POST /api/ask — RAG question answering endpoint.
 * Embeds the question, retrieves similar chunks, sends to Claude Sonnet with
 * source citation instructions, and streams the response back.
 */

const SYSTEM_PROMPT = `You are Recall, a project intelligence assistant. You answer questions about a project's document corpus using the provided context chunks.

Rules:
- Answer based ONLY on the provided context. If the context doesn't contain enough information, say so clearly.
- Cite your sources using [Source: document_title > section_path] format after each claim.
- Be concise but thorough. Prefer structured answers with bullet points when listing multiple items.
- If multiple documents address the question, synthesize across them and note any contradictions.
- When quoting directly, use quotation marks and cite the specific source.
- If asked about something not in the context, respond: "I don't have information about that in the indexed documents."`;

export async function POST(request: NextRequest) {
  try {
    const { question } = await request.json();

    if (!question || typeof question !== "string") {
      return new Response(
        JSON.stringify({ error: "Question is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Step 1: Embed the question
    const embedder = getEmbeddingProvider();
    const { embedding } = await embedder.generateEmbedding(question);

    // Step 2: Query ChromaDB for similar chunks
    const chunks = await querySimilarChunks(embedding, { nResults: 10 });

    if (chunks.length === 0) {
      return new Response(
        JSON.stringify({
          answer:
            "No indexed documents found. Please run the indexing pipeline first.",
          sources: [],
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Step 3: Assemble context
    const contextBlocks = chunks.map(
      (chunk, i) =>
        `--- Context ${i + 1} ---
Document: ${chunk.metadata.document_title}
Section: ${chunk.metadata.section_path}
Domain: ${chunk.metadata.domain}

${chunk.content}`
    );

    const contextText = contextBlocks.join("\n\n");

    // Step 4: Stream from Claude Sonnet
    const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
    const anthropic = new Anthropic({ apiKey });

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Context from indexed project documents:\n\n${contextText}\n\n---\n\nQuestion: ${question}`,
        },
      ],
    });

    // Create a ReadableStream to pipe the response
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          // First, send source metadata as a JSON event
          const sourcesData = chunks.map((c) => ({
            document: c.metadata.document_title,
            section: c.metadata.section_path,
            domain: c.metadata.domain,
            distance: c.distance,
          }));

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "sources", sources: sourcesData })}\n\n`
            )
          );

          // Stream text tokens
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "text", text: event.delta.text })}\n\n`
                )
              );
            }
          }

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "done" })}\n\n`
            )
          );
          controller.close();
        } catch (error) {
          const msg =
            error instanceof Error ? error.message : String(error);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", error: msg })}\n\n`
            )
          );
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[ask] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
