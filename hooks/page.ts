// The side panel, drawn as one SVG in the look of the Live Flow page: a title
// and count tiles, a dashed bay per request, 150px cards with an icon, a name,
// a time and a status dot, marching wires and a bobber running into whatever
// is working now. Tapping a card opens its detail card (an in-drawing link to
// a :target; the panel runs no script).

import type { FlowNode, PlanTask } from '../types'
import { chipsFor, statusWord, timeOf, wrap } from './flow'

// The page's dark tokens are written onto every shape; a light override rides
// in a <style> block for a viewer whose app is light.
const D = {
  bg: '#0E1A1C', panel: '#162629', ink: '#E4EEEC', muted: '#93A8A6', line: '#35504F',
  accent: '#F27A44', ok: '#4CC08A', warn: '#E5B04A', bad: '#EE6A60', idea: '#6FA4E0',
  okBg: '#163A2C', warnBg: '#3A3018', badBg: '#3E1D1B', ideaBg: '#182D45',
}
const L = {
  bg: '#EDF1EF', panel: '#FFFFFF', ink: '#13292C', muted: '#5B6E70', line: '#B9C7C4',
  accent: '#E25F2A', ok: '#24895C', warn: '#C98A12', bad: '#C8423A', idea: '#2D6AA8',
  okBg: '#E2F2EA', warnBg: '#FAF0DA', badBg: '#F8E3E1', ideaBg: '#E3ECF7',
}
const DISPLAY = "'Barlow Condensed','Avenir Next Condensed','Arial Narrow','Roboto Condensed',sans-serif"
const BODY = "'IBM Plex Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif"
const MONO = "'IBM Plex Mono',Menlo,Consolas,monospace"

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

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

/** A shape's colour: the dark value as an attribute, the light one by class. */
const paint = (role: keyof typeof D, attr: 'fill' | 'stroke') => `${attr}="${D[role]}" class="${attr}-${role}"`

function lightCss(): string {
  const rules = Object.keys(L)
    .map(k => {
      const v = L[k as keyof typeof L]
      return `.fill-${k}{fill:${v}}.stroke-${k}{stroke:${v}}`
    })
    .join('')
  return `<style>@media (prefers-color-scheme: light){${rules}}
.detail{display:none}.detail:target{display:inline}
a{cursor:pointer}a:hover .cardbox{transform:translateY(-2px)}
@media (prefers-reduced-motion:reduce){animate,animateMotion{display:none}}</style>`
}

function icon(name: string, x: number, y: number, size: number): string {
  return `<g fill="none" ${paint('ink', 'stroke')} stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" transform="translate(${x} ${y}) scale(${size / 24})">${ICONS[name] ?? ICONS.gear}</g>`
}

function text(x: number, y: number, s: string, font: string, size: number, weight: number, role: keyof typeof D, extra = ''): string {
  return `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" ${paint(role, 'fill')} ${extra}>${esc(s)}</text>`
}

type Slot = { x: number; y: number; w: number; h: number; row: number }

function route(a: Slot, b: Slot): string {
  if (a.row === b.row) {
    const fwd = b.x > a.x
    const x1 = fwd ? a.x + a.w : a.x
    const x2 = fwd ? b.x : b.x + b.w
    const y = a.y + a.h / 2
    const k = fwd ? 18 : -18
    return `M${x1} ${y} C${x1 + k} ${y} ${x2 - k} ${y} ${x2} ${y}`
  }
  const down = b.y > a.y
  const x1 = a.x + a.w / 2
  const y1 = down ? a.y + a.h : a.y
  const x2 = b.x + b.w / 2
  const y2 = down ? b.y : b.y + b.h
  const k = Math.max(30, Math.abs(y2 - y1) / 2)
  return `M${x1} ${y1} C${x1} ${y1 + (down ? k : -k)} ${x2} ${y2 - (down ? k : -k)} ${x2} ${y2}`
}

export type Panel = { source: string; alt: string; width: number; height: number }

