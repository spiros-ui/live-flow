export type FlowStatus = 'running' | 'ok' | 'slow' | 'error'

export type FlowKind = 'prompt' | 'tool' | 'group' | 'agent'

export type FlowNode = {
  id: string
  kind: FlowKind
  icon: string
  name: string
  where: string
  startedAt: number
  endedAt?: number
  status: FlowStatus
  count: number
  running: number
  agentId?: string
  isBackground?: boolean
  steps?: number
  tokens?: number
  now?: string
  recent?: string[]
  error?: string
  groupKey?: string
}

export type PlanTask = {
  id: string
  subject: string
  status: 'pending' | 'in_progress' | 'completed'
}

declare module 'claude-code' {
  interface PluginState {
    'live-flow': {
      nodes: FlowNode[]
      tasks: PlanTask[]
      selected: string | null
      tick: number
    }
  }
}
