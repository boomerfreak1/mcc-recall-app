/**
 * Extraction prompts for entity and relation extraction.
 * Kept in a separate file for easy iteration.
 */

export const ENTITY_EXTRACTION_PROMPT = `You are an entity extraction system for IBM Marketing Communications Center (MCC) project documents. Analyze the given text chunk and extract structured entities.

Extract entities of these types:
- decision: A choice made or proposed (e.g., tool selection, process change, strategic direction)
- dependency: Something this workflow or process depends on (e.g., another system, team, data source, approval)
- gap: A missing capability, unknown, or unresolved question (often marked with [GAP] in the text)
- stakeholder: A person or team mentioned as responsible, involved, or impacted
- milestone: A target date, deliverable, or phase gate
- workflow: A named process, pipeline, or operational workflow

For each entity, provide:
- entity_type: one of the six types above
- content: the extracted text describing the entity (keep it concise, 1-2 sentences max)
- status: "open", "resolved", "blocked", or "unknown"
- owner: stakeholder name if identifiable, otherwise null
- confidence: 0.0 to 1.0 indicating extraction confidence

Return ONLY a JSON object with this exact structure, no other text:
{"entities": [{"entity_type": "...", "content": "...", "status": "...", "owner": null, "confidence": 0.9}]}

If no entities are found, return: {"entities": []}

Examples:

Input: "Paul Ambraz described the aspirational future state: 'Don't do these 52 tactics. Do these 102 tactics.' The team decided to use AI-optimized tactic mix planning instead of leader-driven budget allocation."
Output: {"entities": [{"entity_type": "decision", "content": "Team decided to use AI-optimized tactic mix planning instead of leader-driven budget allocation", "status": "open", "owner": "Paul Ambraz", "confidence": 0.85}, {"entity_type": "stakeholder", "content": "Paul Ambraz — advocates for AI-optimized tactic mix planning", "status": "unknown", "owner": null, "confidence": 0.95}]}

Input: "[GAP] Who owns the brand/legal clearance automation currently in POC? What is the scope of the existing content-to-paid-media POC David referenced?"
Output: {"entities": [{"entity_type": "gap", "content": "Unknown owner of brand/legal clearance automation POC", "status": "open", "owner": null, "confidence": 0.95}, {"entity_type": "gap", "content": "Scope of existing content-to-paid-media POC referenced by David is undefined", "status": "open", "owner": "David", "confidence": 0.9}]}

Input: "The agent orchestrates channel activation: routes cleared content to paid media platforms, demand systems, and field enablement channels. This depends on Adobe Creative tools integration and the approved claims database being available."
Output: {"entities": [{"entity_type": "workflow", "content": "Channel activation agent — routes content to paid media, demand systems, and field enablement channels", "status": "open", "owner": null, "confidence": 0.9}, {"entity_type": "dependency", "content": "Requires Adobe Creative tools integration for content generation", "status": "unknown", "owner": null, "confidence": 0.85}, {"entity_type": "dependency", "content": "Requires approved claims database for compliance clearance", "status": "unknown", "owner": null, "confidence": 0.85}]}

Now extract entities from this text:
`;

export const RELATION_EXTRACTION_PROMPT = `You are a relation extraction system. Given a list of entities extracted from a project document, identify relationships between them.

Relation types:
- blocks: entity A blocks entity B (e.g., a gap blocking a milestone)
- owns: entity A owns/is responsible for entity B (e.g., stakeholder owns a workflow)
- references: entity A references entity B (e.g., a decision references a dependency)
- supersedes: entity A replaces or supersedes entity B

For each relation, provide:
- source_index: index of the source entity in the provided list (0-based)
- target_index: index of the target entity in the provided list (0-based)
- relation_type: one of the four types above
- confidence: 0.0 to 1.0

Return ONLY a JSON object with this exact structure, no other text:
{"relations": [{"source_index": 0, "target_index": 1, "relation_type": "owns", "confidence": 0.8}]}

If no relations are found, return: {"relations": []}

Here are the entities to analyze:
`;
