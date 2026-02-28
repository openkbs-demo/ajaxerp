import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

function fmtDate(d) {
  if (!d) return '-'
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`
}

const STATUS_BG = { new: 'Нова', in_progress: 'В обработка', closed: 'Приключена' }
const STATUS_BADGE = { new: 'red', in_progress: 'yellow', closed: 'green' }
const SEV_BG = { critical: 'КРИТИЧНА', warning: 'ПРЕДУПРЕЖДЕНИЕ', info: 'ИНФО' }
const SEV_BADGE = { critical: 'red', warning: 'yellow', info: 'blue' }

export default function AlertCard() {
  const { id } = useParams()
  const { user } = useAuth()
  const [alert, setAlert] = useState(null)
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [noteText, setNoteText] = useState('')
  const [statusNote, setStatusNote] = useState('')
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [targetStatus, setTargetStatus] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await api('alerts.get', { id: parseInt(id) })
      setAlert(res.alert)
      setNotes(res.notes || [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

  const changeStatus = async () => {
    try {
      await api('alerts.updateStatus', { id: parseInt(id), status: targetStatus, user_id: user?.id, notes: statusNote || undefined })
      setShowStatusModal(false)
      setStatusNote('')
      setTargetStatus(null)
      load()
    } catch (e) { window.alert(e.message) }
  }

  const addNote = async (e) => {
    e.preventDefault()
    if (!noteText.trim()) return
    try {
      await api('alerts.addNote', { alert_id: parseInt(id), user_id: user?.id, note: noteText })
      setNoteText('')
      load()
    } catch (e) { window.alert(e.message) }
  }

  if (loading) return <div className="loading">Зареждане...</div>
  if (!alert) return <div className="loading">Алармата не е намерена</div>

  const entityLink = alert.related_entity_type === 'animal' ? `/animals/${alert.related_entity_id}`
    : alert.related_entity_type === 'animal_group' ? `/groups/${alert.related_entity_id}`
    : alert.related_entity_type === 'hall' ? `/halls/${alert.related_entity_id}`
    : null

  const renderMsg = () => {
    const name = alert.entity_name
    if (entityLink && name && alert.message.includes(name)) {
      const idx = alert.message.indexOf(name)
      return <>{alert.message.slice(0, idx)}<Link to={entityLink} style={{ fontWeight: 700 }}>{name}</Link>{alert.message.slice(idx + name.length)}</>
    }
    return alert.message
  }

  const openStatusChange = (s) => { setTargetStatus(s); setStatusNote(''); setShowStatusModal(true) }

  return (
    <>
      <div className="page-header">
        <div>
          <Link to="/alerts" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>&larr; Към аларми</Link>
          <h1 style={{ margin: '4px 0 0' }}>Аларма #{alert.id}</h1>
        </div>
      </div>

      {/* Alert info card */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <span className={`badge ${SEV_BADGE[alert.severity]}`}>{SEV_BG[alert.severity]}</span>
          <span className="badge grey">{alert.category}</span>
          <span className={`badge ${STATUS_BADGE[alert.status]}`}>{STATUS_BG[alert.status]}</span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 'auto' }}>{fmtDate(alert.created_at)}</span>
        </div>
        <div style={{ fontSize: 16, lineHeight: 1.5, marginBottom: 16 }}>{renderMsg()}</div>

        {/* Status action buttons */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {alert.status === 'new' && (
            <>
              <button className="btn btn-primary btn-sm" onClick={() => openStatusChange('in_progress')}>Маркирай в обработка</button>
              <button className="btn btn-outline btn-sm" onClick={() => openStatusChange('closed')}>Приключи</button>
            </>
          )}
          {alert.status === 'in_progress' && (
            <>
              <button className="btn btn-primary btn-sm" onClick={() => openStatusChange('closed')}>Приключи</button>
              <button className="btn btn-outline btn-sm" onClick={() => openStatusChange('new')}>Върни като нова</button>
            </>
          )}
          {alert.status === 'closed' && (
            <button className="btn btn-outline btn-sm" onClick={() => openStatusChange('new')}>Отвори отново</button>
          )}
        </div>
      </div>

      {/* Details grid */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Детайли</h3>
        <div className="grid grid-4">
          <div><small>Тежест</small><div>{SEV_BG[alert.severity]}</div></div>
          <div><small>Категория</small><div>{alert.category}</div></div>
          <div><small>Статус</small><div><span className={`badge ${STATUS_BADGE[alert.status]}`}>{STATUS_BG[alert.status]}</span></div></div>
          <div><small>Създадена</small><div>{fmtDate(alert.created_at)}</div></div>
          {alert.related_entity_type && (
            <div><small>Обект</small><div>{entityLink ? <Link to={entityLink}>{alert.entity_name || `${alert.related_entity_type} #${alert.related_entity_id}`}</Link> : `${alert.related_entity_type} #${alert.related_entity_id}`}</div></div>
          )}
          {alert.acknowledged_by_name && (
            <div><small>Последна промяна от</small><div>{alert.acknowledged_by_name}</div></div>
          )}
          {alert.acknowledged_at && (
            <div><small>Последна промяна на</small><div>{fmtDate(alert.acknowledged_at)}</div></div>
          )}
        </div>
      </div>

      {/* Notes log */}
      <div className="card">
        <h3>Дневник ({notes.length})</h3>
        {notes.length > 0 ? (
          <div style={{ marginBottom: 16 }}>
            {notes.map(n => (
              <div key={n.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <strong style={{ fontSize: 13 }}>{n.author_name || 'Система'}</strong>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{fmtDate(n.created_at)}</span>
                  {n.status_change && <span className={`badge ${STATUS_BADGE[n.status_change]}`} style={{ fontSize: 10 }}>{STATUS_BG[n.status_change]}</span>}
                </div>
                <div style={{ fontSize: 14 }}>{n.note}</div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>Няма бележки все още.</p>
        )}

        {/* Add note form */}
        <form onSubmit={addNote} style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ flex: 1 }}
            placeholder="Добави бележка..."
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-sm">Добави</button>
        </form>
      </div>

      {/* Status change modal */}
      {showStatusModal && (
        <div className="modal-overlay" onClick={() => setShowStatusModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Промяна на статус → {STATUS_BG[targetStatus]}</h2>
            <div className="form-group">
              <label>Бележка (по избор)</label>
              <textarea rows={3} value={statusNote} onChange={e => setStatusNote(e.target.value)} placeholder="Предприети мерки..." />
            </div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setShowStatusModal(false)}>Отказ</button>
              <button className="btn btn-primary" onClick={changeStatus}>{STATUS_BG[targetStatus]}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
