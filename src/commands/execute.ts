import type { AcpClient } from "../acp/client"
import type { CommandEffect, CommandOption } from "./state"

export interface ExecuteContext {
  client: AcpClient
  sendPrompt: (text: string) => Promise<void>
  setInput: (text: string) => void
  localActions: Record<string, () => void>
}

export async function handleEffect(effect: CommandEffect, ctx: ExecuteContext): Promise<CommandOption[] | undefined> {
  if (effect.type === "execute") {
    const cmdName = effect.command.split(" ")[0]
    if (cmdName && ctx.localActions[cmdName]) {
      ctx.localActions[cmdName]()
      return undefined
    }
    await ctx.sendPrompt(effect.command)
    return undefined
  }

  if (effect.type === "fetch-options") {
    return ctx.client.fetchOptions(effect.method)
  }

  if (effect.type === "set-input") {
    ctx.setInput(effect.text)
    return undefined
  }

  return undefined
}
