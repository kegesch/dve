export interface ToolResult {
  readonly success: boolean
  readonly data?: unknown
  readonly error?: string
}

export interface ToolPort {
  readonly name: string
  execute(args: Record<string, unknown>): Promise<ToolResult>
}
