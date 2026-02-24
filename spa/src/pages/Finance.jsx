import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api, exportCsv } from '../api.js'

function fmtBgn(v) { return v != null ? Number(v).toLocaleString('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' лв' : '-' }
function fmtPct(v) { return v != null ? Number(v).toFixed(1) + '%' : '-' }

export default function Finance() {
  const [pnl, setPnl] = useState(null)
  const [kpis, setKpis] = useState(null)
  const [sector, setSector] = useState(null)
  const [period, setPeriod] = useState(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
  })
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const [y, m] = period.split('-')
    const from_date = `${y}-${m}-01`
    const last = new Date(parseInt(y), parseInt(m), 0).getDate()
    const to_date = `${y}-${m}-${last}`
    const month_key = period
    try {
      const [p, k, s] = await Promise.all([
        api('reports.pnl', { from_date, to_date }),
        api('reports.financialKpis', { from_date, to_date }),
        api('reports.pnl.bySector', { month_key })
      ])
      setPnl(p.pnl)
      setKpis(k.financialKpis)
      setSector(s.sectors)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [period])

  if (loading) return <div className="loading">Зареждане...</div>

  return (
    <>
      <div className="page-header">
        <h1>Финансов отчет</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="month" value={period} onChange={e => setPeriod(e.target.value)} style={{ padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6 }} />
          <button className="btn btn-outline btn-sm" onClick={() => { const [y,m]=period.split('-'); exportCsv('pnl', { from_date: `${y}-${m}-01`, to_date: `${y}-${m}-${new Date(+y,+m,0).getDate()}` }) }}>Експорт CSV</button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        <div className="stat-card green">
          <div className="stat-value">{fmtBgn(pnl?.revenue)}</div>
          <div className="stat-label">Приходи</div>
        </div>
        <div className="stat-card red">
          <div className="stat-value">{fmtBgn(pnl?.total_cost)}</div>
          <div className="stat-label">Разходи</div>
        </div>
        <div className={`stat-card ${pnl?.operating_profit >= 0 ? 'green' : 'red'}`}>
          <div className="stat-value">{fmtBgn(pnl?.operating_profit)}</div>
          <div className="stat-label">Печалба</div>
        </div>
        <div className={`stat-card ${pnl?.operating_margin_pct >= 15 ? 'green' : pnl?.operating_margin_pct >= 5 ? 'yellow' : 'red'}`}>
          <div className="stat-value">{fmtPct(pnl?.operating_margin_pct)}</div>
          <div className="stat-label">Опер. марж</div>
        </div>
      </div>

      <div className="grid grid-2">
        {/* P&L Table */}
        <div className="card">
          <h3>Печалба и загуба</h3>
          <table>
            <tbody>
              <tr><td><strong>Приходи от продажби</strong></td><td style={{textAlign:'right'}}><strong>{fmtBgn(pnl?.revenue)}</strong></td></tr>
              <tr style={{borderTop:'2px solid var(--border)'}}><td>Фуражни разходи</td><td style={{textAlign:'right',color:'var(--danger)'}}>-{fmtBgn(pnl?.feed_cost)}</td></tr>
              <tr><td>Заплати</td><td style={{textAlign:'right',color:'var(--danger)'}}>-{fmtBgn(pnl?.salary_cost)}</td></tr>
              <tr><td>Ветеринарни</td><td style={{textAlign:'right',color:'var(--danger)'}}>-{fmtBgn(pnl?.vet_cost)}</td></tr>
              <tr><td>Други разходи</td><td style={{textAlign:'right',color:'var(--danger)'}}>-{fmtBgn(pnl?.other_cost)}</td></tr>
              <tr style={{borderTop:'3px double var(--border)',fontWeight:700}}>
                <td>Оперативна печалба</td>
                <td style={{textAlign:'right',color:pnl?.operating_profit>=0?'var(--success)':'var(--danger)'}}>{fmtBgn(pnl?.operating_profit)}</td>
              </tr>
              <tr><td>Брутен марж</td><td style={{textAlign:'right'}}>{fmtPct(pnl?.gross_margin_pct)}</td></tr>
              <tr><td>Оперативен марж</td><td style={{textAlign:'right'}}>{fmtPct(pnl?.operating_margin_pct)}</td></tr>
              <tr style={{borderTop:'1px solid var(--border)'}}><td>Продадени кг</td><td style={{textAlign:'right'}}>{pnl?.total_kg_sold ? Number(pnl.total_kg_sold).toLocaleString('bg-BG') + ' кг' : '-'}</td></tr>
              <tr><td>Продадени глави</td><td style={{textAlign:'right'}}>{pnl?.total_heads_sold || 0}</td></tr>
              <tr><td>Себестойност/кг</td><td style={{textAlign:'right'}}>{pnl?.cost_per_kg ? fmtBgn(pnl.cost_per_kg) : '-'}</td></tr>
            </tbody>
          </table>
        </div>

        {/* Financial KPIs */}
        <div className="card">
          <h3>Финансови KPI</h3>
          {kpis?.length > 0 ? (
            <table>
              <thead><tr><th>Показател</th><th>Стойност</th><th>Цел</th><th>Статус</th></tr></thead>
              <tbody>
                {kpis.map(k => (
                  <tr key={k.name}>
                    <td>{k.label}</td>
                    <td><strong>{k.value != null ? k.value : '-'}</strong> {k.unit}</td>
                    <td>{k.target != null ? `${k.lowerIsBetter ? '<' : '>'} ${k.target} ${k.unit}` : '-'}</td>
                    <td><span className={`badge ${k.color}`}>{k.color === 'green' ? 'OK' : k.color === 'yellow' ? 'Внимание' : k.color === 'red' ? 'Проблем' : '-'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{color:'var(--text-secondary)'}}>Няма данни за KPI за периода.</p>}
        </div>
      </div>

      {/* P&L by Sector */}
      {sector && sector.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Разбивка по сектор</h3>
          <table>
            <thead><tr><th>Сектор</th><th>Приходи</th><th>Фуражи</th><th>Заплати</th><th>Ветеринарни</th><th>Общо разход</th><th>Печалба</th></tr></thead>
            <tbody>
              {sector.map(s => (
                <tr key={s.sector_code}>
                  <td><strong>{s.sector_name}</strong></td>
                  <td style={{textAlign:'right'}}>{fmtBgn(s.revenue)}</td>
                  <td style={{textAlign:'right'}}>{fmtBgn(s.feed_cost)}</td>
                  <td style={{textAlign:'right'}}>{fmtBgn(s.salary_cost)}</td>
                  <td style={{textAlign:'right'}}>{fmtBgn(s.vet_cost)}</td>
                  <td style={{textAlign:'right'}}>{fmtBgn(s.total_cost)}</td>
                  <td style={{textAlign:'right',color:s.operating_profit>=0?'var(--success)':'var(--danger)',fontWeight:600}}>{fmtBgn(s.operating_profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Quick links */}
      <div className="grid grid-3" style={{ marginTop: 16 }}>
        <Link to="/sales" className="card" style={{ textDecoration: 'none', textAlign: 'center', color: 'var(--text)' }}>
          <h3>Продажби</h3>
          <p style={{color:'var(--text-secondary)',fontSize:13}}>Дневник на продажби</p>
        </Link>
        <Link to="/expenses" className="card" style={{ textDecoration: 'none', textAlign: 'center', color: 'var(--text)' }}>
          <h3>Разходи</h3>
          <p style={{color:'var(--text-secondary)',fontSize:13}}>Фуражи, заплати, ветеринарни</p>
        </Link>
        <Link to="/reports" className="card" style={{ textDecoration: 'none', textAlign: 'center', color: 'var(--text)' }}>
          <h3>Отчети</h3>
          <p style={{color:'var(--text-secondary)',fontSize:13}}>Големите 5 отчета</p>
        </Link>
      </div>
    </>
  )
}
