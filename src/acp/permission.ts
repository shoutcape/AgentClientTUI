export function selectPermissionOption(params: unknown): string {
  const record = params && typeof params === "object" && !Array.isArray(params)
    ? params as { options?: Array<{ optionId?: string; kind?: string }> }
    : {}

  const rejectOnce = record.options?.find((option) => option.kind === "reject_once" && option.optionId)
  const reject = record.options?.find((option) => option.kind?.startsWith("reject") && option.optionId)

  return rejectOnce?.optionId ?? reject?.optionId ?? "reject-once"
}
