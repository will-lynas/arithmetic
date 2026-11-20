import { useEffect, useMemo, useState } from 'react'
import { loadQuadraticEvents, quadraticStatistics } from './quadraticHistory'
import { formatQuadratic, quadraticKey } from './quadratics'

const accuracy = (correct: number, attempted: number) => attempted ? `${Number((100 * correct / attempted).toFixed(1))}%` : '—'
const duration = (ms: number | null) => ms === null ? '—' : `${(ms / 1000).toFixed(2)} s`

export function QuadraticsStatsPage() {
  const [data, setData] = useState(loadQuadraticEvents)
  useEffect(() => {
    const refresh = () => setData(loadQuadraticEvents())
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', refresh)
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('storage', refresh) }
  }, [])
  const unreadable = data.warnings.length > 0
  const {summary, rows} = useMemo(() => quadraticStatistics(data.events, unreadable), [data, unreadable])
  return <main aria-label="Quadratics statistics" className="quadratics-stats">
    {data.warnings.map(warning => <p className="storage-warning" role="alert" key={warning}>{warning}</p>)}
    <dl className="division-stats-summary" aria-label="Quadratics summary">
      <div><dt>Questions attempted</dt><dd>{summary.attempted}</dd></div>
      <div><dt>First-try accuracy</dt><dd title={`${summary.firstTry} of ${summary.attempted} questions`}>{accuracy(summary.firstTry, summary.attempted)}</dd></div>
      <div><dt>Average solve time</dt><dd title="Active time through the correct answer, including retries">{duration(summary.meanSolveMs)}</dd></div>
      <div><dt>Completed rounds</dt><dd>{unreadable ? '—' : summary.completedRounds}</dd></div>
    </dl>
    <table className="division-stats-table" aria-label="Statistics by quadratic">
      <thead><tr><th scope="col">Quadratic</th><th scope="col">Tried</th><th scope="col">First try</th><th scope="col">Avg solve</th></tr></thead>
      <tbody>{rows.map(({question, attempted, firstTry, meanSolveMs}) => <tr key={quadraticKey(question)}>
        <th scope="row">{formatQuadratic(question)}</th><td>{attempted}</td><td>{accuracy(firstTry, attempted)}</td><td>{duration(meanSolveMs)}</td>
      </tr>)}</tbody>
    </table>
  </main>
}
