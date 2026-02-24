import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

const STATUS_BG = {
  awaiting_breeding: 'Очаква заплождане', inseminated: 'Осеменена', pregnant_confirmed: 'Бременна',
  in_farrowing: 'В родилно', lactating: 'Лактираща', weaned_resting: 'Почивка', culled: 'Бракувана', active: 'Активен'
}
const EVENT_BG = {
  insemination: 'Осеменяване', pregnancy_check_positive: 'Ехография (+)', pregnancy_check_negative: 'Ехография (-)',
  transfer_to_farrowing: 'Преместване в родилно', farrowing: 'Раждане', weaning: 'Отбиване',
  rest_complete: 'Край на почивка', culling: 'Бракуване', vaccination: 'Ваксинация',
  disease: 'Заболяване', treatment: 'Третиране', death: 'Смърт', transfer: 'Трансфер',
  cross_fostering: 'Кърмачка (Cross-fostering)'
}
const STATUS_FLOW = ['awaiting_breeding', 'inseminated', 'pregnant_confirmed', 'in_farrowing', 'lactating', 'weaned_resting']

function fmtDate(d) {
  if (!d) return '-'
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}`
}

export default function SowCard() {
  const { id } = useParams()
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('repro')
  const [showEvent, setShowEvent] = useState(false)
  const [eventForm, setEventForm] = useState({ event_type: 'insemination', details: {} })

  const load = async () => {
    setLoading(true)
    try {
      const res = await api('animals.card', { id: parseInt(id) })
      setData(res)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

  const recordEvent = async (e) => {
    e.preventDefault()
    try {
      const payload = {
        event_type: eventForm.event_type,
        animal_id: parseInt(id),
        performed_by: user?.id,
        details: eventForm.details
      }
      await api('events.record', payload)
      setShowEvent(false)
      setEventForm({ event_type: 'insemination', details: {} })
      load()
    } catch (err) { alert(err.message) }
  }

  if (loading) return <div className="loading">Зареждане...</div>
  if (!data) return <div className="loading">Животното не е намерено</div>

  const { animal, litters, nursedLitters, healthCard, reproductionSummary, cullingProposal, events } = data

  return (
    <>
      <div className="page-header">
        <div>
          <Link to="/animals" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>&larr; Към списъка</Link>
          <h1 style={{ marginTop: 4 }}>Картон: {animal.ear_tag || `#${animal.id}`}</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setShowEvent(true)}>+ Запиши събитие</button>
      </div>

      {/* Status flow */}
      <div className="card">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {STATUS_FLOW.map((s, i) => (
            <span key={s}>
              {i > 0 && <span style={{ color: 'var(--text-secondary)', margin: '0 2px' }}>&rarr;</span>}
              <span style={{
                padding: '4px 10px', borderRadius: 4, fontSize: 12, fontWeight: animal.status === s ? 700 : 400,
                background: animal.status === s ? 'var(--primary)' : '#f0f0f0',
                color: animal.status === s ? '#fff' : 'var(--text-secondary)'
              }}>{STATUS_BG[s]}</span>
            </span>
          ))}
          {animal.status === 'culled' && <span className="badge red" style={{ marginLeft: 8 }}>БРАКУВАНА</span>}
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="stat-card"><div className="stat-value">{animal.parity_number || 0}</div><div className="stat-label">Прасене №</div></div>
        <div className="stat-card"><div className="stat-value">{animal.breed || '-'}</div><div className="stat-label">Порода</div></div>
        <div className="stat-card"><div className="stat-value">{fmtDate(animal.date_of_birth)}</div><div className="stat-label">Дата раждане</div></div>
        <div className="stat-card"><div className="stat-value">{animal.hall_name || '-'}</div><div className="stat-label">Хале / Сектор</div></div>
      </div>

      {/* Culling proposal */}
      {cullingProposal?.shouldCull && (
        <div className="alert-item critical" style={{ marginBottom: 16 }}>
          <div className="alert-msg">
            <strong>Предложение за бракуване:</strong> {cullingProposal.reasons.join('; ')}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        <div className={`tab ${tab === 'repro' ? 'active' : ''}`} onClick={() => setTab('repro')}>Репродукция</div>
        <div className={`tab ${tab === 'health' ? 'active' : ''}`} onClick={() => setTab('health')}>Здравен картон</div>
        <div className={`tab ${tab === 'events' ? 'active' : ''}`} onClick={() => setTab('events')}>Всички събития</div>
        <div className={`tab ${tab === 'nursing' ? 'active' : ''}`} onClick={() => setTab('nursing')}>Кърмене</div>
      </div>

      {/* Reproduction tab */}
      {tab === 'repro' && (
        <div className="card">
          <h3>Репродуктивна история</h3>
          {reproductionSummary?.length > 0 ? (
            <table>
              <thead><tr><th>Прасене</th><th>Дата раждане</th><th>Живородени</th><th>Мъртвородени</th><th>Отбити</th><th>Тегло отбиване</th><th>Дата отбиване</th><th>Кърмачка</th></tr></thead>
              <tbody>
                {reproductionSummary.map((r, i) => (
                  <tr key={i}>
                    <td><strong>{r.parity}</strong></td>
                    <td>{fmtDate(r.birthDate)}</td>
                    <td>{r.bornAlive}</td>
                    <td>{r.stillborn || 0}</td>
                    <td>{r.weanedCount ?? '-'}</td>
                    <td>{r.weaningWeight ? `${r.weaningWeight} кг` : '-'}</td>
                    <td>{fmtDate(r.weaningDate)}</td>
                    <td>{r.nurseEarTag || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ color: 'var(--text-secondary)' }}>Няма репродуктивна история</p>}
        </div>
      )}

      {/* Health tab */}
      {tab === 'health' && (
        <div className="card">
          <h3>Здравен картон</h3>
          {healthCard?.length > 0 ? (
            <table>
              <thead><tr><th>Тип</th><th>Дата</th><th>Детайли</th><th>Извършил</th></tr></thead>
              <tbody>
                {healthCard.map(h => (
                  <tr key={h.id}>
                    <td><span className={`badge ${h.event_type === 'disease' ? 'red' : h.event_type === 'treatment' ? 'yellow' : 'green'}`}>{EVENT_BG[h.event_type] || h.event_type}</span></td>
                    <td>{fmtDate(h.event_date)}</td>
                    <td style={{ fontSize: 12 }}>{h.details ? Object.entries(h.details).map(([k,v]) => `${k}: ${v}`).join(', ') : '-'}</td>
                    <td>{h.performed_by_name || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ color: 'var(--text-secondary)' }}>Няма здравни записи</p>}
        </div>
      )}

      {/* Events tab */}
      {tab === 'events' && (
        <div className="card">
          <h3>Всички събития ({events?.length || 0})</h3>
          <table>
            <thead><tr><th>Тип</th><th>Дата</th><th>Хале</th><th>Извършил</th><th>Детайли</th></tr></thead>
            <tbody>
              {events?.map(ev => (
                <tr key={ev.id}>
                  <td><span className="badge blue">{EVENT_BG[ev.event_type] || ev.event_type}</span></td>
                  <td>{fmtDate(ev.event_date)}</td>
                  <td>{ev.hall_id || '-'}</td>
                  <td>{ev.performed_by_name || '-'}</td>
                  <td style={{ fontSize: 12 }}>{ev.details ? Object.entries(ev.details).map(([k,v]) => `${k}: ${v}`).join(', ') : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Nursing tab */}
      {tab === 'nursing' && (
        <div className="card">
          <h3>Изхранени от тази свиня (като кърмачка)</h3>
          {nursedLitters?.length > 0 ? (
            <table>
              <thead><tr><th>Биологична майка</th><th>Дата раждане</th><th>Живородени</th></tr></thead>
              <tbody>
                {nursedLitters.map(l => (
                  <tr key={l.id}>
                    <td><Link to={`/animals/${l.birth_sow_id}`}>{l.birth_sow_ear_tag || `#${l.birth_sow_id}`}</Link></td>
                    <td>{fmtDate(l.birth_date)}</td>
                    <td>{l.born_alive}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ color: 'var(--text-secondary)' }}>Не е била кърмачка</p>}
        </div>
      )}

      {/* Record event modal */}
      {showEvent && (
        <div className="modal-overlay" onClick={() => setShowEvent(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Записване на събитие</h2>
            <form onSubmit={recordEvent}>
              <div className="form-group">
                <label>Тип събитие</label>
                <select value={eventForm.event_type} onChange={e => setEventForm({ event_type: e.target.value, details: {} })}>
                  <option value="insemination">Осеменяване</option>
                  <option value="pregnancy_check_positive">Ехография (+)</option>
                  <option value="pregnancy_check_negative">Ехография (-)</option>
                  <option value="transfer_to_farrowing">Преместване в родилно</option>
                  <option value="farrowing">Раждане</option>
                  <option value="weaning">Отбиване</option>
                  <option value="vaccination">Ваксинация</option>
                  <option value="disease">Заболяване</option>
                  <option value="treatment">Третиране</option>
                  <option value="culling">Бракуване</option>
                </select>
              </div>

              {eventForm.event_type === 'insemination' && (
                <div className="form-row">
                  <div className="form-group">
                    <label>Партида семе</label>
                    <input value={eventForm.details.semen_batch || ''} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, semen_batch: e.target.value } }))} />
                  </div>
                  <div className="form-group">
                    <label>Метод</label>
                    <select value={eventForm.details.method || 'AI'} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, method: e.target.value } }))}>
                      <option value="AI">Изкуствено осеменяване</option>
                      <option value="natural">Естествено</option>
                    </select>
                  </div>
                </div>
              )}

              {eventForm.event_type === 'farrowing' && (
                <div className="form-row">
                  <div className="form-group">
                    <label>Живородени</label>
                    <input type="number" min="0" value={eventForm.details.born_alive || ''} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, born_alive: parseInt(e.target.value) || 0 } }))} required />
                  </div>
                  <div className="form-group">
                    <label>Мъртвородени</label>
                    <input type="number" min="0" value={eventForm.details.stillborn || ''} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, stillborn: parseInt(e.target.value) || 0 } }))} />
                  </div>
                  <div className="form-group">
                    <label>Мумифицирани</label>
                    <input type="number" min="0" value={eventForm.details.mummified || ''} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, mummified: parseInt(e.target.value) || 0 } }))} />
                  </div>
                </div>
              )}

              {eventForm.event_type === 'weaning' && (
                <div className="form-row">
                  <div className="form-group">
                    <label>Брой отбити</label>
                    <input type="number" min="0" value={eventForm.details.weaned_count || ''} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, weaned_count: parseInt(e.target.value) || 0 } }))} required />
                  </div>
                  <div className="form-group">
                    <label>Тегло на гнездото (кг)</label>
                    <input type="number" step="0.1" min="0" value={eventForm.details.weaning_weight_kg || ''} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, weaning_weight_kg: parseFloat(e.target.value) || 0 } }))} />
                  </div>
                </div>
              )}

              {eventForm.event_type === 'vaccination' && (
                <div className="form-row">
                  <div className="form-group">
                    <label>Ваксина</label>
                    <input value={eventForm.details.vaccine_name || ''} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, vaccine_name: e.target.value } }))} required />
                  </div>
                  <div className="form-group">
                    <label>Доза (мл)</label>
                    <input type="number" step="0.1" value={eventForm.details.dose_ml || ''} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, dose_ml: parseFloat(e.target.value) || 0 } }))} />
                  </div>
                </div>
              )}

              {eventForm.event_type === 'culling' && (
                <div className="form-row">
                  <div className="form-group">
                    <label>Причина</label>
                    <select value={eventForm.details.reason || ''} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, reason: e.target.value } }))} required>
                      <option value="">-- Изберете --</option>
                      <option value="low_productivity">Ниска продуктивност</option>
                      <option value="reproductive_failure">Репродуктивен провал</option>
                      <option value="age">Възраст</option>
                      <option value="health">Здравословен проблем</option>
                      <option value="other">Друго</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Тегло (кг)</label>
                    <input type="number" step="0.1" value={eventForm.details.weight_kg || ''} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, weight_kg: parseFloat(e.target.value) || 0 } }))} />
                  </div>
                </div>
              )}

              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowEvent(false)}>Отказ</button>
                <button type="submit" className="btn btn-primary">Запиши</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