/** The whole panel, sized to `width` CSS pixels. */
export function drawPanel(nodes: FlowNode[], tasks: PlanTask[], width: number, now = Date.now(), refreshMs = 10_000): Panel {
  const W = Math.max(260, Math.round(width))
  const pad = 12
  const gapX = W >= 420 ? 44 : 18
  const gapY = 34
  const cols = Math.max(1, Math.floor((W - 2 * pad - 24 + gapX) / (150 + gapX)))
  const cardW = cols === 1 ? Math.min(W - 2 * pad - 24, 240) : Math.floor((W - 2 * pad - 24 - (cols - 1) * gapX) / cols)
  const cardH = 124
  const parts: string[] = []
  const overlays: string[] = []
  let y = 8

  // ---- title, tiles and legend, as on the page
  parts.push(`<text x="${pad}" y="${y + 30}" font-family="${DISPLAY}" font-size="34" font-weight="700"><tspan ${paint('ink', 'fill')}>Live </tspan><tspan ${paint('accent', 'fill')}>flow</tspan></text>`)
  y += 44
  parts.push(...refreshLine(pad, y, W - 2 * pad, now, refreshMs))
  y += 26
  const work = nodes.filter(n => n.kind !== 'prompt')
  const tiles: [string, string, keyof typeof D][] = [
    [String(work.reduce((s, n) => s + (n.kind === 'group' ? n.count : 1), 0)), 'steps', 'ink'],
    [String(work.filter(n => n.kind === 'agent').length), 'helpers', 'ink'],
    [String(work.filter(n => n.status === 'error').length), 'failed', 'bad'],
  ]
  const tileGap = 8
  const tileW = Math.floor((W - 2 * pad - tileGap * 2) / 3)
  tiles.forEach(([value, label, role], i) => {
    const x = pad + i * (tileW + tileGap)
    parts.push(
      `<rect x="${x}" y="${y}" width="${tileW}" height="58" rx="10" ${paint('panel', 'fill')} ${paint('line', 'stroke')} stroke-width="1"/>`,
      text(x + 10, y + 32, value, DISPLAY, 28, 700, role, 'font-variant-numeric="tabular-nums"'),
      text(x + 10, y + 49, label, MONO, 11, 500, 'muted'),
    )
  })
  y += 72
  const legend: [keyof typeof D, string][] = [['ok', 'done / working'], ['warn', 'slow'], ['bad', 'failed'], ['idea', 'helper']]
  let lx = pad
  for (const [role, label] of legend) {
    const w = 18 + label.length * 6.4
    if (lx + w > W - pad) {
      lx = pad
      y += 16
    }
    parts.push(`<circle cx="${lx + 5}" cy="${y + 6}" r="5" ${paint(role, 'fill')}/>`, text(lx + 14, y + 10, label, MONO, 11, 500, 'muted'))
    lx += w + 10
  }
  y += 30

  const bay = (title: string, sub: string, top: number, h: number) => {
    const room = Math.floor((W - 2 * pad - 40) / 8)
    const head = title.toUpperCase()
    const subFit = sub.length + head.length + 2 > room ? sub.slice(0, Math.max(0, room - head.length - 3)) + '…' : sub
    const labelW = Math.min(W - 2 * pad - 28, head.length * 10.5 + subFit.length * 7.6 + 30)
    parts.push(
      `<rect x="${pad}" y="${top}" width="${W - 2 * pad}" height="${h}" rx="14" fill="none" ${paint('line', 'stroke')} stroke-width="1.5" stroke-dasharray="7 5"/>`,
      `<rect x="${pad + 14}" y="${top - 11}" width="${labelW}" height="22" ${paint('bg', 'fill')}/>`,
      `<text x="${pad + 22}" y="${top + 5}"><tspan font-family="${DISPLAY}" font-size="15" font-weight="700" letter-spacing="1.2" ${paint('ink', 'fill')}>${esc(head)}</tspan><tspan dx="8" font-family="${MONO}" font-size="12" font-weight="500" ${paint('muted', 'fill')}>${esc(subFit)}</tspan></text>`,
    )
  }
  const grid = (count: number, top: number, h: number): Slot[] =>
    Array.from({ length: count }, (_, i) => {
      const row = Math.floor(i / cols)
      const inRow = i % cols
      const col = row % 2 === 0 ? inRow : cols - 1 - inRow
      const left = pad + 12 + Math.max(0, (W - 2 * pad - 24 - (cols * cardW + (cols - 1) * gapX)) / 2)
      return { x: left + col * (cardW + gapX), y: top + row * (h + gapY), w: cardW, h, row }
    })

  // ---- the plan
  if (tasks.length > 0) {
    const h = 64
    const top = y + 30
    const slots = grid(tasks.length, top, h)
    const rows = Math.ceil(tasks.length / cols)
    const bayH = 30 + rows * h + (rows - 1) * gapY + 16
    const done = tasks.filter(t => t.status === 'completed').length
    bay('The plan', `${done} of ${tasks.length} done`, y, bayH)
    tasks.forEach((t, i) => {
      const s = slots[i]
      if (!s) return
      const state = t.status === 'completed' ? 'ok' : t.status === 'in_progress' ? 'running' : 'pending'
      const lines = wrap(t.subject, Math.floor((s.w - 50) / 7.4), 2)
      parts.push(
        state === 'running' ? `<rect x="${s.x - 4}" y="${s.y - 4}" width="${s.w + 8}" height="${s.h + 8}" rx="15" fill="none" ${paint('accent', 'stroke')} stroke-width="4" opacity="0.3"/>` : '',
        `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="12" ${paint('panel', 'fill')} ${paint(state === 'running' ? 'accent' : 'line', 'stroke')} stroke-width="2"/>`,
        icon('check', s.x + 10, s.y + 10, 26),
        lines.map((l, j) => text(s.x + 44, s.y + (lines.length === 1 ? 36 : 28 + j * 17), l, DISPLAY, 16, 700, 'ink')).join(''),
        `<circle cx="${s.x + s.w - 14}" cy="${s.y + 14}" r="5.5" ${paint(state === 'pending' ? 'line' : 'ok', 'fill')}/>`,
      )
    })
    y += bayH + 34
  }

  // ---- the helpers: each one's task, what it is doing now, its last steps
  {
    const helpers = nodes.filter(n => n.kind === 'agent')
    const bw = W - 2 * pad - 24
    const blocks = helpers.map(h => helperBlock(h, pad + 12, 0, bw))
    const inner = blocks.reduce((s, b) => s + b.h + 12, 0)
    const bayH = helpers.length ? 30 + inner + 4 : 74
    const working = helpers.filter(h => h.status === 'running').length
    bay('Helpers', helpers.length ? `${helpers.length} · ${working} working` : 'none yet', y, bayH)
    if (!helpers.length) {
      wrap('A helper is a second agent Claude starts for a side job. Each one shows here with what it is doing.', Math.floor((W - 2 * pad - 32) / 6.6), 2).forEach((l, j) =>
        parts.push(text(pad + 16, y + 34 + j * 16, l, BODY, 12, 400, 'muted')),
      )
    }
    let hy = y + 30
    helpers.forEach(h => {
      const b = helperBlock(h, pad + 12, hy, bw)
      parts.push(b.svg)
      hy += b.h + 12
    })
    y += bayH + 34
  }

  // ---- one bay per request
  const groups: { title: string; sub: string; items: { n: FlowNode; i: number }[] }[] = []
  nodes.forEach((n, i) => {
    const last = groups[groups.length - 1]
    if (n.kind === 'prompt' || last === undefined) {
      groups.push({ title: n.kind === 'prompt' ? 'Request' : 'Earlier steps', sub: n.kind === 'prompt' ? `“${n.where}”` : '', items: [] })
    }
    groups[groups.length - 1]?.items.push({ n, i })
  })
  if (groups.length === 0) {
    bay('What Claude is doing', 'nothing yet', y, 90)
    parts.push(text(pad + 16, y + 52, 'Steps appear here as Claude works.', MONO, 12, 500, 'muted'))
    y += 90 + 20
  }
  const slotOf: Slot[] = []
  for (const g of groups) {
    const top = y + 30
    const slots = grid(g.items.length, top, cardH)
    const rows = Math.ceil(g.items.length / cols)
    const bayH = 30 + rows * cardH + (rows - 1) * gapY + 16
    const steps = g.items.filter(x => x.n.kind !== 'prompt').length
    bay(g.title, [`${steps} step${steps === 1 ? '' : 's'}`, g.sub].filter(Boolean).join(' · '), y, bayH)
    g.items.forEach((x, k) => {
      const s = slots[k]
      if (s) slotOf[x.i] = s
    })
    y += bayH + 34
  }

  // ---- wires first, cards over them
  const liveIdx = nodes.reduce((at, n, i) => (n.status === 'running' ? i : at), -1)
  for (let i = 1; i < nodes.length; i++) {
    const a = slotOf[i - 1]
    const b = slotOf[i]
    const n = nodes[i]
    if (!a || !b || !n) continue
    const d = route(a, b)
    const fail = n.status === 'error'
    const lit = i === liveIdx
    parts.push(
      `<path d="${d}" fill="none" ${paint(fail ? 'bad' : lit ? 'accent' : 'muted', 'stroke')} stroke-width="${lit ? 3 : 2}" stroke-dasharray="${fail ? '3 6' : '6 6'}" ${fail ? 'opacity="0.75"' : `marker-end="url(#arrow${lit ? 'Lit' : ''})"`}>${fail ? '' : '<animate attributeName="stroke-dashoffset" from="0" to="-24" dur="1.2s" repeatCount="indefinite"/>'}</path>`,
    )
    if (lit) {
      overlays.push(`<circle r="7" ${paint('accent', 'fill')} ${paint('panel', 'stroke')} stroke-width="2"><animateMotion dur="1.8s" repeatCount="indefinite" path="${d}"/></circle>`)
    }
  }

  nodes.forEach((n, i) => {
    const s = slotOf[i]
    if (!s) return
    const border: keyof typeof D = i === liveIdx ? 'accent' : n.status === 'error' ? 'bad' : n.kind === 'agent' ? 'idea' : 'line'
    const fill: keyof typeof D = n.kind === 'prompt' ? 'ideaBg' : 'panel'
    const dot: keyof typeof D = n.status === 'slow' ? 'warn' : n.status === 'error' ? 'bad' : 'ok'
    const label = kindLabel(n)
    const body = wrap(bodyText(n), Math.floor((s.w - 20) / 6.5), 3)
    const foot = text(s.x + 10, s.y + s.h - 10, `#${i + 1} · ${timeOf(n)}${n.kind === 'agent' && n.steps ? ` · ${n.steps} step${n.steps === 1 ? '' : 's'}` : ''}`, MONO, 11, 500, 'muted')
    parts.push(
      `<a href="#d${i}"><g class="cardbox"><title>${esc(n.name)}: ${esc(statusWord(n.status))}</title>`,
      i === liveIdx ? `<rect x="${s.x - 4}" y="${s.y - 4}" width="${s.w + 8}" height="${s.h + 8}" rx="15" fill="none" ${paint('accent', 'stroke')} stroke-width="4" opacity="0.3"/>` : '',
      `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="12" ${paint(fill, 'fill')} ${paint(border, 'stroke')} stroke-width="2" ${n.status === 'error' ? 'stroke-dasharray="6 4"' : ''}/>`,
      icon(n.icon, s.x + 10, s.y + 10, 26),
      text(s.x + 44, s.y + 30, wrap(label, Math.floor((s.w - 70) / 8.5), 1)[0] ?? '', DISPLAY, 17, 700, 'ink'),
      `<circle cx="${s.x + s.w - 14}" cy="${s.y + 14}" r="5.5" ${paint(dot, 'fill')}>${n.status === 'running' ? '<animate attributeName="r" values="5.5;8;5.5" dur="1.4s" repeatCount="indefinite"/>' : ''}</circle>`,
      body.map((l, j) => text(s.x + 10, s.y + 56 + j * 16, l, BODY, 12.5, 400, n.kind === 'agent' && j === body.length - 1 && n.status === 'running' && n.now ? 'idea' : 'ink')).join(''),
      foot,
      '</g></a>',
    )
    overlays.push(detailCard(n, i, W, Math.max(8, s.y - 10)))
  })

  const height = Math.max(y + 8, 420)
  const defs = `<defs>
<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" ${paint('muted', 'fill')}/></marker>
<marker id="arrowLit" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" ${paint('accent', 'fill')}/></marker></defs>`
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">${lightCss()}${defs}<rect x="0" y="0" width="${W}" height="${height}" ${paint('bg', 'fill')}/>${parts.join('')}${overlays.join('')}</svg>`
  const alt = `Live flow. ${tasks.length ? `Plan: ${tasks.map(t => `${t.subject} (${t.status.replace('_', ' ')})`).join(', ')}. ` : ''}${nodes.map((n, i) => `${i + 1}. ${n.name}: ${statusWord(n.status)}`).join('; ') || 'No steps yet.'}`
  return { source, alt, width: W, height }
}

