// Pure logic for live-flow: how a tool call becomes a box, how boxes are
// grouped and capped, and how the boxes are drawn as one animated SVG.
// Nothing here touches `$`, so register.tsx stays a thin layer of hooks.

import type { FlowNode, FlowStatus, PlanTask } from '../types'

export const MAX_NODES = 25
export const SLOW_MS = 30_000
export const SLOW_AGENT_MS = 5 * 60_000

// Tools that are bookkeeping, not work: they would only add noise.
const HIDDEN = new Set([
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
  'TodoWrite',
  'ToolSearch',
])

// Consecutive calls with the same group key fold into one box.
const GROUPS: Record<string, { key: string; icon: string; name: (n: number) => string }> = {
  Read: { key: 'read', icon: 'book', name: n => (n === 1 ? 'Read a file' : `Read ${n} files`) },
  NotebookRead: { key: 'read', icon: 'book', name: n => (n === 1 ? 'Read a file' : `Read ${n} files`) },
  Grep: { key: 'search', icon: 'search', name: n => (n === 1 ? 'Searched the code' : `Searched ${n} times`) },
  Glob: { key: 'search', icon: 'search', name: n => (n === 1 ? 'Searched the code' : `Searched ${n} times`) },
  LS: { key: 'search', icon: 'search', name: n => (n === 1 ? 'Searched the code' : `Searched ${n} times`) },
  WebSearch: { key: 'web', icon: 'globe', name: n => (n === 1 ? 'Looked on the web' : `${n} web lookups`) },
  WebFetch: { key: 'web', icon: 'globe', name: n => (n === 1 ? 'Looked on the web' : `${n} web lookups`) },
}

export function isHidden(tool: string): boolean {
  return HIDDEN.has(tool)
}

export function groupOf(tool: string) {
  return GROUPS[tool]
}

function base(path: unknown): string {
  if (typeof path !== 'string' || path === '') return ''
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function clip(text: string, n: number): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** The icon, short name and "where" of a call, from its tool and arguments. */
export function describe(tool: string, input: Record<string, unknown>): { icon: string; name: string; where: string } {
  if (tool === 'Bash') {
    const desc = str(input.description)
    const cmd = str(input.command)
    return { icon: 'terminal', name: clip(desc || cmd || 'Ran a command', 40), where: clip(cmd, 120) }
  }
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
    const file = str(input.file_path) || str(input.notebook_path)
    const verb = tool === 'Write' ? 'Wrote' : 'Edited'
    return { icon: 'pen', name: `${verb} ${base(file) || 'a file'}`, where: file }
  }
  if (tool === 'Read' || tool === 'NotebookRead') {
    const file = str(input.file_path) || str(input.notebook_path)
    return { icon: 'book', name: 'Read a file', where: file }
  }
  if (tool === 'Grep' || tool === 'Glob' || tool === 'LS') {
    return { icon: 'search', name: 'Searched the code', where: clip(str(input.pattern) || str(input.path), 80) }
  }
  if (tool === 'WebSearch') {
    return { icon: 'globe', name: 'Looked on the web', where: clip(str(input.query), 100) }
  }
  if (tool === 'WebFetch') {
    return { icon: 'globe', name: 'Looked on the web', where: clip(str(input.url), 100) }
  }
  if (tool === 'Agent') {
    return {
      icon: 'helper',
      name: clip(str(input.description) || 'Helper agent', 40),
      where: clip(str(input.subagent_type) || 'general-purpose', 60),
    }
  }
  if (tool === 'Skill') {
    return { icon: 'spark', name: clip(`Skill: ${str(input.skill)}`, 40), where: 'skill' }
  }
  if (tool === 'Artifact' || tool === 'SendUserFile' || tool === 'SendFile') {
    return { icon: 'send', name: tool === 'Artifact' ? 'Published a page' : 'Sent you a file', where: tool }
  }
  if (tool === 'AskUserQuestion') {
    return { icon: 'chat', name: 'Asked you a question', where: 'you' }
  }
  if (tool.startsWith('mcp__')) {
    const [, server = '', ...rest] = tool.split('__')
    const name = rest.join('__').replace(/[_-]+/g, ' ')
    return { icon: 'plug', name: clip(`${server.replace(/_/g, ' ')}: ${name}`, 40), where: `${server} (connected app)` }
  }
  return { icon: 'gear', name: clip(tool, 40), where: tool }
}

