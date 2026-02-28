import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'

function fmtDate(d) {
  if (!d) return '-'
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`
}

const STATUS_BG = { new: 'Нова', in_progress: 'В обработка', closed: 'Приключена' }
const CAT_BG = { reproduction: 'Репродукция', culling: 'Бракуване', feed: 'Фуражи', mortality: 'Смъртност', biosecurity: 'Биосигурност', veterinary: 'Ветеринарен', inventory: 'Инвентар', logistics: 'Логистика', water: 'Вода' }

export default function Alerts() {
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState(null)
  const [newCount, setNewCount] = useState(0)

  // On mount: default to 'new' if there are new alerts, otherwise 'all'
  useEffect(() => {
    api('alerts.countNew').then(r => {
      const c = r.count || 0
      setNewCount(c)
      setFilter(c > 0 ? 'new' : 'all')
    }).catch(() => setFilter('all'))
  }, [])

  const load = () => {
    if (filter === null) return
    setLoading(true)
    const params = filter === 'all' ? {} : { status: filter }
    api('alerts.list', { ...params, limit: 100 })
      .then(r => setAlerts(r.alerts))
      .catch(console.error)
      .finally(() => setLoading(false))
    api('alerts.countNew').then(r => setNewCount(r.count || 0)).catch(() => {})
  }

  useEffect(() => { load() }, [filter])

  const recalcKPI = async () => {
    try {
      const res = await api('kpi.recalculate')
      alert(res.message)
      load()
    } catch (e) { alert(e.message) }
  }

  return (
    <>
      <div className="page-header">
        <h1>Система за аларми</h1>
        <button className="btn btn-outline" onClick={recalcKPI}>Преизчисли KPI</button>
      </div>

      <div className="tabs">
        <div className={`tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>Всички</div>
        <div className={`tab ${filter === 'new' ? 'active' : ''}`} onClick={() => setFilter('new')}>Нови{newCount > 0 && <span className="nav-badge" style={{ marginLeft: 6 }}>{newCount > 99 ? '99+' : newCount}</span>}</div>
        <div className={`tab ${filter === 'in_progress' ? 'active' : ''}`} onClick={() => setFilter('in_progress')}>В обработка</div>
        <div className={`tab ${filter === 'closed' ? 'active' : ''}`} onClick={() => setFilter('closed')}>Приключени</div>
      </div>

      <div className="card">
        {loading ? <div className="loading">Зареждане...</div> : alerts.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 20 }}>
            {filter === 'new' ? 'Няма нови аларми.' : 'Няма аларми.'}
          </p>
        ) : (
          alerts.map(a => {
            const link = a.related_entity_type === 'animal' ? `/animals/${a.related_entity_id}`
              : a.related_entity_type === 'animal_group' ? `/groups/${a.related_entity_id}`
              : a.related_entity_type === 'hall' ? `/halls/${a.related_entity_id}`
              : null
            const name = a.entity_name
            const renderMsg = () => {
              if (link && name && a.message.includes(name)) {
                const idx = a.message.indexOf(name)
                return <>{a.message.slice(0, idx)}<Link to={link} style={{ fontWeight: 700 }}>{name}</Link>{a.message.slice(idx + name.length)}</>
              }
              return a.message
            }
            return (
            <div key={a.id} className={`alert-item ${a.severity}`}>
              <div className="alert-msg">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                  <span className={`badge ${a.severity === 'critical' ? 'red' : a.severity === 'warning' ? 'yellow' : 'blue'}`}>
                    {a.severity === 'critical' ? 'КРИТИЧНА' : a.severity === 'warning' ? 'ПРЕДУПРЕЖДЕНИЕ' : 'ИНФО'}
                  </span>
                  <span className="badge grey">{CAT_BG[a.category] || a.category}</span>
                  <span className="badge grey">{STATUS_BG[a.status]}</span>
                </div>
                <div>{renderMsg()}</div>
                {a.status !== 'new' && a.acknowledged_by_name && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                    {a.acknowledged_by_name} — {fmtDate(a.acknowledged_at)}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <div className="alert-time">{fmtDate(a.created_at)}</div>
                <Link to={`/alerts/${a.id}`} className="btn btn-sm" style={{ background: 'var(--primary)', color: '#fff' }}>Детайли</Link>
              </div>
            </div>
          )})
        )}
      </div>
    </>
  )
}
