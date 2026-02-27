import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api.js'

const ZONE_BG = { black: 'Черна', grey: 'Сива', white: 'Бяла' }
const ZONE_BADGE = { black: 'grey', grey: 'yellow', white: 'green' }
const STATUS_BG = {
  awaiting_breeding: 'Очаква заплождане', inseminated: 'Осеменена', pregnant_confirmed: 'Бременна',
  in_farrowing: 'В родилно', lactating: 'Лактираща', weaned_resting: 'Почивка', culled: 'Бракувана', active: 'Активен'
}

function fmtDate(d) {
  if (!d) return '-'
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}`
}

export default function HallCard() {
  const { id } = useParams()
  const [hall, setHall] = useState(null)
  const [animals, setAnimals] = useState([])
  const [groups, setGroups] = useState([])
  const [tab, setTab] = useState('animals')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [hRes, aRes, gRes] = await Promise.all([
          api('halls.list'),
          api('animals.list', { hall_id: parseInt(id), limit: 500 }),
          api('groups.list', { hall_id: parseInt(id), active_only: true })
        ])
        const h = (hRes.halls || []).find(h => h.id === parseInt(id))
        setHall(h || null)
        setAnimals(aRes.animals || [])
        setGroups(gRes.groups || [])
      } catch (e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [id])

  if (loading) return <div className="loading">Зареждане...</div>
  if (!hall) return <div className="loading">Халето не е намерено</div>

  const pct = hall.capacity > 0 ? Math.round((hall.current_occupancy || 0) / hall.capacity * 100) : 0

  return (
    <>
      <div className="page-header">
        <div>
          <Link to="/halls" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>&larr; Към халетата</Link>
          <h1 style={{ marginTop: 4 }}>{hall.name}</h1>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="stat-card"><div className="stat-value">{hall.sector_name}</div><div className="stat-label">Сектор</div></div>
        <div className="stat-card"><div className="stat-value"><span className={`badge ${ZONE_BADGE[hall.biosecurity_zone]}`}>{ZONE_BG[hall.biosecurity_zone]}</span></div><div className="stat-label">Биосигурност</div></div>
        <div className="stat-card">
          <div className="stat-value">{hall.current_occupancy || 0} / {hall.capacity}</div>
          <div className="stat-label">Запълване ({pct}%)</div>
          <div style={{ background: '#eee', borderRadius: 4, height: 6, marginTop: 6 }}>
            <div style={{ background: pct > 90 ? 'var(--danger)' : pct > 70 ? 'var(--warning)' : 'var(--success)', borderRadius: 4, height: 6, width: `${Math.min(pct, 100)}%` }} />
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{hall.target_temp_min && hall.target_temp_max ? `${hall.target_temp_min}–${hall.target_temp_max}°C` : '-'}</div>
          <div className="stat-label">Целева темп.</div>
        </div>
      </div>

      <div className="tabs">
        <div className={`tab ${tab === 'animals' ? 'active' : ''}`} onClick={() => setTab('animals')}>Животни ({animals.length})</div>
        <div className={`tab ${tab === 'groups' ? 'active' : ''}`} onClick={() => setTab('groups')}>Партиди ({groups.length})</div>
      </div>

      {tab === 'animals' && (
        <div className="card">
          {animals.length > 0 ? (
            <table>
              <thead><tr><th>Ушна марка</th><th>Категория</th><th>Порода</th><th>Статус</th><th>Прасене №</th></tr></thead>
              <tbody>
                {animals.map(a => (
                  <tr key={a.id}>
                    <td><Link to={`/animals/${a.id}`}><strong>{a.ear_tag || `#${a.id}`}</strong></Link></td>
                    <td>{a.category}</td>
                    <td>{a.breed || '-'}</td>
                    <td><span className={`badge ${a.status === 'culled' ? 'red' : 'green'}`}>{STATUS_BG[a.status] || a.status}</span></td>
                    <td>{a.parity_number || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ color: 'var(--text-secondary)', padding: 20, textAlign: 'center' }}>Няма животни в това хале.</p>}
        </div>
      )}

      {tab === 'groups' && (
        <div className="card">
          {groups.length > 0 ? (
            <table>
              <thead><tr><th>Име</th><th>Категория</th><th>Бройки</th><th>Ср. тегло</th><th>Дата вход</th></tr></thead>
              <tbody>
                {groups.map(g => (
                  <tr key={g.id}>
                    <td><Link to={`/groups/${g.id}`}><strong>{g.group_name}</strong></Link></td>
                    <td>{g.category}</td>
                    <td>{g.current_count}</td>
                    <td>{g.current_weight_avg_kg ? `${g.current_weight_avg_kg} кг` : '-'}</td>
                    <td>{fmtDate(g.entry_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ color: 'var(--text-secondary)', padding: 20, textAlign: 'center' }}>Няма активни партиди в това хале.</p>}
        </div>
      )}
    </>
  )
}
