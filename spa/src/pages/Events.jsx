import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'

const EVENT_BG = {
  insemination: 'Осеменяване', pregnancy_check_positive: 'Ехография (+)', pregnancy_check_negative: 'Ехография (-)',
  transfer_to_farrowing: 'Преместване в родилно', farrowing: 'Раждане', weaning: 'Отбиване',
  rest_complete: 'Край на почивка', culling: 'Бракуване', vaccination: 'Ваксинация',
  disease: 'Заболяване', treatment: 'Третиране', death: 'Смърт', transfer: 'Трансфер',
  cross_fostering: 'Кърмачка', group_death: 'Смъртност (група)', group_sale: 'Продажба (група)'
}

function fmtDate(d) {
  if (!d) return '-'
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}`
}

export default function Events() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    api('events.list', { event_type: filter || undefined, limit: 100 })
      .then(r => setEvents(r.events))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [filter])

  return (
    <>
      <div className="page-header">
        <h1>Дневник на събитията</h1>
      </div>

      <div className="filters">
        <select value={filter} onChange={e => { setFilter(e.target.value); setLoading(true) }}>
          <option value="">Всички типове</option>
          {Object.entries(EVENT_BG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="card">
        {loading ? <div className="loading">Зареждане...</div> : (
          <table>
            <thead><tr><th>Тип</th><th>Животно</th><th>Дата</th><th>Извършил</th><th>Детайли</th></tr></thead>
            <tbody>
              {events.map(ev => (
                <tr key={ev.id}>
                  <td><span className="badge blue">{EVENT_BG[ev.event_type] || ev.event_type}</span></td>
                  <td>
                    {ev.animal_ear_tag ? (
                      <Link to={`/animals/${ev.animal_id}`}>{ev.animal_ear_tag}</Link>
                    ) : ev.animal_id ? (
                      <Link to={`/animals/${ev.animal_id}`}>#{ev.animal_id}</Link>
                    ) : ev.group_id ? `Група #${ev.group_id}` : '-'}
                  </td>
                  <td>{fmtDate(ev.event_date)}</td>
                  <td>{ev.performed_by_name || '-'}</td>
                  <td style={{ fontSize: 12, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {ev.details ? Object.entries(ev.details).map(([k,v]) => `${k}: ${v}`).join(', ') : '-'}
                  </td>
                </tr>
              ))}
              {events.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Няма събития</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