/** Status of a finished call from its time and whether it failed. */
export function finishedStatus(node: FlowNode, endedAt: number, isError: boolean): FlowStatus {
  if (isError) return 'error'
  const limit = node.kind === 'agent' ? SLOW_AGENT_MS : SLOW_MS
  return endedAt - node.startedAt > limit ? 'slow' : 'ok'
}

export function cap(nodes: FlowNode[]): FlowNode[] {
  return nodes.length > MAX_NODES ? nodes.slice(-MAX_NODES) : nodes
}

export function seconds(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

export function timeOf(node: FlowNode): string {
  if (node.kind === 'prompt') return 'start'
  if (node.endedAt === undefined) return 'working…'
  return seconds(node.endedAt - node.startedAt)
}

export type Chips = { good: string[]; weak: string[]; improve: string[] }

/** Good / weak / improve, read off what the box actually recorded. */
export function chipsFor(node: FlowNode): Chips {
  const good: string[] = []
  const weak: string[] = []
  const improve: string[] = []
  const took = node.endedAt === undefined ? undefined : node.endedAt - node.startedAt

  if (node.kind === 'prompt') {
    good.push('Your request: everything after this box is Claude working on it')
    return { good, weak, improve }
  }
  if (node.status === 'running') {
    good.push('Working on it right now')
  }
  if (node.status === 'ok' && took !== undefined) {
    good.push(`Finished in ${seconds(took)}`)
  }
  if (node.kind === 'group' && node.count > 1) {
    good.push(`${node.count} quick look-ups folded into one box`)
  }
  if (node.kind === 'group' && node.count >= 10) {
    weak.push(`A lot of looking (${node.count}) before acting`)
  }
  if (node.kind === 'agent' && node.steps !== undefined && node.steps > 0) {
    good.push(`Helper took ${node.steps} step${node.steps === 1 ? '' : 's'} on its own`)
    if (node.steps > 40) weak.push('The helper needed many steps')
  }
  if (node.status === 'slow' && took !== undefined) {
    weak.push(`Slow: took ${seconds(took)}`)
    improve.push(node.kind === 'agent' ? 'Smaller, sharper tasks finish faster' : 'Long jobs can run in the background')
  }
  if (node.status === 'error') {
    weak.push(node.error ? `Failed: ${clip(node.error, 140)}` : 'This step failed')
    improve.push('Claude reads the error and normally retries or changes approach')
  }
  return { good, weak, improve }
}

export function statusLine(nodes: FlowNode[], tasks: PlanTask[]): string {
  const work = nodes.filter(n => n.kind !== 'prompt')
  const steps = work.reduce((sum, n) => sum + (n.kind === 'group' ? n.count : 1), 0)
  const failed = work.filter(n => n.status === 'error').length
  const helpers = work.filter(n => n.kind === 'agent' && n.status === 'running').length
  const now = [...work].reverse().find(n => n.status === 'running')
  const done = tasks.filter(t => t.status === 'completed').length
  const parts = [`◆ ${steps} step${steps === 1 ? '' : 's'}`]
  if (tasks.length > 0) parts.push(`plan ${done}/${tasks.length}`)
  if (helpers > 0) parts.push(`${helpers} helper${helpers === 1 ? '' : 's'} working`)
  if (failed > 0) parts.push(`${failed} failed`)
  if (now) parts.push(`now: ${clip(now.name, 28)}`)
  return `${parts.join(' · ')}  (/flow)`
}

// ---------------------------------------------------------------- drawing

// Stroke icons on a 24-unit grid, in the reference page's style.
const ICONS: Record<string, string> = {
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/>',
  pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M8 7h7M8 11h5"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  plug: '<path d="M9 3v5M15 3v5M7 8h10v4a5 5 0 0 1-10 0zM12 17v4"/>',
  helper: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/><path d="M17 4l2-2M7 4L5 2"/>',
  spark: '<path d="M5 19L15 9"/><path d="M15 3l1.2 3.3L19.5 7.5l-3.3 1.2L15 12l-1.2-3.3L10.5 7.5l3.3-1.2z"/>',
  send: '<path d="M3 11l18-8-8 18-2-8z"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  check: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12l3 3 5-6"/>',
}

// Colours and fonts are written onto every shape as plain attributes, not in
// a <style> block: an app that strips <style> from an SVG would otherwise draw
// every shape in its default black, invisible on a dark pane. Motion is SMIL
// (<animate>), which lives in attributes too.
const INK = '#13292C'
const MUTED = '#5B6E70'
const LINE = '#B9C7C4'
const ACCENT = '#E25F2A'
const OK = '#24895C'
const WARN = '#C98A12'
const BAD = '#C8423A'
const IDEA = '#2D6AA8'
const PANEL = '#FFFFFF'
const BG = '#EDF1EF'
const DISPLAY = 'Barlow Condensed, Arial Narrow, Helvetica Neue, Arial, sans-serif'
const MONO = 'Menlo, Consolas, monospace'
const SANS = '-apple-system, Segoe UI, Helvetica, Arial, sans-serif'

type Paint = Record<string, string>

const font = (family: string, size: number, weight = 400): Paint => ({
  'font-family': family,
  'font-size': String(size),
  'font-weight': String(weight),
})

const CLASSES: Record<string, Paint> = {
  bg: { fill: BG },
  bay: { fill: 'none', stroke: LINE, 'stroke-width': '1.5', 'stroke-dasharray': '7 5' },
  'bay-tbg': { fill: BG },
  'bay-t': { ...font(DISPLAY, 14, 700), 'letter-spacing': '1.1', fill: INK },
  'bay-e': { ...font(MONO, 11, 500), fill: MUTED },
  card: { fill: PANEL, stroke: LINE, 'stroke-width': '2' },
  'k-agent': { stroke: IDEA },
  's-running': { stroke: ACCENT },
  's-error': { stroke: BAD, 'stroke-dasharray': '6 4' },
  sel: { 'stroke-width': '3.5' },
  glow: { fill: 'none', stroke: ACCENT, 'stroke-width': '4', opacity: '0.25' },
  ico: { fill: 'none', stroke: INK, 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
  name: { ...font(DISPLAY, 15, 700), fill: INK },
  when: { ...font(MONO, 10.5, 500), fill: MUTED },
  now: { ...font(MONO, 10.5, 500), fill: IDEA },
  'd-ok': { fill: OK },
  'd-running': { fill: OK },
  'd-slow': { fill: WARN },
  'd-error': { fill: BAD },
  'd-pending': { fill: LINE },
  wire: { fill: 'none', stroke: MUTED, 'stroke-width': '2', 'stroke-dasharray': '6 6' },
  lit: { stroke: ACCENT, 'stroke-width': '3' },
  fail: { stroke: BAD, 'stroke-dasharray': '3 6', opacity: '0.8' },
  head: { fill: MUTED },
  bob: { fill: ACCENT, stroke: PANEL, 'stroke-width': '2' },
  empty: { ...font(SANS, 13, 500), fill: MUTED },
  'chip-good': { fill: '#E2F2EA' },
  'chip-weak': { fill: '#F8E3E1' },
  'chip-improve': { fill: '#E3ECF7' },
  'chip-t': { ...font(SANS, 12.5), fill: INK },
  'mark-good': { ...font(SANS, 13, 700), fill: OK },
  'mark-weak': { ...font(SANS, 13, 700), fill: BAD },
  'mark-improve': { ...font(SANS, 13, 700), fill: IDEA },
  h4: { ...font(DISPLAY, 12.5, 700), 'letter-spacing': '1', fill: INK },
  dt: { ...font(MONO, 11.5, 500), fill: MUTED },
  dd: { ...font(MONO, 11.5, 500), fill: INK },
  title: { ...font(DISPLAY, 22, 700), fill: INK },
  'pill-ok': { fill: '#E2F2EA' },
  'pill-running': { fill: '#E2F2EA' },
  'pill-slow': { fill: '#FAF0DA' },
  'pill-error': { fill: '#F8E3E1' },
  'pill-t': font(MONO, 11, 600),
  'pill-t-ok': { fill: OK },
  'pill-t-running': { fill: OK },
  'pill-t-slow': { fill: WARN },
  'pill-t-error': { fill: BAD },
  frame: { fill: PANEL, stroke: INK, 'stroke-width': '2' },
}

function attrsFor(classes: string[]): string {
  const merged: Paint = {}
  for (const one of classes) Object.assign(merged, CLASSES[one])
  // Arrow heads take the colour of their wire; a selected card keeps red if it failed.
  if (classes.includes('head') && classes.includes('lit')) Object.assign(merged, { fill: ACCENT, stroke: 'none', 'stroke-width': '0' })
  if (classes.includes('head') && classes.includes('fail')) Object.assign(merged, { fill: BAD, stroke: 'none', 'stroke-dasharray': 'none', opacity: '1' })
  if (classes.includes('sel') && !classes.includes('s-error')) merged.stroke = INK
  if (classes.includes('k-agent') && !classes.includes('s-error') && !classes.includes('sel')) merged.stroke = IDEA
  return Object.entries(merged)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ')
}

const MARCH = '<animate attributeName="stroke-dashoffset" from="0" to="-24" dur="1.2s" repeatCount="indefinite"/>'

/** Turns the class names into attributes, and adds the motion. */
function paint(svg: string): string {
  return svg
    .replace(/<(path|circle) class="([^"]*)"([^>]*?)\/>/g, (all, tag: string, cls: string, rest: string) => {
      const classes = cls.split(/\s+/).filter(Boolean)
      if (tag === 'path' && classes.includes('wire') && !classes.includes('fail')) {
        return `<path ${attrsFor(classes)}${rest}>${MARCH}</path>`
      }
      if (tag === 'circle' && classes.includes('pulse')) {
        const r = /r="([\d.]+)"/.exec(rest)?.[1] ?? '5'
        const big = (Number(r) * 1.5).toFixed(1)
        return `<circle ${attrsFor(classes)}${rest}><animate attributeName="r" values="${r};${big};${r}" dur="1.4s" repeatCount="indefinite"/></circle>`
      }
      return all.replace(`class="${cls}"`, attrsFor(classes))
    })
    .replace(/class="([^"]*)"/g, (_all, cls: string) => attrsFor(cls.split(/\s+/).filter(Boolean)))
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Splits text into at most `lines` lines of about `width` characters. */
export function wrap(text: string, width: number, lines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const out: string[] = []
  let line = ''
  for (const word of words) {
    const next = line === '' ? word : `${line} ${word}`
    if (next.length <= width) {
      line = next
      continue
    }
    if (line !== '') out.push(line)
    line = word.length > width ? `${word.slice(0, width - 1)}…` : word
    if (out.length === lines) break
  }
  if (out.length < lines && line !== '') out.push(line)
  if (out.length === lines && words.join(' ').length > out.join(' ').length) {
    const last = out[lines - 1] ?? ''
    out[lines - 1] = last.length >= width ? `${last.slice(0, width - 1)}…` : `${last}…`
  }
  return out.slice(0, lines)
}

