import { rankCommands } from "./search"

export type CommandSource = "acp" | "local"
export type InputType = "selection" | "panel"
export type CommandKind = "server" | "skill" | "app" | "config"
export type CommandOption = { label: string; value: string; description?: string }

export interface CommandDescriptor {
  name: string
  description: string
  source: CommandSource
  kind?: CommandKind
  inputType?: InputType
  subcommands?: string[]
  subcommandHints?: Record<string, string>
  optionsMethod?: string
  hint?: string
  hidden?: boolean
  rawName?: string
  configId?: string
  options?: CommandOption[]
}

export class CommandRegistry {
  private acpCommands: CommandDescriptor[] = []
  private localCommands: CommandDescriptor[] = []
  private configCommands: CommandDescriptor[] = []

  setAcpCommands(commands: CommandDescriptor[]): void {
    this.acpCommands = commands
  }

  addLocalCommand(command: CommandDescriptor): void {
    this.localCommands.push(command)
  }

  setConfigCommands(commands: CommandDescriptor[]): void {
    this.configCommands = commands
  }

  search(query: string, filter?: { source?: CommandSource }): CommandDescriptor[] {
    const all = [...this.acpCommands, ...this.localCommands, ...this.configCommands]
    return this.filterCommands(all, query, filter)
  }

  searchSlash(query: string): CommandDescriptor[] {
    const serverCommands = this.acpCommands.filter((cmd) => (cmd.kind ?? "server") === "server")
    const localSlashCommands = this.localCommands.filter((cmd) => (cmd.kind ?? "app") === "app" && cmd.name.startsWith("/"))
    const skills = this.getSkills()
    const skillsCommand = this.skillsCommand()
    const baseCommands = [...serverCommands, ...this.configCommands, ...localSlashCommands]
    if (skills.length > 0 && this.matches(skillsCommand, query)) {
      if (query.trim()) return this.filterCommands([...baseCommands, skillsCommand], query)

      const commands = this.filterCommands(baseCommands, query)
      commands.splice(Math.min(commands.length, 4), 0, skillsCommand)
      return commands
    }
    return this.filterCommands(baseCommands, query)
  }

  searchPalette(query: string): CommandDescriptor[] {
    const appCommands = this.localCommands.filter((cmd) => (cmd.kind ?? "app") === "app")
    const serverCommands = this.acpCommands.filter((cmd) => (cmd.kind ?? "server") === "server")
    const skills = this.getSkills()
    const skillsCommand = this.skillsCommand()
    const baseCommands = [...appCommands, ...this.configCommands, ...serverCommands]
    if (skills.length > 0 && this.matches(skillsCommand, query)) {
      if (query.trim()) return this.filterCommands([...baseCommands, skillsCommand], query)

      const commands = this.filterCommands(baseCommands, query)
      commands.splice(Math.min(commands.length, appCommands.length + this.configCommands.length + 4), 0, skillsCommand)
      return commands
    }
    return this.filterCommands(baseCommands, query)
  }

  getSkills(): CommandDescriptor[] {
    return this.acpCommands.filter((cmd) => !cmd.hidden && cmd.kind === "skill")
  }

  get(name: string): CommandDescriptor | undefined {
    if (name === "Skills") return this.skillsCommand()
    return [...this.acpCommands, ...this.localCommands, ...this.configCommands].find((cmd) => cmd.name === name)
  }

  getSubcommands(name: string): string[] {
    return this.get(name)?.subcommands ?? []
  }

  private filterCommands(commands: CommandDescriptor[], query: string, filter?: { source?: CommandSource }): CommandDescriptor[] {
    const filtered = commands.filter((cmd) => {
      if (cmd.hidden) return false
      if (filter?.source && cmd.source !== filter.source) return false
      return true
    })
    return rankCommands(filtered, query)
  }

  private matches(cmd: CommandDescriptor, query: string): boolean {
    if (!query) return true
    const lower = query.toLowerCase()
    return cmd.name.toLowerCase().includes(lower) || cmd.description.toLowerCase().includes(lower)
  }

  private skillsCommand(): CommandDescriptor {
    return {
      name: "Skills",
      description: "Browse skill slash commands",
      source: "local",
      kind: "app",
      subcommands: this.getSkills().map((cmd) => cmd.name),
      options: this.getSkills().map((cmd) => ({ label: cmd.name, value: cmd.name, description: cmd.description })),
    }
  }
}
