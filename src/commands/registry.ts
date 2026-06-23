export type CommandSource = "acp" | "local"
export type InputType = "selection" | "panel"

export interface CommandDescriptor {
  name: string
  description: string
  source: CommandSource
  inputType?: InputType
  subcommands?: string[]
  subcommandHints?: Record<string, string>
  optionsMethod?: string
  hint?: string
  hidden?: boolean
}

export class CommandRegistry {
  private acpCommands: CommandDescriptor[] = []
  private localCommands: CommandDescriptor[] = []

  setAcpCommands(commands: CommandDescriptor[]): void {
    this.acpCommands = commands
  }

  addLocalCommand(command: CommandDescriptor): void {
    this.localCommands.push(command)
  }

  search(query: string, filter?: { source?: CommandSource }): CommandDescriptor[] {
    const all = [...this.acpCommands, ...this.localCommands]
    return all.filter((cmd) => {
      if (cmd.hidden) return false
      if (filter?.source && cmd.source !== filter.source) return false
      if (!query) return true
      const lower = query.toLowerCase()
      return cmd.name.toLowerCase().includes(lower) || cmd.description.toLowerCase().includes(lower)
    })
  }

  get(name: string): CommandDescriptor | undefined {
    return [...this.acpCommands, ...this.localCommands].find((cmd) => cmd.name === name)
  }

  getSubcommands(name: string): string[] {
    return this.get(name)?.subcommands ?? []
  }
}