type Box = { x: number; y: number; w: number; h: number }
type Slot = Box & { row: number }

function grid(count: number, cols: number, left: number, top: number, w: number, h: number, gapX: number, gapY: number): Slot[] {
  const slots: Slot[] = []
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols)
    const inRow = i % cols
    // Serpentine: odd rows run right to left so each arrow stays short.
    const col = row % 2 === 0 ? inRow : cols - 1 - inRow
    slots.push({ x: left + col * (w + gapX), y: top + row * (h + gapY), w, h, row })
  }
  return slots
}

function route(a: Slot, b: Slot): { d: string; end: [number, number]; angle: number } {
  if (a.row === b.row) {
    const forward = b.x > a.x
    const x1 = forward ? a.x + a.w : a.x
    const x2 = forward ? b.x - 3 : b.x + b.w + 3
    const y = a.y + a.h / 2
    const k = forward ? 14 : -14
    return { d: `M${x1} ${y} C${x1 + k} ${y} ${x2 - k} ${y} ${x2} ${y}`, end: [x2, y], angle: forward ? 0 : 180 }
  }
  const x1 = a.x + a.w / 2
  const y1 = a.y + a.h
  const x2 = b.x + b.w / 2
  const y2 = b.y - 3
  const k = Math.max(14, (y2 - y1) / 2)
  return { d: `M${x1} ${y1} C${x1} ${y1 + k} ${x2} ${y2 - k} ${x2} ${y2}`, end: [x2, y2], angle: 90 }
}

