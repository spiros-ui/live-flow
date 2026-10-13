import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FlowNode, PlanTask } from '../types'
import {
  cap,
  chipsFor,
  describe,
  drawDetail,
  drawFlow,
  finishedStatus,
  groupOf,
  isHidden,
  statusLine,
  statusWord,
  timeOf,
} from './flow'

const PANE = 'live-flow'
const TITLE = 'Live flow'

const nodes = atom({ plugin: 'live-flow', key: 'nodes' } as const, [])
const tasks = atom({ plugin: 'live-flow', key: 'tasks' } as const, [])
const selected = atom({ plugin: 'live-flow', key: 'selected' } as const, null)

const DOT: Record<FlowNode['status'], string> = { running: '🟢', ok: '🟢', slow: '🟠', error: '🔴' }

function short(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text
}

async function refreshStatus($: EngineInterface) {
  $.ui.status(statusLine(await read($, nodes), await read($, tasks)))
}

/** Marks one box finished; a group box finishes once its last call has. */
function finish(node: FlowNode, at: number, error: string | undefined, extra: Partial<FlowNode> = {}): FlowNode {
  const running = Math.max(0, node.running - 1)
  const err = error ?? node.error
  if (running > 0) return { ...node, ...extra, running, error: err }
  const done: FlowNode = { ...node, ...extra, running, endedAt: at, error: err }
  return { ...done, status: finishedStatus(done, at, err !== undefined) }
}

