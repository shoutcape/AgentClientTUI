import type { AcpClient } from "../acp/client"
import type { CommandEffect } from "./state"

export interface ExecuteContext {
  client: AcpClient
  sendPrompt: (text: string) => Promise<void>
  setInput: (text: string) => void
  localActions: Record<string, () => void>
}

export async function handleEffect(effect: CommandEffect, ctx: ExecuteContext): Promise<string[] | undefined> {
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
    const options = await ctx.client.fetchOptions(effect.method)
    return options.map((o) => o.label)
  }

  if (effect.type === "set-input") {
    ctx.setInput(effect.text)
    return undefined
  }

  return undefined
}
