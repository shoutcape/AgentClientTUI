import Fuse, { type FuseResult } from "fuse.js"
import type { CommandDescriptor } from "./registry"

const MAX_ACCEPTABLE_FUZZY_SCORE = 0.6

export function rankCommands(commands: CommandDescriptor[], query: string): CommandDescriptor[] {
  const trimmed = query.trim()
  if (!trimmed) return commands

  const fuse = new Fuse(commands, {
    keys: [
      { name: "name", weight: 0.8 },
      { name: "description", weight: 0.2 },
    ],
    includeScore: true,
    shouldSort: false,
    threshold: 0.5,
  })

  return fuse
    .search(trimmed)
    .filter((result) => isAcceptableResult(result, trimmed))
    .sort((a, b) => compareResults(a, b, trimmed))
    .map((result) => result.item)
}

function isAcceptableResult(result: FuseResult<CommandDescriptor>, query: string): boolean {
  const signals = rankingSignals(result, query)
  return signals.rank < 7 || signals.score <= MAX_ACCEPTABLE_FUZZY_SCORE
}

function compareResults(
  a: FuseResult<CommandDescriptor>,
  b: FuseResult<CommandDescriptor>,
  query: string,
): number {
  const aSignals = rankingSignals(a, query)
  const bSignals = rankingSignals(b, query)

  if (aSignals.rank !== bSignals.rank) return aSignals.rank - bSignals.rank
  if (aSignals.rank < 7) {
    const name = aSignals.name.localeCompare(bSignals.name)
    if (name !== 0) return name
  }
  if (aSignals.score !== bSignals.score) return aSignals.score - bSignals.score
  if (aSignals.rank === 7 && aSignals.name.length !== bSignals.name.length) return aSignals.name.length - bSignals.name.length
  return a.refIndex - b.refIndex
}

function rankingSignals(result: FuseResult<CommandDescriptor>, query: string) {
  const lowerQuery = query.toLowerCase()
  const lowerName = result.item.name.toLowerCase().replace(/^\/+/, "")
  const lowerDescription = result.item.description.toLowerCase()

  return {
    name: lowerName,
    rank: commandRank(lowerQuery, lowerName, lowerDescription),
    score: result.score ?? 1,
  }
}

function commandRank(query: string, name: string, description: string): number {
  if (name === query) return 0
  if (name.startsWith(query)) return 1
  if (name.split(/[-_\s]+/).some((part) => part.startsWith(query))) return 2
  if (name.includes(query)) return 3
  if (description.startsWith(query)) return 4
  if (description.split(/[-_\s]+/).some((part) => part.startsWith(query))) return 5
  if (description.includes(query)) return 6
  return 7
}
