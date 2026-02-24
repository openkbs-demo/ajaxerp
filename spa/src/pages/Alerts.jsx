import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

function fmtDate(d) {
  if (!d) return '-'
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`
}

export default function Alerts() {
  const { user } = useAuth()
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAck, setShowAck] = useState(false)
  const [filter, setFilter] = useState('unacked')
  const [ackNote, setAckNote] = useState('')
  const [ackId, setAckId] = useState(null)

  const load = () => {
    setLoading(true)
    const params = filter === 'unacked' ? { acknowledged: false } : filter === 'acked' ? { acknowledged: true } : {}
    api('alerts.list', { ...params, limit: 100 })
      .then(r => setAlerts(r.alerts))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [filter])

  const acknowledge = async () => {
    if (!ackId) return
    try {
      await api('alerts.acknowledge', { id: ackId, acknowledged_by: user?.id, notes: ackNote })
      setShowAck(false)
      setAckNote('')
      setAckId(null)
      load()
    } catch (e) { alert(e.message) }
  }

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

      <div className="filters">
        <select value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="unacked">Непотвърдени</option>
          <option value="acked">Потвърдени</option>
          <option value="all">Всички</option>
        </select>
      </div>

      <div className="card">
        {loading ? <div className="loading">Зареждане...</div> : alerts.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 20 }}>
            {filter === 'unacked' ? 'Няма непотвърдени аларми.' : 'Няма аларми.'}
          </p>
        ) : (
          alerts.map(a => (
            <div key={a.id} className={`alert-item ${a.severity}`}>
              <div className="alert-msg">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                  <span className={`badge ${a.severity === 'critical' ? 'red' : a.severity === 'warning' ? 'yellow' : 'blue'}`}>
                    {a.severity === 'critical' ? 'КРИТИЧНА' : a.severity === 'warning' ? 'ПРЕДУПРЕЖДЕНИЕ' : 'ИНФО'}
                  </span>
                  <span className="badge grey">{a.category}</span>
                </div>
                <div>{a.message}</div>
                {a.is_acknowledged && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                    Потвърдена от: {a.acknowledged_by_name || `#${a.acknowledged_by}`} на {fmtDate(a.acknowledged_at)}
                    {a.acknowledge_notes && ` | Бележка: ${a.acknowledge_notes}`}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <div className="alert-time">{fmtDate(a.created_at)}</div>
                {!a.is_acknowledged && (
                  <button className="btn btn-sm btn-outline" onClick={() => { setAckId(a.id); setShowAck(true) }}>
                    Потвърди
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {showAck && (
        <div className="modal-overlay" onClick={() => setShowAck(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Потвърждаване на аларма</h2>
            <div className="form-group">
              <label>Бележка (по избор)</label>
              <textarea rows={3} value={ackNote} onChange={e => setAckNote(e.target.value)} placeholder="Предприети мерки..." />
            </div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setShowAck(false)}>Отказ</button>
              <button className="btn btn-primary" onClick={acknowledge}>Потвърди</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