/** The detail card, shown over the drawing when its card is tapped. */
function detailCard(n: FlowNode, i: number, W: number, top: number): string {
  const w = Math.min(W - 16, 400)
  const x = W - w - 8
  const chars = Math.floor((w - 48) / 7)
  const chips = chipsFor(n)
  const rows: string[] = []
  let y = 18
  rows.push(icon(n.icon, 16, y - 2, 32))
  const title = wrap(n.name, Math.floor((w - 110) / 10.5), 2)
  title.forEach((l, j) => rows.push(text(58, y + 22 + j * 24, l, DISPLAY, 24, 700, 'ink')))
  rows.push(
    `<a href="#close"><rect x="${w - 46}" y="${y}" width="32" height="28" rx="14" fill="none" ${paint('ink', 'stroke')} stroke-width="1.5"/>${text(w - 35, y + 19, '✕', BODY, 13, 600, 'ink')}</a>`,
  )
  y += 24 + title.length * 24
  const word = statusWord(n.status)
  const pill: keyof typeof D = n.status === 'error' ? 'badBg' : n.status === 'slow' ? 'warnBg' : 'okBg'
  const pillInk: keyof typeof D = n.status === 'error' ? 'bad' : n.status === 'slow' ? 'warn' : 'ok'
  rows.push(`<rect x="16" y="${y - 2}" width="${word.length * 7 + 18}" height="20" rx="10" ${paint(pill, 'fill')}/>`, text(25, y + 12, word, MONO, 11, 600, pillInk))
  y += 34
  const meta: [string, string][] = [
    ['where', n.where || '—'],
    ['time', timeOf(n)],
  ]
  if (n.kind === 'agent') meta.push(['steps', String(n.steps ?? 0)])
  for (const [k, v] of meta) {
    const lines = wrap(v, chars - 6, 3)
    rows.push(text(16, y, k, MONO, 12, 500, 'muted'))
    lines.forEach((l, j) => rows.push(text(70, y + j * 16, l, MONO, 12, 500, 'ink')))
    y += Math.max(1, lines.length) * 16 + 4
  }
  y += 6
  const section = (head: string, list: string[], bg: keyof typeof D, mark: string, markInk: keyof typeof D) => {
    if (list.length === 0) return
    rows.push(text(16, y + 10, head, DISPLAY, 13, 700, 'ink', 'letter-spacing="1"'))
    y += 18
    for (const c of list) {
      const lines = wrap(c, chars, 3)
      const h = lines.length * 17 + 10
      rows.push(
        `<rect x="16" y="${y}" width="${w - 32}" height="${h}" rx="8" ${paint(bg, 'fill')}/>`,
        text(25, y + 19, mark, BODY, 13, 700, markInk),
        lines.map((l, j) => text(40, y + 19 + j * 17, l, BODY, 13, 400, 'ink')).join(''),
      )
      y += h + 5
    }
    y += 4
  }
  section('GOOD', chips.good, 'okBg', '+', 'ok')
  section('WEAK', chips.weak, 'badBg', '–', 'bad')
  section('IMPROVE', chips.improve, 'ideaBg', '→', 'idea')
  const h = y + 8
  return `<g id="d${i}" class="detail"><g transform="translate(${x} ${top})"><rect x="0" y="0" width="${w}" height="${h}" rx="14" ${paint('panel', 'fill')} ${paint('ink', 'stroke')} stroke-width="2"/>${rows.join('')}</g></g>`
}

