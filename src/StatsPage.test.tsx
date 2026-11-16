import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StatsPage } from './StatsPage'
import type { AttemptRecord } from './types'

const attempts: AttemptRecord[] = [
  { version: 1, id: 'wrong', roundId: 'sample', questionIndex: 0, left: 9, right: 6, answer: 53, correct: false, elapsedMs: 1000, submittedAt: '2026-01-01T00:00:00.000Z' },
  { version: 1, id: 'correct', roundId: 'sample', questionIndex: 0, left: 9, right: 6, answer: 54, correct: true, elapsedMs: 3000, submittedAt: '2026-01-01T00:00:02.000Z' },
]

describe('StatsPage', () => {
  it('renders 144 accessible ordered cells with both factor axes and first-try denominators', () => {
    const html = renderToStaticMarkup(createElement(StatsPage, { attempts }))
    expect(html.match(/data-pair=/g)).toHaveLength(144)
    expect(html.match(/scope="col"/g)).toHaveLength(12)
    expect(html.match(/scope="row"/g)).toHaveLength(12)
    expect(html).toContain('aria-label="9 × 6: 0% first-try correct (0 of 1 questions); 1 wrong submission; average first answer 1.00 s; average solve 3.00 s (1 solved)"')
    expect(html).toContain('aria-label="6 × 9: unattempted (0 questions)"')
    expect(html).toContain('First-try accuracy')
    expect(html).toContain('Unattempted')
    expect(html).toContain('0%')
    expect(html).toContain('100%')
    expect(html).not.toContain(' details"')
    expect(html).not.toContain('<h3>')
    expect(html).toContain('<section class="stats-detail"></section>')
  })
})
