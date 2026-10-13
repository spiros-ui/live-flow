import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'


const PANE = {
  plugin: 'live-flow',
  component: 'Pane',
  requestId: 'live-flow',
  props: {
    title: 'Live flow',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const REMOTE = ['desktop', 'mobile'] as const

/** Stands in for the tools: each call takes `ms` and answers `answer`. */
function tools(on: On, clock: ReturnType<typeof mock.clock>, ms: number, answer: Record<string, unknown>) {
  on('tool.call', async () => {
    await clock.advance(ms)
    return answer as never
  })
}

describe('live-flow', () => {
  const panelOf = async ($: Engine, surface: (typeof REMOTE)[number]) => {
    const ui = await $.ui.mount({ ...PANE, surface })
    const svgs = await ui.findAll({ type: 'Svg' })
    await ui.unmount()
    expect(svgs).toHaveLength(1)
    expect(svgs[0]?.props.width).toBe(600)
    return String(svgs[0]?.props.source)
  }

  test('a tool call becomes a green card with its own detail card', async ($, on) => {
    const clock = mock.clock(on)
    tools(on, clock, 2000, { result: { stdout: 'all passed', stderr: '', interrupted: false } })

    await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' })

    for (const surface of REMOTE) {
      const source = await panelOf($, surface)
      expect(source).toContain('Run the tests')
      expect(source).toContain('fill="#4CC08A"')
      expect(source).toContain('2.0s')
      expect(source).toContain('href="#d0"')
      expect(source).toContain('Finished in 2.0s')
    }

    const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await term.find({ text: /Run the tests/ })).toBeDefined()
    await term.unmount()
  })

  test('a failed call becomes a red dashed card that says what failed', async ($, on) => {
    const clock = mock.clock(on)
    tools(on, clock, 500, { isError: true, result: 'boom', text: 'Exit code 1: module not found' })

    await $.tool.call({ tool: 'Bash', command: 'npm run build', description: 'Build the app' })

    for (const surface of REMOTE) {
      const source = await panelOf($, surface)
      expect(source).toContain('stroke="#EE6A60" class="stroke-bad" stroke-width="2" stroke-dasharray="6 4"')
      expect(source).toContain('Failed: Exit code 1: module not found')
    }
  })

  test('a subagent becomes a blue helper card that runs until it stops', async ($, on) => {
    mock.clock(on)
    on('agent.spawn', () => ({ model: 'claude-test', agentId: 'agent-1' }))
    on('classic.SubagentStop', () => ({}))

    await $.agent.spawn({
      tool_use_id: 'toolu_agent',
      prompt: 'Find where the login breaks',
      description: 'Find the login bug',
      subagentType: 'Explore',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-test',
      background: true,
      fork: false,
    } as never)

    for (const surface of REMOTE) {
      const source = await panelOf($, surface)
      expect(source).toContain('Find the login bug')
      expect(source).toContain('attributeName="r"')
    }

    await $.classic.SubagentStop({ agent_id: 'agent-1', agent_type: 'Explore', agent_transcript_path: '', stop_hook_active: false })

    const source = await panelOf($, 'desktop')
    expect(source).toContain('stroke="#6FA4E0"')
    expect(source).not.toContain('attributeName="r"')
  })

  test('consecutive reads fold into one card, and the plan shows its steps', async ($, on) => {
    const clock = mock.clock(on)
    on('tool.call', async ($$, e) => {
      await clock.advance(100)
      if (e.tool === 'TaskCreate') return { result: { task: { id: '1', subject: 'Ship it' } } } as never
      return { result: { success: true } } as never
    })

    await $.tool.call({ tool: 'TaskCreate', subject: 'Ship it', description: 'Ship the change' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
    await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' })
    await $.tool.call({ tool: 'Read', file_path: '/repo/b.ts' })
    await $.tool.call({ tool: 'Read', file_path: '/repo/c.ts' })

    const source = await panelOf($, 'mobile')
    expect(source).toContain('THE PLAN')
    expect(source).toContain('Ship it')
    expect(source).toContain('Read 3 files')
    expect(source).not.toContain('href="#d1"')
  })
})