/** The card's short label: what kind of step it is, in a word or two. */
function kindLabel(n: FlowNode): string {
  if (n.kind === 'prompt') return 'You asked'
  if (n.kind === 'agent') return 'Helper'
  if (n.kind === 'group') return n.groupKey === 'read' ? 'Reading files' : n.groupKey === 'web' ? 'Web look-up' : 'Searching'
  const byIcon: Record<string, string> = { terminal: 'Command', pen: 'File change', book: 'Reading', search: 'Search', globe: 'Web look-up', spark: 'Skill', send: 'Shared', chat: 'Question' }
  if (n.icon === 'plug') return n.name.split(':')[0] || 'Connected app'
  return byIcon[n.icon] ?? n.name
}

/** What the step did, in plain words, for the card's body. */
function bodyText(n: FlowNode): string {
  if (n.kind === 'prompt') return n.where
  if (n.kind === 'agent') return n.status === 'running' && n.now ? `${n.name}. Now: ${n.now}` : n.name
  if (n.icon === 'plug') return n.name.split(':').slice(1).join(':').trim() || n.name
  if (n.kind === 'group') {
    const last = n.where.split('/').filter(Boolean).pop()
    return last ? `${n.name}, last: ${last}` : n.name
  }
  return n.name
}

/** One helper in the Helpers bay: its task, state, what it is doing, its last steps. */
function helperBlock(h: FlowNode, x: number, y: number, w: number): { svg: string; h: number } {
  const chars = Math.floor((w - 56) / 6.6)
  const task = wrap(h.name, Math.floor((w - 130) / 8.5), 2)
  const word = h.status === 'running' ? 'working' : statusWord(h.status)
  const dot: keyof typeof D = h.status === 'error' ? 'bad' : h.status === 'slow' ? 'warn' : 'ok'
  const type = h.where.replace(/^helper · /, '')
  const lines: string[] = []
  let cy = y + 26
  task.forEach((l, j) => lines.push(text(x + 44, cy + j * 19, l, DISPLAY, 17, 700, 'ink')))
  cy += task.length * 19 + 2
  lines.push(text(x + 44, cy, wrap(`${type} helper · ${h.steps ?? 0} step${h.steps === 1 ? '' : 's'} · ${timeOf(h).replace(' · working', '')}`, Math.floor((w - 56) / 6.8), 1)[0] ?? '', MONO, 11, 500, 'muted'))
  cy += 18
  const now = h.status === 'running' ? `Now: ${h.now ?? 'starting'}` : h.status === 'error' ? `Failed: ${h.error ?? ''}` : 'Finished its job'
  wrap(now, chars, 2).forEach((l, j) => lines.push(text(x + 14, cy + j * 16, l, BODY, 12.5, 600, h.status === 'error' ? 'bad' : h.status === 'running' ? 'idea' : 'ok')))
  cy += 18 * Math.min(2, Math.ceil(now.length / chars) || 1)
  for (const step of (h.recent ?? []).slice(-3)) {
    lines.push(text(x + 14, cy, `· ${wrap(step, chars, 1)[0] ?? ''}`, BODY, 12, 400, 'muted'))
    cy += 16
  }
  const height = cy - y + 6
  const svg = [
    `<rect x="${x}" y="${y}" width="${w}" height="${height}" rx="12" ${paint('panel', 'fill')} ${paint(h.status === 'error' ? 'bad' : 'idea', 'stroke')} stroke-width="2"/>`,
    icon('helper', x + 10, y + 10, 26),
    `<circle cx="${x + w - 16}" cy="${y + 16}" r="5.5" ${paint(dot, 'fill')}>${h.status === 'running' ? '<animate attributeName="r" values="5.5;8;5.5" dur="1.4s" repeatCount="indefinite"/>' : ''}</circle>`,
    text(x + w - 26 - word.length * 6.8, y + 20, word, MONO, 11, 600, dot, ''),
    ...lines,
  ].join('')
  return { svg, h: height }
}

