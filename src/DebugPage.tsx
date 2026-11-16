import { useMemo } from 'react'
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { samplerDiagnostics } from './scheduler'
import { countTicks, debugDistributions } from './debugDistributions'
import type { AttemptRecord } from './types'
import './debug.css'

const score=(value:number)=>Number(value.toFixed(3)).toString()
const chance=(value:number)=>`${(value*100).toFixed(4)}%`

export default function DebugPage({attempts,now,roundId,current,onRefresh}:{attempts:readonly AttemptRecord[];now:number;roundId?:string;current?:{left:number;right:number};onRefresh:()=>void}) {
  const snapshot=useMemo(()=>samplerDiagnostics(attempts,now,roundId),[attempts,now,roundId])
  const distributions=useMemo(()=>debugDistributions(snapshot,attempts),[snapshot,attempts])
  return <main className="debug-page">
    <div className="debug-heading"><h2>Sampler debug</h2><button type="button" onClick={onRefresh}>Refresh</button></div>
    <div className="debug-context"><span>{roundId?'Active round · next draw':'Fresh round · next draw'}</span><span>{snapshot.eligibleCount} / 144 eligible</span>{current&&<span>Current: {current.left} × {current.right}</span>}<time dateTime={new Date(now).toISOString()} title={new Date(now).toLocaleString()}>{new Date(now).toLocaleTimeString()}</time></div>
    <section aria-label="Question distributions"><h3 className="visually-hidden">Distributions across 144 questions</h3><div className="debug-plots">{distributions.map(d=>{
      const data=d.bins.map((b,i)=>({...b,range:b.lower===b.upper?String(b.lower):`[${b.lower}, ${b.upper}${i===d.bins.length-1?']':')'}`,label:b.lower===b.upper?String(b.lower):`${b.lower}–${b.upper}`}))
      const ticks=countTicks(Math.max(0,...d.bins.map(b=>b.count)))
      // Explicit percentage avoids Recharts' auto-width integer rounding and its 90% full-band fallback.
      const barSize=`${99.999999/data.length}%`
      return <figure key={d.key} aria-label={`${d.title} histogram`} className="debug-plot" data-metric={d.key}>
        <figcaption><h4>{d.title}{d.unit&&<span> ({d.unit})</span>}</h4>{d.missing>0&&<span>{d.missing} missing</span>}</figcaption>
        {d.known>0?<ResponsiveContainer width="100%" height={154}><BarChart data={data} margin={{top:8,right:8,bottom:0,left:0}} barCategoryGap={0} barGap={0} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeOpacity={0.25}/>
          <XAxis dataKey="label" tick={{fill:'var(--muted)',fontSize:10}} minTickGap={8} interval="preserveStartEnd" axisLine={false} tickLine={false} height={25}/>
          <YAxis allowDecimals={false} ticks={ticks} domain={[0,ticks.at(-1)!]} width={30} tick={{fill:'var(--muted)',fontSize:10}} axisLine={false} tickLine={false}/>
          <Tooltip contentStyle={{background:'var(--panel)',border:'1px solid var(--line)',color:'var(--text)',fontSize:11}} labelFormatter={(_,payload)=>payload[0]?.payload?.range??''} formatter={(value)=>[value,'Questions']} cursor={{fill:'var(--line)',fillOpacity:0.2}}/>
          <Bar dataKey="count" barSize={barSize} fill={`var(--debug-${d.key})`} isAnimationActive={false} shape={({x,y,width,height,index,payload})=><rect x={x} y={y} width={width} height={height} fill={`var(--debug-${d.key})`} data-bin-index={index} data-count={payload.count}/>}/>
        </BarChart></ResponsiveContainer>:<div className="debug-empty">No observations</div>}
        <table className="visually-hidden" aria-label={`${d.title} histogram bin counts`}><thead><tr><th>Range{d.unit&&` (${d.unit})`}</th><th>Questions</th></tr></thead><tbody>{data.map((b,i)=><tr key={i} data-lower={b.lower} data-upper={b.upper} data-count={b.count}><td>{b.range}</td><td>{b.count}</td></tr>)}</tbody></table>
      </figure>
    })}</div></section>
    <section><h3>Ranked questions</h3><div className="debug-table-scroll" role="region" aria-label="Ranked questions scroll area" tabIndex={0}><table className="debug-ranking" aria-label="Ranked next-draw probabilities"><thead><tr>{['Rank','Question','Chance','Completions','Coverage','Error','Speed','Floor','Total weight','Eligibility'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{snapshot.rows.map((q,i)=><tr key={`${q.left}x${q.right}`} data-pair={`${q.left}x${q.right}`} data-probability={q.probability} data-eligible={q.eligible}><td>{i+1}</td><th scope="row">{q.left} × {q.right}</th><td>{chance(q.probability)}</td><td>{q.completed}</td><td>{score(q.coverageBoost)}</td><td>{score(q.errorBoost)}</td><td>{score(q.speedBoost)}</td><td>{q.floor}</td><td>{score(q.total)}</td><td>{q.eligible?'Eligible':q.exclusions.join('; ')}</td></tr>)}</tbody></table></div></section>
  </main>
}
