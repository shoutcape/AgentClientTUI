import { describe, expect, test } from "bun:test"
import { normalizeQuestionRequest } from "./question"

describe("normalizeQuestionRequest", () => {
  test("normalizes native-style question payload", () => {
    expect(normalizeQuestionRequest({
      title: "Demo Questions",
      questions: [
        {
          id: "color",
          question: "Choose a color",
          options: [
            { id: "red", label: "Red" },
            { value: "blue", text: "Blue" },
          ],
        },
        { name: "snack", prompt: "Name a snack" },
      ],
    })).toEqual({
      header: "Demo Questions",
      questions: [
        {
          id: "color",
          text: "Choose a color",
          options: [
            { id: "red", label: "Red" },
            { id: "blue", label: "Blue" },
          ],
        },
        { id: "snack", text: "Name a snack", options: [] },
      ],
    })
  })

  test("rejects malformed question payload", () => {
    expect(() => normalizeQuestionRequest({ questions: [] })).toThrow("Question request must include at least one question")
    expect(() => normalizeQuestionRequest({ questions: [{ id: "x" }] })).toThrow("Question 1 must include text")
  })
})
