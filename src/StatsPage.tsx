import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import type { AttemptRecord } from './types'
import { aggregateStatistics } from './statistics'
import type { PairStatistics } from './statistics'
import { speedDuration, speedPosition, speedScale } from './speedPresentation'
import './stats.css'

const factors = Array.from({ length: 12 }, (_, index) => index + 1)
const percent = (value: number | null) => value === null ? '—' : `${Number(value.toFixed(1))}%`
const duration = (value: number | null) => value === null ? '—' : `${(value / 1000).toFixed(2)} s`
const solveDefinition = 'Arithmetic mean active time to the first correct submission per solved question, including corrections.'
type Metric = 'accuracy' | 'speed'
type ActiveCell = { metric: Metric; index: number }

function cellLabel(pair: PairStatistics): string {
  const name = `${pair.left} × ${pair.right}`
  if (!pair.questions) return `${name}: unattempted (0 questions)`
  return `${name}: ${percent(pair.accuracy)} first-try correct (${pair.firstTryCorrect} of ${pair.questions} questions); ${pair.errors} wrong submission${pair.errors === 1 ? '' : 's'}; average first answer ${duration(pair.averageFirstAnswerMs)}; average solve ${duration(pair.averageSolveMs)} (${pair.solved} solved)`
}

function speedLabel(pair: PairStatistics): string {
  const name = `${pair.left} × ${pair.right}`
  if (!pair.questions) return `${name}: unattempted (0 questions). ${solveDefinition}`
  if (!pair.solved) return `${name}: no solved questions (${pair.questions} attempted question${pair.questions === 1 ? '' : 's'}). ${solveDefinition}`
  return `${name}: average solve ${speedDuration(pair.averageSolveMs)} (${pair.solved} solved question${pair.solved === 1 ? '' : 's'}). ${solveDefinition}`
}

