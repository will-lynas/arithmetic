import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DivisionStatsPage } from './DivisionStatsPage'
import type { DivisionAttempt } from './division'

const wrong: DivisionAttempt = { version: 1, kind: 'attempt', id: 'wrong', roundId: 'round', submittedAt: '2026-01-01T00:00:00.000Z', questionIndex: 0, dividend: 20, divisor: 3, quotient: 6, remainder: 2, answerQuotient: 5, answerRemainder: 2, correct: false, elapsedMs: 1000, sequence: 0 }

describe('DivisionStatsPage', () => {
  it('renders a compact native table with 12 divisors, exact denominators on demand and honest missing values', () => {
    const html = renderToStaticMarkup(createElement(DivisionStatsPage, { events: [wrong] }))
    expect(html).toContain('aria-label="Division statistics"')
    expect(html).toContain('aria-label="Division statistics by divisor"')
    expect(html.match(/scope="row"/g)).toHaveLength(12)
    expect(html).toContain('Average solve time')
    expect(html).toContain('0 of 1 questions correct on the first try')
    expect(html).toContain('No solved questions')
    expect(html).toContain('No attempted questions')
    expect(html).toContain('0%')
    expect(html).toContain('—')
    expect(html).not.toContain('heatmap')
  })
})
