export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: { parse(data: unknown): TInput };
  outputSchema: { parse(data: unknown): TOutput };
  invoke: (input: TInput) => Promise<TOutput>;
  sideEffect: boolean;
  requiresApproval: boolean;
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private approvalHandler: ((name: string, input: unknown) => Promise<void>) | null = null;

  register(tool: ToolDefinition<any, any>): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): string[] {
    return [...this.tools.keys()];
  }

  getDefinition(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  setApprovalHandler(handler: (name: string, input: unknown) => Promise<void>): void {
    this.approvalHandler = handler;
  }

  async invoke(name: string, rawInput: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    const input = tool.inputSchema.parse(rawInput);

    if (tool.sideEffect && tool.requiresApproval) {
      await this.requestApproval(name, input);
    }

    const output = await tool.invoke(input);
    return tool.outputSchema.parse(output);
  }

  private async requestApproval(name: string, input: unknown): Promise<void> {
    if (!this.approvalHandler) {
      throw new Error(`Tool "${name}" requires approval but no approval handler is configured`);
    }
    await this.approvalHandler(name, input);
  }
}