function errorOf(ran: { deny?: string; isError?: true; text?: string }): string | undefined {
  if (ran.deny !== undefined) return `Blocked: ${ran.deny}`
  if (ran.isError === true) return ran.text ?? 'The tool reported an error'
  return undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'flow',
      description: 'Open the live flow: boxes and arrows of what Claude is doing',
    })
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'flow' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    await refreshStatus($)

    return {
      text: opened.isPlaced
        ? 'Opened the live flow pane.'
        : 'The live flow pane is open but this screen has no room for it yet; widen the window.',
    }
  })

  on('prompt.submit', async ($, e, next) => {
    const at = await $.clock.now()
    const prompt: FlowNode = {
      id: `prompt-${at}`,
      kind: 'prompt',
      icon: 'chat',
      name: 'You asked',
      where: short(e.text.replace(/\s+/g, ' ').trim(), 160),
      startedAt: at,
      endedAt: at,
      status: 'ok',
      count: 1,
      running: 0,
    }
    await update($, nodes, list => cap([...list, prompt]))

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>

    // ---- the plan: TaskCreate / TaskUpdate / TodoWrite feed the plan bay
    if (tool === 'TaskCreate') {
      const ran = await next(e)
      const id = (ran.result as { task?: { id?: unknown } } | undefined)?.task?.id
      if (errorOf(ran) === undefined && typeof id === 'string') {
        const task: PlanTask = { id, subject: String(input.subject ?? 'Step'), status: 'pending' }
        await update($, tasks, list => [...list.filter(t => t.id !== id), task])
        await refreshStatus($)
      }
      return ran
    }
    if (tool === 'TaskUpdate') {
      const ran = await next(e)
      const id = String(input.taskId ?? '')
      const status = input.status
      const subject = typeof input.subject === 'string' ? input.subject : undefined
      if (errorOf(ran) === undefined && id !== '') {
        await update($, tasks, list =>
          status === 'deleted'
            ? list.filter(t => t.id !== id)
            : list.map(t =>
                t.id !== id
                  ? t
                  : {
                      ...t,
                      subject: subject ?? t.subject,
                      status: status === 'pending' || status === 'in_progress' || status === 'completed' ? status : t.status,
                    },
              ),
        )
        await refreshStatus($)
      }
      return ran
    }
    if (tool === 'TodoWrite') {
      const ran = await next(e)
      const todos = Array.isArray(input.todos) ? (input.todos as { content?: unknown; status?: unknown }[]) : []
      if (errorOf(ran) === undefined) {
        await update($, tasks, () =>
          todos.map((todo, i) => ({
            id: `todo-${i}`,
            subject: String(todo.content ?? 'Step'),
            status: todo.status === 'in_progress' || todo.status === 'completed' ? todo.status : 'pending',
          })),
        )
        await refreshStatus($)
      }
      return ran
    }
    if (isHidden(tool)) return next(e)

    const what = describe(tool, input)

    // ---- a helper's own step: counted on the helper's box, not a box of its own
    if (e.agentId !== undefined) {
      const agentId = e.agentId
      await update($, nodes, list =>
        list.map(n => (n.kind === 'agent' && n.agentId === agentId ? { ...n, steps: (n.steps ?? 0) + 1, now: what.name } : n)),
      )
      return next(e)
    }

    // ---- a step of the main conversation
    const at = await $.clock.now()
    const group = groupOf(tool)
    const callId = e.tool_use_id ?? `call-${at}`
    let boxId = callId
    await update($, nodes, list => {
      const last = list[list.length - 1]
      if (group !== undefined && last !== undefined && last.kind === 'group' && last.groupKey === group.key) {
        const count = last.count + 1
        boxId = last.id
        const merged: FlowNode = {
          ...last,
          count,
          running: last.running + 1,
          name: group.name(count),
          where: what.where || last.where,
          status: 'running',
          endedAt: undefined,
        }
        return [...list.slice(0, -1), merged]
      }
      boxId = callId
      const box: FlowNode = {
        id: callId,
        kind: tool === 'Agent' ? 'agent' : group !== undefined ? 'group' : 'tool',
        icon: group?.icon ?? what.icon,
        name: group !== undefined ? group.name(1) : what.name,
        where: what.where,
        startedAt: at,
        status: 'running',
        count: 1,
        running: 1,
        groupKey: group?.key,
        isBackground: tool === 'Agent' && input.run_in_background === true ? true : undefined,
        steps: tool === 'Agent' ? 0 : undefined,
      }
      return cap([...list, box])
    })
    await refreshStatus($)

    const ran = await next(e)

    const end = await $.clock.now()
    const error = errorOf(ran)
    const record = (error === undefined ? ran.result : undefined) as
      | { totalToolUseCount?: unknown; totalTokens?: unknown }
      | undefined
    await update($, nodes, list =>
      list.map(n => {
        if (n.id !== boxId) return n
        // A background helper keeps working after its call returns: SubagentStop ends it.
        if (n.kind === 'agent' && n.isBackground === true && error === undefined) return n
        const extra: Partial<FlowNode> = {}
        if (n.kind === 'agent' && typeof record?.totalToolUseCount === 'number') extra.steps = record.totalToolUseCount
        if (n.kind === 'agent' && typeof record?.totalTokens === 'number') extra.tokens = record.totalTokens
        return finish(n, end, error, extra)
      }),
    )
    await refreshStatus($)

    return ran
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    const agentId = ran.agentId
    if (agentId === undefined) return ran
    const at = await $.clock.now()
    await update($, nodes, list => {
      if (list.some(n => n.agentId === agentId)) return list
      const owner = list.find(n => n.id === e.tool_use_id && n.kind === 'agent' && n.agentId === undefined)
      if (owner !== undefined) return list.map(n => (n === owner ? { ...n, agentId } : n))
      // A helper no Agent box announced (a workflow's, say): a box of its own.
      const box: FlowNode = {
        id: `agent-${agentId}`,
        kind: 'agent',
        icon: 'helper',
        name: short(e.description || 'Helper agent', 40),
        where: e.subagentType,
        startedAt: at,
        status: 'running',
        count: 1,
        running: 1,
        agentId,
        isBackground: true,
        steps: 0,
      }
      return cap([...list, box])
    })
    await refreshStatus($)

    return ran
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    const at = await $.clock.now()
    await update($, nodes, list =>
      list.map(n => (n.kind === 'agent' && n.agentId === e.agent_id && n.status === 'running' ? finish({ ...n, running: 1 }, at, undefined) : n)),
    )
    await refreshStatus($)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list = await read($, nodes)
    const plan = await read($, tasks)
    const pick = await read($, selected)
    const chosen = list.find(n => n.id === pick)
    const choose = (id: string) => () => update($, selected, cur => (cur === id ? null : id))

    if (e.surface === 'terminal') {
      const { Box, Text, Button } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          {plan.length > 0 && <Text bold>The plan</Text>}
          {plan.map(t => (
            <Text color={t.status === 'completed' ? 'success' : t.status === 'in_progress' ? 'warning' : 'subtle'}>
              {t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▶' : '○'} {t.subject}
            </Text>
          ))}
          <Text bold>What Claude is doing</Text>
          {list.length === 0 && <Text dimColor>Nothing yet.</Text>}
          {list.map((n, i) => (
            <Box flexDirection="column">
              {i > 0 && <Text dimColor>  ↓</Text>}
              <Button key={`pick-${n.id}`} plain onPress={choose(n.id)}>
                {n.status === 'error' ? '✗' : n.status === 'running' ? '●' : '✓'} #{i + 1} {short(n.name, 40)}{' '}
                <Text dimColor>{timeOf(n)}</Text>
              </Button>
            </Box>
          ))}
          {chosen !== undefined && (
            <Box flexDirection="column" borderStyle="round" paddingX={1}>
              <Text bold>
                {chosen.name}: {statusWord(chosen.status)}
              </Text>
              <Text dimColor>where: {chosen.where || '—'}</Text>
              <Text dimColor>time: {timeOf(chosen)}</Text>
              {chipsFor(chosen).good.map(c => (
                <Text color="success">+ {c}</Text>
              ))}
              {chipsFor(chosen).weak.map(c => (
                <Text color="error">– {c}</Text>
              ))}
              {chipsFor(chosen).improve.map(c => (
                <Text color="suggestion">→ {c}</Text>
              ))}
            </Box>
          )}
        </Box>
      )
    }

    const { Box, Text, Button, Svg } = $.ui.resolve(e)
    const width = Math.max(320, Math.min(1100, Math.round(e.props.bodyColumns * 7.5)))
    const flow = drawFlow(list, plan, pick, width)
    const detail = chosen === undefined ? undefined : drawDetail(chosen, width)

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>
          {list.length === 0 ? 'Live flow: waiting for Claude to start working' : statusLine(list, plan).replace('  (/flow)', '')}
        </Text>
        <Svg key="flow" source={flow.source} alt={flow.alt} isInteractive />
        {list.length > 0 && <Text dimColor>Tap a step to see what it did:</Text>}
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {list.map((n, i) => (
            <Button key={`pick-${n.id}`} variant={n.id === pick ? 'primary' : 'secondary'} onPress={choose(n.id)}>
              {`${i + 1} ${DOT[n.status]} ${short(n.name, 24)}`}
            </Button>
          ))}
        </Box>
        {detail !== undefined && chosen !== undefined && (
          <Box flexDirection="column" gap={1}>
            <Svg key="detail" source={detail.source} alt={detail.alt} />
            <Button key="close-detail" role="dismiss" label="Close details" onPress={() => update($, selected, () => null)} />
          </Box>
        )}
      </Box>
    )
  })
}
