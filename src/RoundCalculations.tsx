export function RoundCalculations({ rows }: { rows: { calculation: string; completions: number }[] }) {
  return <table className="round-calculations" aria-label="Round calculations">
    <thead><tr><th scope="col">Calculation</th><th scope="col">Overall completions</th></tr></thead>
    <tbody>{rows.map(({ calculation, completions }, index) => <tr key={index}><th scope="row">{calculation}</th><td>{completions}</td></tr>)}</tbody>
  </table>
}
