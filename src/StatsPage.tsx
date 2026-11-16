import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import type { AttemptRecord } from './types'
import { aggregateStatistics } from './statistics'
import type { PairStatistics } from './statistics'
import './stats.css'

const factors = Array.from({ length: 12 }, (_, index) => index + 1)
const percent = (value: number | null) => value === null ? '—' : `${Number(value.toFixed(1))}%`
const duration = (value: number | null) => value === null ? '—' : `${(value / 1000).toFixed(2)} s`

function cellLabel(pair: PairStatistics): string {
  const name = `${pair.left} × ${pair.right}`
  if (!pair.questions) return `${name}: unattempted (0 questions)`
  return `${name}: ${percent(pair.accuracy)} first-try correct (${pair.firstTryCorrect} of ${pair.questions} questions); ${pair.errors} wrong submission${pair.errors === 1 ? '' : 's'}; average first answer ${duration(pair.averageFirstAnswerMs)}; average solve ${duration(pair.averageSolveMs)} (${pair.solved} solved)`
}

export function StatsPage({ attempts }: { attempts: readonly AttemptRecord[] }) {
  const { pairs, summary } = useMemo(() => aggregateStatistics(attempts), [attempts])
  const [selected, setSelected] = useState(() => Math.max(0, pairs.findIndex(pair => pair.questions > 0)))
  const [hovered, setHovered] = useState<number | null>(null)
  const [keyboardFocused, setKeyboardFocused] = useState<number | null>(null)
  const keyboard = useRef(true)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const active = hovered ?? keyboardFocused
  const detail = active === null ? null : pairs[active]

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.altKey || event.isComposing || ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return
      keyboard.current = true
      const index = buttons.current.indexOf(document.activeElement as HTMLButtonElement)
      if (index !== -1) { setHovered(null); setKeyboardFocused(index) }
    }
    const onPointer = () => { keyboard.current = false; setKeyboardFocused(null) }
    const onBlur = () => { setHovered(null); setKeyboardFocused(null) }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const row = Math.floor(index / 12)
    const column = index % 12
    const destinations: Record<string, number> = {
      ArrowLeft: row * 12 + Math.max(0, column - 1),
      ArrowRight: row * 12 + Math.min(11, column + 1),
      ArrowUp: Math.max(0, row - 1) * 12 + column,
      ArrowDown: Math.min(11, row + 1) * 12 + column,
      Home: event.ctrlKey ? 0 : row * 12,
      End: event.ctrlKey ? 143 : row * 12 + 11,
    }
    const next = destinations[event.key]
    if (next === undefined || event.altKey || event.metaKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    buttons.current[next]?.focus()
  }

  return <section className="stats-page" aria-label="Statistics">
    <dl className="stats-summary">
      <div><dt>Questions attempted</dt><dd>{summary.questions}</dd></div>
      <div><dt>First-try accuracy</dt><dd title={`${summary.firstTryCorrect} of ${summary.questions} questions`}>{percent(summary.accuracy)}</dd></div>
      <div><dt>Errors</dt><dd>{summary.errors}</dd></div>
      <div><dt>Completed rounds</dt><dd>{summary.completedRounds}</dd></div>
    </dl>
    <div className="stats-map-heading">
      <h2>First-try accuracy</h2>
      <div className="stats-legend" aria-label="Accuracy color scale">
        <span>0%</span><span className="stats-legend-scale" aria-hidden="true" /><span>100%</span>
        <span className="stats-legend-empty" aria-hidden="true" /><span>Unattempted</span>
      </div>
    </div>
    <div className="stats-map-scroll" role="region" aria-label="Multiplication accuracy map" tabIndex={0}>
    <table className="stats-heatmap" aria-label="First-try accuracy by ordered multiplication pair">
      <thead><tr><td aria-hidden="true">×</td>{factors.map(right => <th scope="col" key={right}>{right}</th>)}</tr></thead>
      <tbody>{factors.map(left => <tr key={left}>
        <th scope="row">{left}</th>
        {factors.map(right => {
          const index = (left - 1) * 12 + right - 1
          const pair = pairs[index]
          const accuracy = pair.accuracy
          const fill = accuracy === null ? undefined : accuracy <= 50
            ? `color-mix(in srgb, var(--stats-low), var(--stats-mid) ${accuracy * 2}%)`
            : `color-mix(in srgb, var(--stats-mid), var(--stats-high) ${(accuracy - 50) * 2}%)`
          return <td key={right}>
            <button type="button" className="stats-cell" data-pair={`${left}x${right}`}
              data-attempted={pair.questions > 0} aria-label={cellLabel(pair)} title={cellLabel(pair)}
              tabIndex={selected === index ? 0 : -1} style={{ backgroundColor: fill } as CSSProperties}
              ref={element => { buttons.current[index] = element }}
              onFocus={() => { setSelected(index); if (keyboard.current) setKeyboardFocused(index) }}
              onBlur={() => setKeyboardFocused(null)}
              onPointerEnter={() => setHovered(index)} onPointerLeave={() => setHovered(null)}
              onPointerCancel={() => setHovered(null)}
              onPointerUp={event => { if (event.pointerType === 'touch') setHovered(null) }}
              onKeyDown={event => navigate(event, index)}>
              {percent(accuracy)}
            </button>
          </td>
        })}
      </tr>)}</tbody>
    </table>
    </div>
    <section className="stats-detail" aria-label={detail ? `${detail.left} × ${detail.right} details` : undefined}>
      {detail && <>
      <h3>{detail.left} × {detail.right}</h3>
      <dl>
        <div><dt>Questions attempted</dt><dd>{detail.questions}</dd></div>
        <div><dt>First-try correct</dt><dd>{detail.firstTryCorrect} / {detail.questions}<span> ({percent(detail.accuracy)})</span></dd></div>
        <div><dt>Wrong submissions</dt><dd>{detail.errors}</dd></div>
        <div><dt>Avg first answer</dt><dd>{duration(detail.averageFirstAnswerMs)}</dd></div>
        <div><dt>Avg solve</dt><dd>{duration(detail.averageSolveMs)}<span> ({detail.solved} solved)</span></dd></div>
      </dl>
      </>}
    </section>
  </section>
}
