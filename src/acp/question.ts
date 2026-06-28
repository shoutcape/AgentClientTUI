export type QuestionOption = {
  id: string
  label: string
}

export type Question = {
  id: string
  text: string
  options: QuestionOption[]
}

export type QuestionRequest = {
  header: string
  questions: Question[]
}

export type QuestionAnswer = {
  questionId: string
  answer: string
}

export type QuestionResponse = {
  answers: QuestionAnswer[]
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as JsonRecord
}

function firstString(record: JsonRecord, names: string[]): string | undefined {
  for (const name of names) {
    const value = record[name]
    if (typeof value === "string" && value.trim()) return value
  }
  return undefined
}

function normalizeOption(option: unknown, index: number): QuestionOption {
  const record = asRecord(option)
  const id = firstString(record, ["id", "optionId", "value", "name"])
  const label = firstString(record, ["label", "text", "name", "title", "value", "id", "optionId"])
  if (!id) throw new Error(`Question option ${index + 1} must include id`)
  if (!label) throw new Error(`Question option ${index + 1} must include label`)
  return { id, label }
}

export function normalizeQuestionRequest(params: unknown): QuestionRequest {
  const record = asRecord(params)
  const header = firstString(record, ["header", "title", "name"]) ?? "Question"
  const rawQuestions = record.questions
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    throw new Error("Question request must include at least one question")
  }

  const questions = rawQuestions.map((rawQuestion, questionIndex): Question => {
    const questionRecord = asRecord(rawQuestion)
    const id = firstString(questionRecord, ["id", "questionId", "name"]) ?? `question-${questionIndex + 1}`
    const text = firstString(questionRecord, ["question", "text", "prompt", "message"])
    if (!text) throw new Error(`Question ${questionIndex + 1} must include text`)
    const rawOptions = questionRecord.options
    const options = Array.isArray(rawOptions)
      ? rawOptions.map((option, optionIndex) => normalizeOption(option, optionIndex))
      : []
    return { id, text, options }
  })

  return { header, questions }
}

export function normalizeQuestionResponse(response: unknown): QuestionResponse {
  const record = asRecord(response)
  const rawAnswers = record.answers
  if (!Array.isArray(rawAnswers)) throw new Error("Invalid question response")

  const answers = rawAnswers.map((rawAnswer): QuestionAnswer => {
    const answerRecord = asRecord(rawAnswer)
    const questionId = firstString(answerRecord, ["questionId", "id", "name"])
    const answer = firstString(answerRecord, ["answer", "value", "text", "optionId"])
    if (!questionId || answer === undefined) throw new Error("Invalid question response")
    return { questionId, answer }
  })

  return { answers }
}
