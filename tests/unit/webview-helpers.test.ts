import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Todo, FileChange, SkillInfo, SubagentActivity, WebviewState, SessionState, RevertEntry, DiffBlock } from '../../src/chat/webview/types'

describe('Webview Type Definitions', () => {
  it('should accept Todo interface with required fields', () => {
    const todo: Todo = {
      id: 'test-1',
      content: 'Test todo',
      status: 'pending',
      createdAt: Date.now()
    }
    
    assert.strictEqual(typeof todo.id, 'string')
    assert.strictEqual(typeof todo.content, 'string')
    assert.strictEqual(typeof todo.status, 'string')
    assert.strictEqual(typeof todo.createdAt, 'number')
  })

  it('should accept valid Todo status values', () => {
    const validStatuses: Array<Todo['status']> = ['pending', 'in-progress', 'completed']
    validStatuses.forEach(status => {
      const todo: Todo = {
        id: 'test',
        content: 'Test',
        status,
        createdAt: Date.now()
      }
      assert.strictEqual(todo.status, status)
    })
  })

  it('should accept FileChange interface with required fields', () => {
    const fileChange: FileChange = {
      path: 'src/example.ts',
      added: 5,
      removed: 2
    }
    
    assert.strictEqual(typeof fileChange.path, 'string')
    assert.strictEqual(typeof fileChange.added, 'number')
    assert.strictEqual(typeof fileChange.removed, 'number')
  })

  it('should accept SkillInfo interface with required fields', () => {
    const skill: SkillInfo = {
      id: 'skill-1',
      name: 'Code Review',
      description: 'Review code for bugs',
      category: 'coding',
      enabled: true
    }
    
    assert.strictEqual(typeof skill.id, 'string')
    assert.strictEqual(typeof skill.name, 'string')
    assert.strictEqual(typeof skill.enabled, 'boolean')
  })

  it('should accept SubagentActivity interface with required fields', () => {
    const activity: SubagentActivity = {
      id: 'subagent-1',
      name: 'Code Analyzer',
      status: 'running',
      output: 'Analyzing...',
      progress: 65
    }
    
    assert.strictEqual(typeof activity.id, 'string')
    assert.strictEqual(typeof activity.name, 'string')
    assert.strictEqual(typeof activity.status, 'string')
  })

  it('should accept valid SubagentActivity status values', () => {
    const validStatuses: Array<SubagentActivity['status']> = ['running', 'completed', 'failed']
    validStatuses.forEach(status => {
      const activity: SubagentActivity = {
        id: 'test',
        name: 'Test',
        status
      }
      assert.strictEqual(activity.status, status)
    })
  })

  it('should extend WebviewState with skills property', () => {
    const state: Partial<WebviewState> = {
      skills: {
        'skill-1': {
          id: 'skill-1',
          name: 'Test Skill',
          enabled: true
        }
      }
    }
    
    assert.strictEqual(typeof state.skills, 'object')
    assert.ok(state.skills?.['skill-1'])
  })

  it('should extend SessionState with subagentActivities property', () => {
    const session: Partial<SessionState> = {
      subagentActivities: [
        {
          id: 'subagent-1',
          name: 'Test Agent',
          status: 'running'
        }
      ]
    }
    
    assert.strictEqual(Array.isArray(session.subagentActivities), true)
    assert.strictEqual(session.subagentActivities?.length, 1)
  })

  it('should extend SessionState with revertHistory property', () => {
    const session: Partial<SessionState> = {
      revertHistory: [
        {
          diffId: 'diff-1',
          messageId: 'msg-1',
          path: 'src/example.ts',
          timestamp: Date.now()
        }
      ]
    }
    
    assert.strictEqual(Array.isArray(session.revertHistory), true)
    assert.strictEqual(session.revertHistory?.length, 1)
  })

  it('should extend DiffBlock with revertable property', () => {
    const diff: DiffBlock = {
      type: 'diff',
      diffId: 'diff-1',
      path: 'src/example.ts',
      hunks: [],
      state: 'accepted',
      linesAdded: 5,
      linesRemoved: 2,
      revertable: true
    }
    
    assert.strictEqual(diff.revertable, true)
  })

  it('should extend WebviewState displayPrefs with thinkingVisible', () => {
    const state: Partial<WebviewState> = {
      displayPrefs: {
        text: true,
        tools: true,
        diffs: true,
        errors: true,
        diffWrapEnabled: false,
        thinkingVisible: true
      }
    }
    
    assert.strictEqual(state.displayPrefs?.thinkingVisible, true)
  })
})
