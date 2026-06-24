import { describe, expect, test } from "bun:test"
import { selectPermissionOption } from "./permission"

describe("selectPermissionOption", () => {
  test("prefers reject once", () => {
    expect(selectPermissionOption({
      options: [
        { optionId: "allow-once", kind: "allow_once" },
        { optionId: "reject-once", kind: "reject_once" },
      ],
    })).toBe("reject-once")
  })

  test("falls back to reject-once instead of approving", () => {
    expect(selectPermissionOption({
      options: [
        { optionId: "allow-once", kind: "allow_once" },
      ],
    })).toBe("reject-once")
  })

  test("falls back to reject-once", () => {
    expect(selectPermissionOption({ options: [] })).toBe("reject-once")
  })
})
