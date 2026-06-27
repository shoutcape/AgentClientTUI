import type { JsonObject, JsonValue } from "./types"

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function recordOrNull(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

export function requireJsonObject(value: JsonValue | undefined, label: string): JsonObject {
  if (!isRecord(value)) {
    throw new Error(`${label} response was not an object`)
  }

  return value as JsonObject
}
