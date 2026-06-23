import path from "node:path"

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  ".css": "css",
  ".go": "go",
  ".html": "html",
  ".htm": "html",
  ".java": "java",
  ".js": "javascript",
  ".cjs": "javascript",
  ".mjs": "javascript",
  ".jsx": "javascriptreact",
  ".json": "json",
  ".md": "markdown",
  ".markdown": "markdown",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".sh": "shellscript",
  ".bash": "shellscript",
  ".zsh": "shellscript",
  ".sql": "sql",
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".mts": "typescript",
  ".cts": "typescript",
  ".yaml": "yaml",
  ".yml": "yaml",
}

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "typescript",
  javascript: "typescript",
  jsx: "typescript",
  javascriptreact: "typescript",
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  typescriptreact: "typescript",
  md: "markdown",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "shellscript",
}

export function filetype(input?: string) {
  if (!input) return "none"
  const normalized = input.toLowerCase()
  const alias = LANGUAGE_ALIASES[normalized]
  if (alias) return alias
  const language = LANGUAGE_EXTENSIONS[path.extname(normalized)]
  if (language && ["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language ?? "none"
}
