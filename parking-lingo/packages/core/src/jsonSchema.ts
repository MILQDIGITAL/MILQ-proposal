import { z } from "zod";
import { SignReadingSchema } from "./schema";

export type JsonSchema = { [key: string]: unknown };

/** Full JSON Schema (draft 2020-12) generated from the zod schema, with all constraints. */
export const signReadingJsonSchema: JsonSchema = z.toJSONSchema(SignReadingSchema, {
  io: "output",
}) as JsonSchema;

/**
 * Keywords that Claude structured outputs (`output_config.format` / strict tools)
 * do not support. They are stripped from {@link signReadingStructuredOutputSchema};
 * always re-validate the model output with `parseSignReading` afterwards, which
 * enforces them.
 */
const UNSUPPORTED_KEYWORDS = new Set([
  "$schema",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
  "pattern",
]);

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED_KEYWORDS.has(k)) continue;
    out[k] = sanitize(v);
  }
  if (out.type === "object" || "properties" in out) {
    out.additionalProperties = false;
  }
  return out;
}

/**
 * JSON Schema suitable for Claude structured outputs: every object has
 * `additionalProperties: false`, all properties are required, and numeric /
 * string / array constraints are removed (enforced afterwards by zod).
 */
export const signReadingStructuredOutputSchema: JsonSchema = sanitize(signReadingJsonSchema) as JsonSchema;
