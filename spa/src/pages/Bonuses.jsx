import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

function fmtEur(v) { return v != null ? Number(v).toLocaleString('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €' : '-' }
function fmtDate(d) { if (!d) return '-'; const dt = new Date(d); return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}` }

const OP_BG = { lt: '<', gt: '>', lte: '≤', gte: '≥', eq: '=' }

export default function Bonuses() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [rules, setRules] = useState([])
  const [results, setResults] = useState([])
  const [summary, setSummary] = useState(null)
  const [section, setSection] = useState('rules')
  const [monthKey, setMonthKey] = useState(new Date().toISOString().substring(0, 7))
  const [calculating, setCalculating] = useState(false)
  const [editRule, setEditRule] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const [r, s] = await Promise.all([
        api('bonus.rules.list'),
        api('bonus.summary', { month_key: monthKey })
      ])
      setRules(r.rules || [])
      setSummary(s.summary || null)
      if (section === 'results') {
        const res = await api('bonus.results', { month_key: monthKey })
        setResults(res.calculations || [])
      }
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [section, monthKey])

  const calculate = async () => {
    setCalculating(true)
    try {
      await api('bonus.calculate', { month_key: monthKey })
      setSection('results')
      await load()
    } catch (e) { alert(e.message) }
    setCalculating(false)
  }

  const approve = async (id) => {
    try {
      await api('bonus.approve', { id, approved_by: user?.id })
      load()
    } catch (e) { alert(e.message) }
  }

  const approveAll = async () => {
    const calculated = results.filter(r => r.status === 'calculated')
    for (const c of calculated) {
      try { await api('bonus.approve', { id: c.id, approved_by: user?.id }) } catch {}
    }
    load()
  }

  const saveRule = async (e) => {
    e.preventDefault()
    try {
      await api('bonus.rules.upsert', editRule)
      setEditRule(null)
      load()
    } catch (e) { alert(e.message) }
  }

  if (loading) return <div className="loading">Зареждане...</div>

  return (
    <>
      <div className="page-header">
        <h1>KPI Бонуси</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="month" value={monthKey} onChange={e => setMonthKey(e.target.value)} style={{ padding: '6px 10px' }} />
          <button className="btn primary" onClick={calculate} disabled={calculating}>
            {calculating ? 'Изчисляване...' : 'Изчисли бонуси'}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-4" style={{ marginBottom: 16 }}>
          <div className="stat-card green">
            <div className="stat-value">{summary.totalCalculated || 0}</div>
            <div className="stat-label">Изчислени</div>
          </div>
          <div className="stat-card blue">
            <div className="stat-value">{summary.totalApproved || 0}</div>
            <div className="stat-label">Одобрени</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{summary.totalMet || 0}</div>
            <div className="stat-label">Достигнати цели</div>
          </div>
          <div className="stat-card green">
            <div className="stat-value" style={{ fontSize: 18 }}>{fmtEur(summary.totalBonusEur)}</div>
            <div className="stat-label">Общо бонуси</div>
          </div>
        </div>
      )}

      <div className="tabs" style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        {[['rules', 'Правила'], ['results', 'Резултати'], ['history', 'История']].map(([key, label]) => (
          <button key={key} className={`btn ${section === key ? 'primary' : ''}`} onClick={() => setSection(key)}>{label}</button>
        ))}
      </div>

      {/* RULES */}
      {section === 'rules' && (
        <div className="card">
          <h3>Бонус правила <button className="btn small" style={{ float: 'right' }} onClick={() => setEditRule({ kpi_name: '', target_value: '', operator: 'lt', bonus_pct: '', applies_to_sector_code: '' })}>+ Ново правило</button></h3>
          <table>
            <thead><tr><th>KPI</th><th>Условие</th><th>Бонус %</th><th>Сектор</th><th>Активно</th><th></th></tr></thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id}>
                  <td><strong>{r.kpi_label || r.kpi_name}</strong></td>
                  <td>{OP_BG[r.operator] || r.operator} {r.target_value}</td>
                  <td><span className="badge green">+{r.bonus_pct}%</span></td>
                  <td>{r.applies_to_sector_code || 'Всички'}</td>
                  <td>{r.is_active ? '✅' : '❌'}</td>
                  <td><button className="btn small" onClick={() => setEditRule({ ...r })}>Редакция</button></td>
                </tr>
              ))}
            </tbody>
          </table>

          {editRule && (
            <div className="modal-backdrop" onClick={() => setEditRule(null)}>
              <div className="modal" onClick={e => e.stopPropagation()}>
                <h3>{editRule.id ? 'Редакция на правило' : 'Ново правило'}</h3>
                <form onSubmit={saveRule}>
                  <div className="form-grid">
                    <div><label>KPI име</label><input required value={editRule.kpi_name} onChange={e => setEditRule({ ...editRule, kpi_name: e.target.value })} /></div>
                    <div><label>Описание</label><input value={editRule.kpi_label || ''} onChange={e => setEditRule({ ...editRule, kpi_label: e.target.value })} /></div>
                    <div><label>Оператор</label>
                      <select value={editRule.operator} onChange={e => setEditRule({ ...editRule, operator: e.target.value })}>
                        <option value="lt">&lt; (по-малко)</option><option value="gt">&gt; (по-голямо)</option>
                        <option value="lte">≤</option><option value="gte">≥</option>
                      </select>
                    </div>
                    <div><label>Целева стойност</label><input type="number" step="0.01" required value={editRule.target_value} onChange={e => setEditRule({ ...editRule, target_value: e.target.value })} /></div>
                    <div><label>Бонус %</label><input type="number" step="0.5" required value={editRule.bonus_pct} onChange={e => setEditRule({ ...editRule, bonus_pct: e.target.value })} /></div>
                    <div><label>Сектор</label>
                      <select value={editRule.applies_to_sector_code || ''} onChange={e => setEditRule({ ...editRule, applies_to_sector_code: e.target.value })}>
                        <option value="">Всички</option><option value="FAR">FAR (Родилно)</option>
                        <option value="NUR">NUR (Подрастващи)</option><option value="FIN">FIN (Угояване)</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" className="btn" onClick={() => setEditRule(null)}>Отказ</button>
                    <button type="submit" className="btn primary">Запази</button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* RESULTS */}
      {section === 'results' && (
        <div className="card">
          <h3>Резултати за {monthKey}
            {results.some(r => r.status === 'calculated') && (
              <button className="btn small primary" style={{ float: 'right' }} onClick={approveAll}>Одобри всички</button>
            )}
          </h3>
          <table>
            <thead><tr><th>Служител</th><th>KPI</th><th>Факт</th><th>Цел</th><th>Достигнато</th><th>Заплата</th><th>Бонус</th><th>Статус</th><th></th></tr></thead>
            <tbody>
              {results.map(r => (
                <tr key={r.id}>
                  <td><strong>{r.personnel_name}</strong></td>
                  <td>{r.kpi_label || r.kpi_name}</td>
                  <td>{r.kpi_actual_value != null ? Number(r.kpi_actual_value).toFixed(2) : '-'}</td>
                  <td>{Number(r.target_value).toFixed(2)}</td>
                  <td>{r.target_met ? <span className="badge green">Да</span> : <span className="badge red">Не</span>}</td>
                  <td>{fmtEur(r.base_salary_eur)}</td>
                  <td><strong>{r.target_met ? fmtEur(r.bonus_amount_eur) : '-'}</strong></td>
                  <td><span className={`badge ${r.status === 'approved' ? 'green' : 'yellow'}`}>{r.status === 'approved' ? 'Одобрен' : 'Изчислен'}</span></td>
                  <td>{r.status === 'calculated' && <button className="btn small" onClick={() => approve(r.id)}>Одобри</button>}</td>
                </tr>
              ))}
              {results.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Няма резултати. Натиснете "Изчисли бонуси".</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* HISTORY */}
      {section === 'history' && (
        <div className="card">
          <h3>История на бонусите</h3>
          <HistoryView />
        </div>
      )}
    </>
  )
}

function HistoryView() {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    api('bonus.history', { limit: 100 }).then(r => { setHistory(r.calculations || []); setLoading(false) }).catch(() => setLoading(false))
  }, [])
  if (loading) return <div className="loading">Зареждане...</div>
  const grouped = {}
  for (const h of history) { (grouped[h.month_key] = grouped[h.month_key] || []).push(h) }
  return Object.entries(grouped).sort((a, b) => b[0].localeCompare(a[0])).map(([month, items]) => (
    <div key={month} style={{ marginBottom: 16 }}>
      <h4>{month}</h4>
      <table>
        <thead><tr><th>Служител</th><th>KPI</th><th>Бонус</th><th>Статус</th></tr></thead>
        <tbody>
          {items.map(i => (
            <tr key={i.id}>
              <td>{i.personnel_name}</td>
              <td>{i.kpi_label || i.kpi_name}</td>
              <td>{i.target_met ? fmtEur(i.bonus_amount_eur) : '-'}</td>
              <td><span className={`badge ${i.status === 'approved' ? 'green' : 'yellow'}`}>{i.status === 'approved' ? 'Одобрен' : 'Изчислен'}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ))
}
