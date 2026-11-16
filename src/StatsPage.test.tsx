import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StatsPage } from './StatsPage'
import type { AttemptRecord } from './types'

const attempts: AttemptRecord[] = [
  { version: 1, id: 'wrong', roundId: 'sample', questionIndex: 0, left: 9, right: 6, answer: 53, correct: false, elapsedMs: 1000, submittedAt: '2026-01-01T00:00:00.000Z' },
  { version: 1, id: 'correct', roundId: 'sample', questionIndex: 0, left: 9, right: 6, answer: 54, correct: true, elapsedMs: 5000, submittedAt: '2026-01-01T00:00:02.000Z' },
  { version: 1, id: 'clean', roundId: 'independent', questionIndex: 0, left: 9, right: 6, answer: 54, correct: true, elapsedMs: 3000, submittedAt: '2026-01-01T00:00:03.000Z' },
]
const render = (records = attempts) => renderToStaticMarkup(createElement(StatsPage, { attempts: records }))
const table = (html: string, name: string) => html.match(new RegExp(`<table[^>]*aria-label="${name}"[^>]*>([\\s\\S]*?)</table>`))?.[1] ?? ''

describe('StatsPage', () => {
  it('preserves 144 accessible accuracy cells, axes, denominators and initially empty details', () => {
    const html = render()
    const accuracy = table(html, 'First-try accuracy by ordered multiplication pair')
    expect(accuracy.match(/data-pair=/g)).toHaveLength(144)
    expect(accuracy.match(/scope="col"/g)).toHaveLength(12)
    expect(accuracy.match(/scope="row"/g)).toHaveLength(12)
    expect(accuracy).toContain('aria-label="9 × 6: 50% first-try correct (1 of 2 questions); 1 wrong submission; average first answer 2.00 s; average solve 4.00 s (2 solved)"')
    expect(accuracy).toContain('aria-label="6 × 9: unattempted (0 questions)"')
    expect(html).toContain('First-try accuracy')
    expect(html).toContain('Unattempted')
    expect(html).toContain('0%')
    expect(html).toContain('100%')
    expect(html).not.toContain(' details"')
    expect(html).not.toContain('<h3>')
    expect(html.match(/<section class="stats-detail"><\/section>/g)).toHaveLength(2)
  })
  it('adds a third numeric completion table below speed, counting each solved presentation once', () => {
    const empty = table(render([]), 'Completions by ordered multiplication pair')
    expect(empty.match(/>0<\/span>/g)).toHaveLength(144)
    const html = render([
      ...attempts,
      { ...attempts[1], id: 'duplicate-success', elapsedMs: 6000 },
      { ...attempts[2], id: 'same-round-next-index', questionIndex: 1 },
      { ...attempts[2], id: 'reverse', left: 6, right: 9 },
      { ...attempts[0], id: 'wrong-only', left: 2, right: 3 },
      ...Array.from({ length: 100001 }, (_, index) => ({
        ...attempts[2], id: `lifetime-${index}`, roundId: `older-${index}`, left: 12, right: 12, answer: 144,
      })),
    ])
    const completions = table(html, 'Completions by ordered multiplication pair')
    expect(completions.match(/data-pair=/g)).toHaveLength(144)
    expect(completions.match(/scope="col"/g)).toHaveLength(12)
    expect(completions.match(/scope="row"/g)).toHaveLength(12)
    expect(completions).toContain('aria-label="9 × 6: 3 completions"')
    expect(completions).toContain('aria-label="6 × 9: 1 completion"')
    expect(completions).toContain('aria-label="2 × 3: 0 completions"')
    expect(completions).toContain('aria-label="1 × 1: 0 completions"')
    expect(completions).toContain('>100001</span>')
    expect(html).toContain('Fewest 1')
    expect(html).toContain('Most 100001')
    expect(completions).toMatch(/data-pair="12x12"[^>]*><span[^>]*background-color:color-mix\(in srgb, var\(--stats-mid\), var\(--stats-high\) 100%\)/)
    expect(html).toMatch(/aria-label="Completions by ordered multiplication pair" style="min-width:\d+px"/)
    expect(completions).not.toContain('<button')
    expect(html.indexOf('Completions by ordered multiplication pair')).toBeGreaterThan(html.indexOf('Average solve time by ordered multiplication pair'))
  })
  it('colors positive lifetime completions from the observed minimum through midpoint to maximum', () => {
    const records = [1, 3, 5].flatMap((count, pair) => Array.from({ length: count }, (_, index) => ({
      ...attempts[2], id: `count-${pair}-${index}`, roundId: `count-${pair}-${index}`, left: pair + 1, right: 1,
    })))
    const html = render(records)
    const completions = table(html, 'Completions by ordered multiplication pair')
    const fill = (pair: string) => completions.match(new RegExp(`data-pair="${pair}"[^>]*><span[^>]*style="([^"]*)"`))?.[1]
    expect(fill('1x1')).toBe('background-color:color-mix(in srgb, var(--stats-low), var(--stats-mid) 0%)')
    expect(fill('2x1')).toBe('background-color:color-mix(in srgb, var(--stats-low), var(--stats-mid) 100%)')
    expect(fill('3x1')).toBe('background-color:color-mix(in srgb, var(--stats-mid), var(--stats-high) 100%)')
    expect(fill('4x1')).toBeUndefined()
    expect(html).toContain('Fewest 1')
    expect(html).toContain('Most 5')
  })
  it('adds a second ordered map using per-presentation mean solve time including corrections', () => {
    const html = render()
    const speed = table(html, 'Average solve time by ordered multiplication pair')
    expect(speed.match(/data-pair=/g)).toHaveLength(144)
    expect(speed.match(/scope="col"/g)).toHaveLength(12)
    expect(speed.match(/scope="row"/g)).toHaveLength(12)
    expect(speed).toContain('9 × 6: average solve 4.00 s (2 solved questions)')
    expect(speed).toContain('including corrections')
    expect(speed).toContain('>4.00 s</button>')
    expect(html).toContain('Fastest 4.00 s')
    expect(html).toContain('Slowest 4.00 s')
  })
  it('distinguishes wrong-only, missing, true zero and reversed pairs', () => {
    const speed = table(render([
      attempts[0],
      { ...attempts[2], left: 6, right: 9, elapsedMs: 0 },
    ]), 'Average solve time by ordered multiplication pair')
    expect(speed).toContain('9 × 6: no solved questions (1 attempted question)')
    expect(speed).toContain('6 × 9: average solve 0.00 s (1 solved question)')
    expect(speed).toContain('1 × 1: unattempted (0 questions)')
    expect(speed).toContain('>0.00 s</button>')
  })
})
