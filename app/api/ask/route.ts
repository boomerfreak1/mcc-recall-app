import { NextRequest } from "next/server";
import { classifyQuery, retrieve } from "@/lib/ai";
import type { RetrievedEntity } from "@/lib/ai";

/**
 * POST /api/ask — Smart RAG question answering endpoint.
 * Classifies the query intent, retrieves context using the appropriate strategy
 * (factual/synthesis/relational/exploratory), then streams the LLM response.
 */

const SYSTEM_PROMPT = `You are Recall, a project intelligence assistant for IBM's Marketing Communications Center (MCC). You answer questions using both document context and extracted entity data.

Rules:
- Answer based ONLY on the provided context and entities. If the context doesn't contain enough information, say so clearly.
- Cite your sources using [Source: document_title > section_path] format after each claim.
- When referencing extracted entities, mention their type, status, and owner when relevant.
- Be concise but thorough. Prefer structured answers with bullet points when listing multiple items.
- If multiple documents or entities address the question, synthesize across them and note any contradictions.
- When quoting directly, use quotation marks and cite the specific source.
- For exploratory queries about risks or concerns, prioritize blocked items, stale gaps, and unowned dependencies.
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

    // Step 1: Classify the query intent
    console.log(`[ask] Classifying query: "${question.substring(0, 80)}..."`);
    const classification = await classifyQuery(question);
    console.log(`[ask] Intent: ${classification.intent}, domain: ${classification.domain}, type: ${classification.entity_type}`);

    // Step 2: Retrieve context using the appropriate strategy
    const retrieval = await retrieve(classification, question);
    console.log(`[ask] Strategy: ${retrieval.retrieval_strategy}, chunks: ${retrieval.chunks.length}, entities: ${retrieval.entities.length}`);

    if (retrieval.chunks.length === 0 && retrieval.entities.length === 0) {
      return new Response(
        JSON.stringify({
          answer:
            "No indexed documents or entities found. Please run the indexing pipeline first.",
          sources: [],
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Step 3: Stream from Ollama
    const ollamaBase = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, "");
    const chatModel = process.env.OLLAMA_CHAT_MODEL ?? "llama3.2:3b";

    const ollamaResponse = await fetch(`${ollamaBase}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: chatModel,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Context from indexed project documents and extracted entities:\n\n${retrieval.context_text}\n\n---\n\nQuery type: ${classification.intent}\nQuestion: ${question}`,
          },
        ],
        stream: true,
      }),
    });

    if (!ollamaResponse.ok) {
      const errText = await ollamaResponse.text();
      throw new Error(`Ollama chat error (${ollamaResponse.status}): ${errText}`);
    }

    // Create a ReadableStream to pipe the response
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          // Send source metadata
          const sourcesData = retrieval.chunks.map((c) => ({
            document: c.document_title,
            section: c.section_path,
            domain: c.domain,
            distance: c.distance,
          }));

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "sources", sources: sourcesData })}\n\n`
            )
          );

          // Send entity metadata for UI display
          if (retrieval.entities.length > 0) {
            const entityData: RetrievedEntity[] = retrieval.entities.map((e) => ({
              id: e.id,
              entity_type: e.entity_type,
              content: e.content,
              status: e.status,
              owner: e.owner,
              domain: e.domain,
              source_document: e.source_document,
              relation_type: e.relation_type,
            }));

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "entities", entities: entityData, intent: classification.intent })}\n\n`
              )
            );
          }

          // Stream text tokens from Ollama
          const reader = ollamaResponse.body?.getReader();
          if (!reader) throw new Error("No response body from Ollama");

          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const parsed = JSON.parse(line);
                if (parsed.message?.content) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: "text", text: parsed.message.content })}\n\n`
                    )
                  );
                }
              } catch {
                // Skip malformed JSON lines
              }
            }
          }

          // Process remaining buffer
          if (buffer.trim()) {
            try {
              const parsed = JSON.parse(buffer);
              if (parsed.message?.content) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "text", text: parsed.message.content })}\n\n`
                  )
                );
              }
            } catch {
              // Skip
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