function hhmmss(ms: number): string {
  const d = new Date(ms)
  const two = (v: number) => String(v).padStart(2, '0')
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}

/** "Updated 14:32:05 · next refresh in 9s" with a bar that empties. SMIL counts down. */
function refreshLine(x: number, y: number, w: number, now: number, refreshMs: number): string[] {
  const secs = Math.max(1, Math.round(refreshMs / 1000))
  const out: string[] = [text(x, y + 12, `Updated ${hhmmss(now)}`, MONO, 12, 600, 'ink')]
  for (let k = 0; k < secs; k++) {
    out.push(
      `<text x="${x + w}" y="${y + 12}" text-anchor="end" font-family="${MONO}" font-size="12" font-weight="500" ${paint('muted', 'fill')} visibility="${k === 0 ? 'visible' : 'hidden'}">next refresh in ${secs - k}s<set attributeName="visibility" to="visible" begin="${k}s" dur="1s"/>${k === 0 ? `<set attributeName="visibility" to="hidden" begin="1s"/>` : ''}</text>`,
    )
  }
  out.push(
    `<text x="${x + w}" y="${y + 12}" text-anchor="end" font-family="${MONO}" font-size="12" font-weight="500" ${paint('accent', 'fill')} visibility="hidden">refreshing…<set attributeName="visibility" to="visible" begin="${secs}s" fill="freeze"/></text>`,
    `<rect x="${x}" y="${y + 18}" width="${w}" height="3" rx="1.5" ${paint('line', 'fill')}/>`,
    `<rect x="${x}" y="${y + 18}" width="${w}" height="3" rx="1.5" ${paint('accent', 'fill')}><animate attributeName="width" from="${w}" to="0" dur="${secs}s" fill="freeze"/></rect>`,
  )
  return out
}