function arrowHead(end: [number, number], angle: number, cls: string): string {
  const [x, y] = end
  return `<path class="head ${cls}" transform="translate(${x} ${y}) rotate(${angle})" d="M0 0L-8 -4.5L-8 4.5z"/>`
}

function icon(name: string, x: number, y: number, size: number): string {
  const s = size / 24
  return `<g class="ico" transform="translate(${x} ${y}) scale(${s})">${ICONS[name] ?? ICONS.gear}</g>`
}

function bay(x: number, y: number, w: number, h: number, title: string, rawExtra: string): string {
  // Keep the subtitle inside the bay: drop its trailing parts until it fits.
  const room = Math.floor((w - 40 - title.length * 8.6) / 6.6)
  const pieces = rawExtra.split(' · ')
  while (pieces.length > 0 && pieces.join(' · ').length > room) pieces.pop()
  const extra = pieces.join(' · ')
  const titleW = title.length * 8.6 + extra.length * 6.6 + 30
  return [
    `<rect class="bay" x="${x}" y="${y}" width="${w}" height="${h}" rx="14"/>`,
    `<rect class="bay-tbg" x="${x + 10}" y="${y - 10}" width="${Math.min(titleW, w - 20)}" height="20"/>`,
    `<text x="${x + 18}" y="${y + 5}"><tspan class="bay-t">${esc(title.toUpperCase())}</tspan><tspan class="bay-e" dx="8">${esc(extra)}</tspan></text>`,
  ].join('')
}

