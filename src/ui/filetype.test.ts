import { describe, expect, test } from "bun:test"
import { filetype } from "./filetype"

describe("filetype", () => {
  test("maps common source paths to OpenTUI tree-sitter filetypes", () => {
    expect(filetype("src/ui.ts")).toBe("typescript")
    expect(filetype("src/App.tsx")).toBe("typescript")
    expect(filetype("package.json")).toBe("json")
    expect(filetype("README.md")).toBe("markdown")
  })

  test("accepts language names and falls back to none", () => {
    expect(filetype("ts")).toBe("typescript")
    expect(filetype("typescript")).toBe("typescript")
    expect(filetype(undefined)).toBe("none")
  })
})
