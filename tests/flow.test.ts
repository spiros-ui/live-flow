import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { flowMarkdown } from '../hooks/flow'

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
  test('a tool call becomes a green box with its own detail card', async ($, on) => {
    const clock = mock.clock(on)
    tools(on, clock, 2000, { result: { stdout: 'all passed', stderr: '', interrupted: false } })

    await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' })

    for (const surface of REMOTE) {
      const ui = await $.ui.mount({ ...PANE, surface })
      const source = String((await ui.findAll({ type: 'Svg' }))[0]?.props.source)
      expect(source).toContain('Run the tests')
      expect(source).toContain('fill="#24895C"')
      expect(source).toContain('2.0s')

      const button = await ui.find({ type: 'Button', text: /Run the tests/ })
      expect(button).toBeDefined()
      await ui.press({ key: String(button?.key) })
      const detail = (await ui.findAll({ type: 'Svg' }))[1]
      expect(String(detail?.props.alt)).toContain('Finished in 2.0s')
      await ui.press({ key: 'close-detail' })
      expect(await ui.findAll({ type: 'Svg' })).toHaveLength(1)
      await ui.unmount()
    }

    const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await term.find({ text: /Run the tests/ })).toBeDefined()
    await term.unmount()
  })

  test('a failed call becomes a red box that says what failed', async ($, on) => {
    const clock = mock.clock(on)
    tools(on, clock, 500, { isError: true, result: 'boom', text: 'Exit code 1: module not found' })

    await $.tool.call({ tool: 'Bash', command: 'npm run build', description: 'Build the app' })

    for (const surface of REMOTE) {
      const ui = await $.ui.mount({ ...PANE, surface })
      const source = String((await ui.findAll({ type: 'Svg' }))[0]?.props.source)
      expect(source).toContain('stroke="#C8423A" stroke-width="2" stroke-dasharray="6 4"')
      expect(source).toContain('fill="#C8423A"')

      const button = await ui.find({ type: 'Button', text: /🔴 Build the app/ })
      expect(button).toBeDefined()
      await ui.press({ key: String(button?.key) })
      const alt = String((await ui.findAll({ type: 'Svg' }))[1]?.props.alt)
      expect(alt).toContain('failed')
      expect(alt).toContain('Exit code 1: module not found')
      await ui.press({ key: 'close-detail' })
      await ui.unmount()
    }
  })

  test('a subagent becomes a helper box that runs until it stops', async ($, on) => {
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
      const ui = await $.ui.mount({ ...PANE, surface })
      const source = String((await ui.findAll({ type: 'Svg' }))[0]?.props.source)
      expect(source).toContain('Find the login bug')
      expect(source).toContain('stroke="#2D6AA8"')
      expect(source).toContain('attributeName="r"')
      await ui.unmount()
    }

    await $.classic.SubagentStop({
      agent_id: 'agent-1',
      agent_type: 'Explore',
      agent_transcript_path: '',
      stop_hook_active: false,
    })

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const source = String((await ui.findAll({ type: 'Svg' }))[0]?.props.source)
    expect(source).toContain('stroke="#2D6AA8"')
    expect(source).not.toContain('attributeName="r"')
    await ui.unmount()
  })

  test('consecutive reads fold into one box, and the plan shows its steps', async ($, on) => {
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

    const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
    const source = String((await ui.findAll({ type: 'Svg' }))[0]?.props.source)
    expect(source).toContain('THE PLAN')
    expect(source).not.toContain('<style')
    expect(source).not.toContain('class=')
    expect(source).toContain('Ship it')
    expect(source).toContain('Read 3 files')
    expect(await ui.findAll({ type: 'Button', text: /Read/ })).toHaveLength(1)
    await ui.unmount()
  })

  test('the /flow row in the chat draws the same live picture', async ($, on) => {
    const clock = mock.clock(on)
    tools(on, clock, 1000, { result: { stdout: '', stderr: '', interrupted: false } })

    await $.tool.call({ tool: 'Bash', command: 'ls', description: 'List the files' })

    for (const surface of ['desktop', 'mobile', 'terminal'] as const) {
      const ui = await $.ui.mount({
        plugin: 'live-flow',
        surface,
        component: 'CommandOutput',
        props: { command: 'flow', args: '', text: 'Live flow.', isErrored: false },
      })
      expect(await ui.find({ text: /List the files/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('/flow answers with the flow as chat text, which every app shows', () => {
    const at = 1_000_000
    const base = { count: 1, running: 0, startedAt: at, endedAt: at + 500, where: '' }
    const text = flowMarkdown(
      [
        { ...base, id: 'a', kind: 'tool', icon: 'terminal', name: 'List the files', status: 'ok' },
        { ...base, id: 'b', kind: 'tool', icon: 'terminal', name: 'Build the app', status: 'error', error: 'Exit code 1' },
      ],
      [{ id: '1', subject: 'Ship it', status: 'in_progress' }],
    )
    expect(text).toContain('🔄 Ship it')
    expect(text).toContain('🟢 💻 **List the files**')
    expect(text).toContain('↓')
    expect(text).toContain('🔴 💻 **Build the app** · 500ms · failed: Exit code 1')
  })
})
