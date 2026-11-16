import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { loadDivisionEvents, type DivisionEvent } from './division'
import { aggregateDivisionStatistics, type DivisionMetrics } from './divisionStatistics'
import './divisionStats.css'

const percent = (value: number | null) => value === null ? '—' : `${Number(value.toFixed(1))}%`
const duration = (value: number | null) => value === null ? '—' : `${(value / 1000).toFixed(2)} s`

function Metric({ children, detail }: { children: ReactNode; detail: string }) {
  return <details className="division-stat-metric"><summary aria-label={`${typeof children === 'string' ? children : ''}; ${detail}`}>{children}</summary><span className="division-stat-count">{detail}</span></details>
}
function accuracyDetail(metrics: DivisionMetrics) {
  return metrics.questions ? `${metrics.firstTryCorrect} of ${metrics.questions} questions correct on the first try` : 'No attempted questions'
}
function solveDetail(metrics: DivisionMetrics) {
  return metrics.solved ? `${metrics.solved} solved question${metrics.solved === 1 ? '' : 's'}; includes correction time` : 'No solved questions'
}

export function DivisionStatsPage({ events, hasUnreadableData = false }: { events: readonly DivisionEvent[]; hasUnreadableData?: boolean }) {
  const { summary, divisors } = useMemo(() => aggregateDivisionStatistics(events, { hasUnreadableData }), [events, hasUnreadableData])
  return <section className="division-stats" aria-label="Division statistics">
    <dl className="division-stats-summary">
      <div><dt>Questions attempted</dt><dd>{summary.questions}</dd></div>
      <div><dt>First-try accuracy</dt><dd><Metric detail={accuracyDetail(summary)}>{percent(summary.accuracy)}</Metric></dd></div>
      <div><dt>Average solve time</dt><dd><Metric detail={solveDetail(summary)}>{duration(summary.averageSolveMs)}</Metric></dd></div>
      <div><dt>Completed rounds</dt><dd>{summary.completedRounds}</dd></div>
    </dl>
    <table className="division-stats-table" aria-label="Division statistics by divisor">
      <thead><tr><th scope="col">Divisor</th><th scope="col">Questions</th><th scope="col">First try</th><th scope="col">Avg solve</th></tr></thead>
      <tbody>{divisors.map(row => <tr key={row.divisor}>
        <th scope="row">÷ {row.divisor}</th><td>{row.questions}</td>
        <td><Metric detail={accuracyDetail(row)}>{percent(row.accuracy)}</Metric></td>
        <td><Metric detail={solveDetail(row)}>{duration(row.averageSolveMs)}</Metric></td>
      </tr>)}</tbody>
    </table>
  </section>
}

export function DivisionStatsRoute() {
  const [data, setData] = useState(loadDivisionEvents)
  useEffect(() => {
    const refresh = () => setData(loadDivisionEvents())
    window.addEventListener('storage', refresh)
    window.addEventListener('focus', refresh)
    window.addEventListener('popstate', refresh)
    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('popstate', refresh)
    }
  }, [])
  return <main>{data.warnings.map(warning => <p className="storage-warning" role="alert" key={warning}>{warning}</p>)}<DivisionStatsPage events={data.events} hasUnreadableData={data.warnings.length > 0}/></main>
}