export type Layout = { width: number; cols: number; cardW: number }

/** How many cards fit across a drawing `width` CSS pixels wide. */
export function layoutFor(width: number): Layout {
  const pad = 14
  const gap = 32
  const min = 132
  const inner = width - 2 * pad - 24
  const cols = Math.max(1, Math.min(5, Math.floor((inner + gap) / (min + gap))))
  const cardW = Math.min(176, Math.floor((inner - (cols - 1) * gap) / cols))
  return { width, cols, cardW }
}

export type Drawing = { source: string; alt: string; height: number }

/** The whole flow (plan bay, work bay, arrows, the moving dot) as one SVG. */
export function drawFlow(nodes: FlowNode[], tasks: PlanTask[], selected: string | null, width: number): Drawing {
  const { cols, cardW } = layoutFor(width)
  const gapX = 32
  const gapY = 34
  const bayX = 8
  const bayW = width - 16
  const innerLeft = bayX + 12 + Math.max(0, (bayW - 24 - (cols * cardW + (cols - 1) * gapX)) / 2)
  const parts: string[] = []
  let y = 16

  // ---- the plan bay
  if (tasks.length > 0) {
    const h = 50
    const slots = grid(tasks.length, cols, innerLeft, y + 24, cardW, h, gapX, 26)
    const rows = Math.ceil(tasks.length / cols)
    const bayH = 24 + rows * h + (rows - 1) * 26 + 16
    const done = tasks.filter(t => t.status === 'completed').length
    parts.push(bay(bayX, y, bayW, bayH, 'The plan', `${done} of ${tasks.length} done`))
    for (let i = 1; i < slots.length; i++) {
      const a = slots[i - 1]
      const b = slots[i]
      if (a === undefined || b === undefined) continue
      const r = route(a, b)
      const isLit = tasks[i]?.status === 'in_progress'
      parts.push(`<path class="wire${isLit ? ' lit' : ''}" d="${r.d}"/>`, arrowHead(r.end, r.angle, isLit ? 'lit' : ''))
    }
    tasks.forEach((task, i) => {
      const s = slots[i]
      if (s === undefined) return
      const state = task.status === 'completed' ? 'ok' : task.status === 'in_progress' ? 'running' : 'pending'
      const lines = wrap(task.subject, Math.floor((cardW - 46) / 7.2), 2)
      parts.push(
        `<g><title>${esc(task.subject)} (${task.status.replace('_', ' ')})</title>`,
        state === 'running' ? `<rect class="glow" x="${s.x - 3}" y="${s.y - 3}" width="${s.w + 6}" height="${s.h + 6}" rx="13"/>` : '',
        `<rect class="card${state === 'running' ? ' s-running' : ''}" x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="11"/>`,
        icon(task.status === 'completed' ? 'check' : 'check', s.x + 9, s.y + 13, 22),
        lines
          .map((line, j) => `<text class="name" x="${s.x + 38}" y="${s.y + (lines.length === 1 ? 30 : 22 + j * 16)}">${esc(line)}</text>`)
          .join(''),
        `<circle class="d-${state}${state === 'running' ? ' pulse' : ''}" cx="${s.x + s.w - 10}" cy="${s.y + 10}" r="5"/>`,
        '</g>',
      )
    })
    y += bayH + 26
  }

  // ---- the work bay
  const h = 92
  const slots = grid(Math.max(nodes.length, 1), cols, innerLeft, y + 26, cardW, h, gapX, gapY)
  const rows = Math.max(1, Math.ceil(nodes.length / cols))
  const bayH = 26 + rows * h + (rows - 1) * gapY + 18
  const working = nodes.filter(n => n.status === 'running' && n.kind !== 'prompt').length
  const helpers = nodes.filter(n => n.kind === 'agent').length
  const extra = [
    `${nodes.filter(n => n.kind !== 'prompt').length} boxes`,
    helpers > 0 ? `${helpers} helper${helpers === 1 ? '' : 's'}` : '',
    working > 0 ? `${working} working` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  parts.push(bay(bayX, y, bayW, bayH, 'What Claude is doing', extra))

  if (nodes.length === 0) {
    parts.push(`<text class="empty" x="${innerLeft}" y="${y + 60}">Nothing yet. Boxes appear as Claude works.</text>`)
  }

  const wires: string[] = []
  let bobPath = ''
  for (let i = 1; i < nodes.length; i++) {
    const a = slots[i - 1]
    const b = slots[i]
    const node = nodes[i]
    if (a === undefined || b === undefined || node === undefined) continue
    const r = route(a, b)
    const cls = node.status === 'error' ? 'fail' : node.status === 'running' ? 'lit' : ''
    wires.push(`<path class="wire ${cls}" d="${r.d}"/>`, arrowHead(r.end, r.angle, cls))
    if (node.status === 'running') bobPath = r.d
  }
  parts.push(...wires)

  nodes.forEach((node, i) => {
    const s = slots[i]
    if (s === undefined) return
    const isSel = node.id === selected
    const cls = `card k-${node.kind} s-${node.status}${isSel ? ' sel' : ''}`
    const nameLines = wrap(node.name, Math.floor((s.w - 20) / 7.4), 2)
    const tip = `${node.name}${node.where ? ` (${node.where})` : ''}: ${timeOf(node)}`
    parts.push(
      `<g><title>${esc(tip)}</title>`,
      node.status === 'running' ? `<rect class="glow" x="${s.x - 3}" y="${s.y - 3}" width="${s.w + 6}" height="${s.h + 6}" rx="14"/>` : '',
      `<rect class="${cls}" x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="12"/>`,
      icon(node.icon, s.x + 10, s.y + 9, 26),
      `<circle class="d-${node.status}${node.status === 'running' ? ' pulse' : ''}" cx="${s.x + s.w - 13}" cy="${s.y + 14}" r="5.5"/>`,
      nameLines.map((line, j) => `<text class="name" x="${s.x + 10}" y="${s.y + 52 + j * 16}">${esc(line)}</text>`).join(''),
      node.kind === 'agent' && node.now && node.status === 'running'
        ? `<text class="now" x="${s.x + 10}" y="${s.y + h - 9}">${esc(wrap(`now: ${node.now}`, Math.floor((s.w - 20) / 6.4), 1)[0] ?? '')}</text>`
        : `<text class="when" x="${s.x + 10}" y="${s.y + h - 9}">#${i + 1} · ${esc(timeOf(node))}${
            node.kind === 'agent' && node.steps ? ` · ${node.steps} steps` : ''
          }</text>`,
      '</g>',
    )
  })

  if (bobPath !== '') {
    parts.push(
      `<circle class="bob" r="6"><animateMotion dur="1.6s" repeatCount="indefinite" path="${bobPath}"/></circle>`,
    )
  }

  const height = y + bayH + 14
  const alt = altText(nodes, tasks)
  const source = paint(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><rect class="bg" x="0" y="0" width="${width}" height="${height}" rx="12"/>${parts.join('')}</svg>`)
  return { source, alt, height }
}

function altText(nodes: FlowNode[], tasks: PlanTask[]): string {
  const plan = tasks.map(t => `${t.subject} (${t.status.replace('_', ' ')})`).join(', ')
  const work = nodes.map((n, i) => `${i + 1}. ${n.name}: ${n.status}`).join('; ')
  return `Flow of Claude's work. ${plan ? `Plan: ${plan}. ` : ''}${work ? `Steps: ${work}.` : 'No steps yet.'}`
}

const STATUS_WORDS: Record<FlowStatus, string> = {
  running: 'working now',
  ok: 'done',
  slow: 'done, but slow',
  error: 'failed',
}

export function statusWord(status: FlowStatus): string {
  return STATUS_WORDS[status]
}

/** The detail card for one box, in the reference page's card style. */
export function drawDetail(node: FlowNode, width: number): Drawing {
  const w = Math.min(width, 440)
  const chars = Math.floor((w - 56) / 6.6)
  const chips = chipsFor(node)
  const parts: string[] = []
  let y = 18

  parts.push(icon(node.icon, 18, y, 32))
  const title = wrap(node.name, Math.floor((w - 70) / 10), 2)
  title.forEach((line, i) => parts.push(`<text class="title" x="60" y="${y + 24 + i * 24}">${esc(line)}</text>`))
  y += 24 + title.length * 24

  const word = statusWord(node.status)
  const pillW = word.length * 7 + 18
  parts.push(
    `<rect class="pill-${node.status}" x="18" y="${y - 2}" width="${pillW}" height="20" rx="10"/>`,
    `<text class="pill-t pill-t-${node.status}" x="27" y="${y + 12}">${esc(word)}</text>`,
  )
  y += 34

  const rows: [string, string][] = [
    ['what', node.kind === 'group' ? `${node.count} similar steps in a row` : node.kind === 'agent' ? 'A helper agent working on its own' : node.kind === 'prompt' ? 'You asked Claude' : 'One action'],
    ['where', node.where || '—'],
    ['time', timeOf(node)],
  ]
  if (node.kind === 'agent') rows.push(['steps', String(node.steps ?? 0)])
  for (const [dt, dd] of rows) {
    const lines = wrap(dd, chars - 8, 3)
    parts.push(`<text class="dt" x="18" y="${y}">${dt}</text>`)
    lines.forEach((line, i) => parts.push(`<text class="dd" x="72" y="${y + i * 15}">${esc(line)}</text>`))
    y += Math.max(1, lines.length) * 15 + 4
  }
  y += 6

  const section = (head: string, list: string[], kind: 'good' | 'weak' | 'improve', mark: string) => {
    if (list.length === 0) return
    parts.push(`<text class="h4" x="18" y="${y + 10}">${head}</text>`)
    y += 18
    for (const chip of list) {
      const lines = wrap(chip, chars, 3)
      const ch = lines.length * 16 + 10
      parts.push(
        `<rect class="chip-${kind}" x="18" y="${y}" width="${w - 36}" height="${ch}" rx="8"/>`,
        `<text class="mark-${kind}" x="27" y="${y + 18}">${mark}</text>`,
        lines.map((line, i) => `<text class="chip-t" x="42" y="${y + 18 + i * 16}">${esc(line)}</text>`).join(''),
      )
      y += ch + 5
    }
    y += 4
  }
  section('GOOD', chips.good, 'good', '+')
  section('WEAK', chips.weak, 'weak', '–')
  section('IMPROVE', chips.improve, 'improve', '→')

  const height = y + 10
  const source = paint(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${height}" viewBox="0 0 ${w} ${height}" role="img"><rect class="frame" x="1" y="1" width="${w - 2}" height="${height - 2}" rx="14"/>${parts.join('')}</svg>`)
  const alt = `${node.name}: ${word}. Where: ${node.where || 'n/a'}. Time: ${timeOf(node)}. ${[
    ...chips.good.map(c => `Good: ${c}.`),
    ...chips.weak.map(c => `Weak: ${c}.`),
    ...chips.improve.map(c => `Improve: ${c}.`),
  ].join(' ')}`
  return { source, alt, height }
}

