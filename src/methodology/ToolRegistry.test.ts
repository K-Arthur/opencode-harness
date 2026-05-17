import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry, type ToolDefinition } from './ToolRegistry.js';

const stringSchema = {
  parse: (data: unknown) => {
    if (typeof data !== 'string') throw new Error('Expected string');
    return data;
  },
};

const numberSchema = {
  parse: (data: unknown) => {
    if (typeof data !== 'number') throw new Error('Expected number');
    return data;
  },
};

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('registers and invokes a tool successfully', async () => {
    const tool: ToolDefinition<string, number> = {
      name: 'length',
      description: 'Returns string length',
      inputSchema: stringSchema,
      outputSchema: numberSchema,
      invoke: async (input) => input.length,
      sideEffect: false,
      requiresApproval: false,
    };
    registry.register(tool);
    const result = await registry.invoke('length', 'hello');
    assert.equal(result, 5);
  });

  it('throws on missing tool invocation', async () => {
    await assert.rejects(
      () => registry.invoke('nonexistent', {}),
      { message: 'Tool not found: nonexistent' },
    );
  });

  it('validates input schema', async () => {
    const tool: ToolDefinition<string, number> = {
      name: 'length',
      description: 'Returns string length',
      inputSchema: stringSchema,
      outputSchema: numberSchema,
      invoke: async (input) => input.length,
      sideEffect: false,
      requiresApproval: false,
    };
    registry.register(tool);
    await assert.rejects(
      () => registry.invoke('length', 42),
      { message: 'Expected string' },
    );
  });

  it('validates output schema', async () => {
    const tool: ToolDefinition<string, unknown> = {
      name: 'bad-output',
      description: 'Returns non-number',
      inputSchema: stringSchema,
      outputSchema: numberSchema,
      invoke: async () => 'not-a-number' as unknown as number,
      sideEffect: false,
      requiresApproval: false,
    };
    registry.register(tool);
    await assert.rejects(
      () => registry.invoke('bad-output', 'test'),
      { message: 'Expected number' },
    );
  });

  it('handles side-effect tools with approval', async () => {
    const approvals: Array<{ name: string; input: unknown }> = [];
    registry.setApprovalHandler(async (name, input) => {
      approvals.push({ name, input });
    });

    const tool: ToolDefinition<string, number> = {
      name: 'delete',
      description: 'Deletes something',
      inputSchema: stringSchema,
      outputSchema: numberSchema,
      invoke: async (input) => input.length,
      sideEffect: true,
      requiresApproval: true,
    };
    registry.register(tool);
    const result = await registry.invoke('delete', 'item');
    assert.equal(result, 4);
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0]!.name, 'delete');
    assert.equal(approvals[0]!.input, 'item');
  });

  it('skips approval when handler not set', async () => {
    const tool: ToolDefinition<string, number> = {
      name: 'delete',
      description: 'Deletes something',
      inputSchema: stringSchema,
      outputSchema: numberSchema,
      invoke: async (input) => input.length,
      sideEffect: true,
      requiresApproval: true,
    };
    registry.register(tool);
    const result = await registry.invoke('delete', 'item');
    assert.equal(result, 4);
  });

  it('lists registered tools', () => {
    registry.register({
      name: 'a',
      description: 'Tool A',
      inputSchema: stringSchema,
      outputSchema: stringSchema,
      invoke: async (input) => input,
      sideEffect: false,
      requiresApproval: false,
    });
    registry.register({
      name: 'b',
      description: 'Tool B',
      inputSchema: stringSchema,
      outputSchema: stringSchema,
      invoke: async (input) => input,
      sideEffect: false,
      requiresApproval: false,
    });
    const names = registry.list();
    assert.deepEqual(names.sort(), ['a', 'b']);
  });

  it('unregisters a tool', () => {
    const tool: ToolDefinition<string, string> = {
      name: 'removable',
      description: 'Can be removed',
      inputSchema: stringSchema,
      outputSchema: stringSchema,
      invoke: async (input) => input,
      sideEffect: false,
      requiresApproval: false,
    };
    registry.register(tool);
    assert.equal(registry.has('removable'), true);
    registry.unregister('removable');
    assert.equal(registry.has('removable'), false);
  });

  it('getDefinition returns the tool definition', () => {
    const tool: ToolDefinition<string, string> = {
      name: 'echo',
      description: 'Echoes input',
      inputSchema: stringSchema,
      outputSchema: stringSchema,
      invoke: async (input) => input,
      sideEffect: false,
      requiresApproval: false,
    };
    registry.register(tool);
    const def = registry.getDefinition('echo');
    assert.equal(def, tool);
  });

  it('throws on input schema validation failure', async () => {
    const tool: ToolDefinition<string, string> = {
      name: 'echo',
      description: 'Echoes input',
      inputSchema: stringSchema,
      outputSchema: stringSchema,
      invoke: async (input) => input,
      sideEffect: false,
      requiresApproval: false,
    };
    registry.register(tool);
    await assert.rejects(
      () => registry.invoke('echo', { invalid: true }),
      { message: 'Expected string' },
    );
  });

  it('throws on output schema validation failure', async () => {
    const tool: ToolDefinition<string, string> = {
      name: 'bad',
      description: 'Bad output',
      inputSchema: stringSchema,
      outputSchema: numberSchema as any,
      invoke: async () => 'wrong-type' as unknown as string,
      sideEffect: false,
      requiresApproval: false,
    };
    registry.register(tool);
    await assert.rejects(
      () => registry.invoke('bad', 'input'),
      { message: 'Expected number' },
    );
  });
});