export function StatsPage({ attempts }: { attempts: readonly AttemptRecord[] }) {
  const { pairs, summary } = useMemo(() => aggregateStatistics(attempts), [attempts])
  const scale = useMemo(() => speedScale(pairs.map(pair => pair.averageSolveMs)), [pairs])
  const completions = useMemo(() => speedScale(pairs.map(pair => pair.solved || null)), [pairs])
  const completionDigits = Math.max(...pairs.map(pair => String(pair.solved).length))
  const completedSquares = pairs.filter(pair => pair.solved > 0).length
  const [selected, setSelected] = useState(() => {
    const first = Math.max(0, pairs.findIndex(pair => pair.questions > 0))
    return { accuracy: first, speed: first }
  })
  const [hovered, setHovered] = useState<ActiveCell | null>(null)
  const [keyboardFocused, setKeyboardFocused] = useState<ActiveCell | null>(null)
  const [touched, setTouched] = useState<ActiveCell | null>(null)
  const keyboard = useRef(true)
  const buttons = useRef<Record<Metric, (HTMLButtonElement | null)[]>>({ accuracy: [], speed: [] })
  const active = hovered ?? keyboardFocused ?? touched

  useEffect(() => {
    let gesture: { id: number; x: number; y: number; cell: ActiveCell | null; moved: boolean } | null = null
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.altKey || event.isComposing || ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return
      keyboard.current = true
      setTouched(null)
      for (const metric of ['accuracy', 'speed'] as const) {
        const index = buttons.current[metric].indexOf(document.activeElement as HTMLButtonElement)
        if (index !== -1) { setHovered(null); setKeyboardFocused({ metric, index }) }
      }
    }
    const onPointer = (event: PointerEvent) => {
      keyboard.current = false
      setKeyboardFocused(null)
      if (event.pointerType !== 'touch') { setTouched(null); gesture = null; return }
      setHovered(null)
      if (!event.isPrimary) { gesture = null; return }
      let cell: ActiveCell | null = null
      for (const metric of ['accuracy', 'speed'] as const) {
        const index = buttons.current[metric].findIndex(button => button?.contains(event.target as Node))
        if (index !== -1) cell = { metric, index }
      }
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, cell, moved: false }
    }
    const onMove = (event: PointerEvent) => {
      if (gesture?.id === event.pointerId && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 8) gesture.moved = true
    }
    const onUp = (event: PointerEvent) => {
      if (gesture?.id !== event.pointerId) return
      if (!gesture.moved) setTouched(gesture.cell)
      gesture = null
    }
    const onCancel = () => { gesture = null }
    const onBlur = () => { gesture = null; setHovered(null); setKeyboardFocused(null); setTouched(null) }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('pointermove', onMove, true)
    document.addEventListener('pointerup', onUp, true)
    document.addEventListener('pointercancel', onCancel, true)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('pointermove', onMove, true)
      document.removeEventListener('pointerup', onUp, true)
      document.removeEventListener('pointercancel', onCancel, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  function navigate(event: KeyboardEvent<HTMLButtonElement>, metric: Metric, index: number) {
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
    buttons.current[metric][next]?.focus()
  }

  // Equal means have one color, not an artificial fastest/slowest distinction.
  const equal = scale.min === scale.max
  const sameRoundedEndpoints = !equal && speedDuration(scale.min) === speedDuration(scale.max)
  const endpoint = (value: number | null) => sameRoundedEndpoints && value !== null ? `${value / 1000} s` : speedDuration(value)

  function heatmap(metric: Metric) {
    const speed = metric === 'speed'
    const title = speed ? 'Average solve time' : 'First-try accuracy'
    const detail = active?.metric === metric ? pairs[active.index] : null
    return <div className="stats-map" key={metric}
      onPointerEnter={event => { if (event.pointerType !== 'touch') { setTouched(null); setKeyboardFocused(previous => previous?.metric === metric ? previous : null) } }}>
      <div className="stats-map-heading">
        <h2 title={speed ? solveDefinition : undefined}>{title}</h2>
        {speed ? <div className="stats-legend stats-speed-legend" aria-label="Solve time color scale"
          title={scale.min === null ? 'No solved questions' : `Linear scale of observed pair means: ${scale.min / 1000} to ${scale.max! / 1000} seconds`}>
          <span>Fastest {endpoint(scale.min)}</span>
          <span className="stats-legend-scale" data-equal={equal} data-empty={scale.min === null} aria-hidden="true" />
          <span>Slowest {endpoint(scale.max)}</span>
          <span className="stats-legend-key"><span className="stats-legend-empty" aria-hidden="true" /><span>Unsolved</span></span>
        </div> : <div className="stats-legend" aria-label="Accuracy color scale">
          <span>0%</span><span className="stats-legend-scale" aria-hidden="true" /><span>100%</span>
          <span className="stats-legend-empty" aria-hidden="true" /><span>Unattempted</span>
        </div>}
      </div>
      <div className="stats-map-scroll" role="region" aria-label={speed ? 'Multiplication solve time map' : 'Multiplication accuracy map'} tabIndex={0}>
      <table className="stats-heatmap" aria-label={`${title} by ordered multiplication pair`}>
        <thead><tr><td aria-hidden="true">×</td>{factors.map(right => <th scope="col" key={right}>{right}</th>)}</tr></thead>
        <tbody>{factors.map(left => <tr key={left}>
          <th scope="row">{left}</th>
          {factors.map(right => {
            const index = (left - 1) * 12 + right - 1
            const pair = pairs[index]
            const accuracy = pair.accuracy
            const position = speedPosition(pair.averageSolveMs, scale)
            const fill = speed ? position === null ? undefined : position <= 0.5
              ? `color-mix(in srgb, var(--stats-high), var(--stats-mid) ${position * 200}%)`
              : `color-mix(in srgb, var(--stats-mid), var(--stats-low) ${(position - 0.5) * 200}%)`
              : accuracy === null ? undefined : accuracy <= 50
                ? `color-mix(in srgb, var(--stats-low), var(--stats-mid) ${accuracy * 2}%)`
                : `color-mix(in srgb, var(--stats-mid), var(--stats-high) ${(accuracy - 50) * 2}%)`
            const label = speed ? speedLabel(pair) : cellLabel(pair)
            return <td key={right}>
              <button type="button" className="stats-cell" data-pair={`${left}x${right}`}
                data-attempted={speed ? pair.solved > 0 : pair.questions > 0}
                data-compact={speed && speedDuration(pair.averageSolveMs).length > 8} aria-label={label} title={label}
                tabIndex={selected[metric] === index ? 0 : -1} style={{ backgroundColor: fill } as CSSProperties}
                ref={element => { buttons.current[metric][index] = element }}
                onFocus={() => {
                  setSelected(previous => ({ ...previous, [metric]: index }))
                  if (keyboard.current) { setHovered(null); setTouched(null); setKeyboardFocused({ metric, index }) }
                }}
                onBlur={() => setKeyboardFocused(null)}
                onPointerEnter={event => {
                  if (event.pointerType === 'touch') return
                  setTouched(null)
                  setHovered({ metric, index })
                  setKeyboardFocused(previous => previous?.metric === metric ? previous : null)
                }} onPointerLeave={event => { if (event.pointerType !== 'touch') setHovered(null) }}
                onPointerCancel={() => setHovered(null)}
                onKeyDown={event => navigate(event, metric, index)}>
                {speed ? speedDuration(pair.averageSolveMs) : percent(accuracy)}
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
          <div title={solveDefinition}><dt>Avg solve</dt><dd>{speedDuration(detail.averageSolveMs)}<span> ({detail.solved} solved)</span></dd></div>
        </dl>
        </>}
      </section>
    </div>
  }

  return <section className="stats-page" aria-label="Statistics">
    <dl className="stats-summary">
      <div><dt>Questions attempted</dt><dd>{summary.questions}</dd></div>
      <div><dt>First-try accuracy</dt><dd title={`${summary.firstTryCorrect} of ${summary.questions} questions`}>{percent(summary.accuracy)}</dd></div>
      <div><dt>Errors</dt><dd>{summary.errors}</dd></div>
      <div><dt>Completed rounds</dt><dd>{summary.completedRounds}</dd></div>
    </dl>
    {heatmap('accuracy')}
    {heatmap('speed')}
    <div className="stats-map">
      <div className="stats-map-heading">
        <div className="stats-completion-heading">
          <h2>Completions</h2>
          <span className="stats-completed-squares">{`Completed: ${completedSquares} / 144`}</span>
        </div>
        <div className="stats-legend stats-completion-legend" aria-label="Completion count color scale">
          {completions.min === completions.max
            ? <span>{completions.min === null ? 'No completions' : `${completions.min} completion${completions.min === 1 ? '' : 's'}`}</span>
            : <span>Fewest {completions.min}</span>}
          <span className="stats-legend-scale" data-equal={completions.min === completions.max} data-empty={completions.min === null} aria-hidden="true" />
          {completions.min !== completions.max && <span>Most {completions.max}</span>}
          {completions.min !== null && <span className="stats-legend-key"><span className="stats-legend-empty" aria-hidden="true" /><span>0</span></span>}
        </div>
      </div>
      <div className="stats-map-scroll" role="region" aria-label="Multiplication completions map" tabIndex={0}>
        <table className="stats-heatmap" aria-label="Completions by ordered multiplication pair"
          // Keep long lifetime counts legible by scrolling, not clipping or shrinking them.
          style={completionDigits > 5 ? { minWidth: `${(completionDigits * 8 + 8) * 12 + 84}px` } : undefined}>
          <thead><tr><td aria-hidden="true">×</td>{factors.map(right => <th scope="col" key={right}>{right}</th>)}</tr></thead>
          <tbody>{factors.map(left => <tr key={left}>
            <th scope="row">{left}</th>
            {factors.map(right => {
              const count = pairs[(left - 1) * 12 + right - 1].solved
              const position = speedPosition(count || null, completions)
              const fill = position === null ? undefined : position <= 0.5
                ? `color-mix(in srgb, var(--stats-low), var(--stats-mid) ${position * 200}%)`
                : `color-mix(in srgb, var(--stats-mid), var(--stats-high) ${(position - 0.5) * 200}%)`
              return <td key={right} data-pair={`${left}x${right}`} aria-label={`${left} × ${right}: ${count} completion${count === 1 ? '' : 's'}`}>
                <span className="stats-cell stats-completion" data-attempted={count > 0} style={{ backgroundColor: fill }}>{count}</span>
              </td>
            })}
          </tr>)}</tbody>
        </table>
      </div>
    </div>
  </section>
}
