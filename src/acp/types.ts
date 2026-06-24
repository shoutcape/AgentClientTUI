export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

export type JsonRpcId = string | number

export type JsonRpcRequest = {
  jsonrpc: "2.0"
  id: JsonRpcId
  method: string
  params?: JsonValue
}

export type JsonRpcNotification = {
  jsonrpc: "2.0"
  method: string
  params?: JsonValue
}

export type JsonRpcSuccess = {
  jsonrpc: "2.0"
  id: JsonRpcId
  result: JsonValue
}

export type JsonRpcError = {
  jsonrpc: "2.0"
  id: JsonRpcId | null
  error: {
    code: number
    message: string
    data?: JsonValue
  }
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcError

export type ClientRequestHandler = (method: string, params: JsonValue | undefined) => Promise<JsonValue> | JsonValue

export type TransportEvent =
  | { type: "notification"; method: string; params: JsonValue | undefined }
  | { type: "stderr"; text: string }
  | { type: "protocol-error"; message: string; raw?: string }
  | { type: "exit"; code: number | null; signal: NodeJS.Signals | null }

export type AgentCommand = {
  command: string
  args: string[]
  label: string
}
