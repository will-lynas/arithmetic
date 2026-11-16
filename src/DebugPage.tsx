import { useMemo } from 'react'
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { samplerDiagnostics } from './scheduler'
import { debugDistributions } from './debugDistributions'
import type { AttemptRecord } from './types'
import './debug.css'

const score=(value:number)=>Number(value.toFixed(3)).toString()
const chance=(value:number)=>`${(value*100).toFixed(4)}%`
const tick=(value:number)=>value===0?'0':Math.abs(value)<0.01||Math.abs(value)>=10000?value.toExponential(1):Number(value.toPrecision(3)).toString()
const names={floor:'Floor',coverageBoost:'Coverage',errorBoost:'Error',speedBoost:'Speed'}

export default function DebugPage({attempts,now,roundId,current,onRefresh}:{attempts:readonly AttemptRecord[];now:number;roundId?:string;current?:{left:number;right:number};onRefresh:()=>void}) {
  const snapshot=useMemo(()=>samplerDiagnostics(attempts,now,roundId),[attempts,now,roundId])
  const distributions=useMemo(()=>debugDistributions(snapshot,attempts),[snapshot,attempts])
  return <main className="debug-page">
    <div className="debug-heading"><h2>Sampler debug</h2><button type="button" onClick={onRefresh}>Refresh snapshot</button></div>
    <div className="debug-context"><span>{roundId?'Active round · next draw':'Fresh round · next draw'}</span>{current&&<span>Already chosen: {current.left} × {current.right}</span>}<time dateTime={new Date(now).toISOString()}>Snapshot {new Date(now).toLocaleString()}</time></div>
    <dl className="debug-summary"><div><dt>Eligible</dt><dd>{snapshot.eligibleCount} / 144</dd></div><div><dt>Excluded</dt><dd>{144-snapshot.eligibleCount}</dd></div><div><dt>Eligible raw score</dt><dd>{score(snapshot.totalWeight)}</dd></div></dl>
    <details className="debug-definitions"><summary>Definitions and formula</summary>
      <p>This is a hypothetical draw now, from submitted history; not the probability of the already chosen question or a forecast after its next answer.</p>
      <p>Chance = 0.5 / eligible questions + 0.5 × total weight / sum of eligible weights. Excluded questions have zero chance. Equal eligible weights give uniform draws.</p>
      <p>Total weight = 0.05 floor + coverage + error + speed. Coverage = 16 × (3 − min(lifetime completions, 3)): 48 / 32 / 16 / 0. A correction counts once toward completion, but remains error evidence.</p>
      <p>Error (≤12): recent failed presentations decay with intervening trials and age; independent clean answers halve the signal. Speed (≤2): bounded, shrunk median log-latency above the learner baseline; requires 12 clean observations. Recent difficulty uses 256 presentations, at most eight per fact. Lifetime completions are uncapped.</p>
      <p>The last two observed presentations cool both operand orders. Two exact-pair presentations cap the active round. Unsubmitted questions are not observations. Legacy cross-round order is approximate after clock changes.</p>
      <p>Histograms count all 144 ordered questions, including excluded questions and zero values. Accuracy and mean solve time omit missing samples and report them separately. Each question has equal histogram weight regardless of its observation count. Bins are lower-inclusive, upper-exclusive except the final inclusive end. Raw scores are not probabilities; factor contributions overlap, not independent selectable populations. Weights are custom product tuning, not a mastery measure.</p>
    </details>
    <section aria-label="Question distributions"><h3>Distributions across 144 questions</h3><div className="debug-plots">{distributions.map(d=>{
      const data=d.bins.map((b,i)=>({...b,range:`${tick(b.lower)}–${tick(b.upper)}${i===d.bins.length-1?' (inclusive end)':''}`,label:`${tick(b.lower)}–${tick(b.upper)}`}))
      return <figure key={d.key} aria-label={`${d.title} histogram`} className="debug-plot" data-metric={d.key}>
        <figcaption><h4>{d.title}</h4><span>{d.unit}</span><span>{d.known} known / 144 · {d.missing} missing</span></figcaption>
        <ResponsiveContainer width="100%" height={205}><BarChart data={data} margin={{top:12,right:12,bottom:28,left:0}} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeOpacity={0.25}/>
          <XAxis dataKey="label" tick={{fill:'var(--muted)',fontSize:10}} interval="preserveStartEnd" axisLine={false} tickLine={false} label={{value:d.unit,position:'bottom',fill:'var(--muted)',fontSize:10}}/>
          <YAxis allowDecimals={false} width={38} tick={{fill:'var(--muted)',fontSize:10}} axisLine={false} tickLine={false} label={{value:'Questions',angle:-90,position:'insideLeft',fill:'var(--muted)',fontSize:10}}/>
          <Tooltip contentStyle={{background:'var(--panel)',border:'1px solid var(--line)',color:'var(--text)',fontSize:11}} labelFormatter={(_,payload)=>payload[0]?.payload?.range??''} formatter={(value)=>[value,'Questions']} cursor={{fill:'var(--line)',fillOpacity:0.2}}/>
          <Bar dataKey="count" fill="var(--text)" fillOpacity={0.8} isAnimationActive={false}/>
        </BarChart></ResponsiveContainer>
        <details><summary>Bin counts</summary><table aria-label={`${d.title} histogram bin counts`}><thead><tr><th>Range ({d.unit})</th><th>Questions</th></tr></thead><tbody>{data.map((b,i)=><tr key={i} data-lower={b.lower} data-upper={b.upper} data-count={b.count}><td>{b.range}</td><td>{b.count}</td></tr>)}</tbody></table></details>
      </figure>
    })}</div></section>
    <div className="debug-breakdowns">
      <section><h3>Chance by coverage</h3><table aria-label="Chance by lifetime completions"><thead><tr><th>Completions</th><th>Questions</th><th>Chance</th></tr></thead><tbody>{snapshot.coverage.map(c=><tr key={c.completed}><td>{c.completed===3?'3+':c.completed}</td><td>{c.count}</td><td>{chance(c.probability)}</td></tr>)}</tbody></table></section>
      <section><h3>Weighted score contributions</h3><table aria-label="Weighted score contributions"><thead><tr><th>Factor</th><th title="Across all 144 questions">Nonzero / 144</th><th title="Share of eligible raw score, not draw probability">Eligible score %</th></tr></thead><tbody>{snapshot.factors.map(f=><tr key={f.key}><td>{names[f.key]}</td><td>{f.count}</td><td>{(100*f.score/snapshot.totalWeight).toFixed(2)}%</td></tr>)}</tbody></table></section>
    </div>
    <section><h3>Ranked questions</h3><div className="debug-table-scroll" role="region" aria-label="Ranked questions scroll area" tabIndex={0}><table className="debug-ranking" aria-label="Ranked next-draw probabilities"><thead><tr>{['Rank','Question','Chance','Uniform ½','Weighted ½','Completions','Coverage','Error','Speed','Floor','Total weight','Eligibility'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{snapshot.rows.map((q,i)=><tr key={`${q.left}x${q.right}`} data-pair={`${q.left}x${q.right}`} data-probability={q.probability} data-eligible={q.eligible}><td>{i+1}</td><th scope="row">{q.left} × {q.right}</th><td>{chance(q.probability)}</td><td>{chance(q.uniformProbability)}</td><td>{chance(q.weightedProbability)}</td><td>{q.completed}</td><td>{score(q.coverageBoost)}</td><td>{score(q.errorBoost)}</td><td>{score(q.speedBoost)}</td><td>{q.floor}</td><td>{score(q.total)}</td><td>{q.eligible?'Eligible':q.exclusions.join('; ')}</td></tr>)}</tbody></table></div></section>
  </main>
}
