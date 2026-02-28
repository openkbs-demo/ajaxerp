import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

function fmtDate(d) { if (!d) return '-'; const dt = new Date(d); return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}` }
function fmtKg(v) { return v != null ? `${Number(v).toLocaleString('bg-BG')} кг` : '-' }

const EVENT_TYPE_BG = {
  group_transfer: 'Трансфер', weighing: 'Претегляне', group_death: 'Смъртност',
  vaccination: 'Ваксинация', treatment: 'Лечение', group_sale: 'Продажба'
}

export default function GroupCard() {
  const { id } = useParams()
  const { user } = useAuth()
  const [group, setGroup] = useState(null)
  const [loading, setLoading] = useState(true)
  const [transferHistory, setTransferHistory] = useState([])
  const [genetics, setGenetics] = useState([])
  const [halls, setHalls] = useState([])
  const [events, setEvents] = useState([])
  const [medicines, setMedicines] = useState([])
  const [withdrawals, setWithdrawals] = useState([])
  const [showEvent, setShowEvent] = useState(false)
  const [eventForm, setEventForm] = useState({ event_type: 'group_transfer', details: {} })
  const [tab, setTab] = useState('info')

  const gid = parseInt(id)

  const load = async () => {
    setLoading(true)
    try {
      const safe = (p) => p.catch(() => ({}))
      const [gRes, thRes, hRes, evRes, medRes, wdRes] = await Promise.all([
        api('groups.list'),
        safe(api('groups.transferHistory', { group_id: gid })),
        api('halls.list'),
        safe(api('events.list', { group_id: gid, limit: 50 })),
        safe(api('medicine.list')),
        safe(api('withdrawals.listByGroup', { group_id: gid }))
      ])
      const g = (gRes.groups || []).find(g => g.id === gid)
      setGroup(g || null)
      setTransferHistory(thRes.transfers || [])
      setHalls(hRes.halls || [])
      setEvents(evRes.events || [])
      setMedicines(medRes.medicines || [])
      setWithdrawals(wdRes.withdrawals || [])

      if (g?.source_litter_ids) {
        const litIds = typeof g.source_litter_ids === 'string' ? JSON.parse(g.source_litter_ids) : g.source_litter_ids
        if (litIds.length > 0) {
          const litRes = await api('litters.list', { weaned_only: false, limit: 100 })
          setGenetics((litRes.litters || []).filter(l => litIds.includes(l.id)))
        }
      }
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

  const recordEvent = async (e) => {
    e.preventDefault()
    const { event_type, details } = eventForm
    try {
      if (event_type === 'group_transfer') {
        await api('groups.transfer', {
          group_id: gid,
          to_hall_id: parseInt(details.to_hall_id),
          transfer_date: details.date || undefined,
          weight_avg_kg: details.weight_avg_kg ? parseFloat(details.weight_avg_kg) : undefined,
          head_count: details.head_count ? parseInt(details.head_count) : undefined,
          performed_by: user?.id,
          notes: details.notes
        })
      } else {
        await api('events.record', {
          event_type, group_id: gid, performed_by: user?.id,
          event_date: details.date || undefined,
          details
        })
      }
      setShowEvent(false)
      setEventForm({ event_type: 'group_transfer', details: {} })
      load()
    } catch (err) { alert(err.message) }
  }

  if (loading) return <div className="loading">Зареждане...</div>
  if (!group) return <div className="loading">Групата не е намерена</div>

  const isReady = group.category === 'finisher' && !group.exit_date && parseFloat(group.current_weight_avg_kg) >= 122
  const status = group.exit_date ? 'Изпратена' : isReady ? 'Готова' : 'Активна'
  const statusColor = group.exit_date ? 'grey' : isReady ? 'blue' : 'green'
  const litIds = group.source_litter_ids ? (typeof group.source_litter_ids === 'string' ? JSON.parse(group.source_litter_ids) : group.source_litter_ids) : []
  const activeWd = withdrawals.filter(w => w.status === 'active')

  return (
    <>
      <div className="page-header">
        <div>
          <Link to="/groups" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>&larr; Към списъка</Link>
          <h1 style={{ margin: '4px 0 0' }}>{group.group_name} <span className={`badge ${statusColor}`}>{status}</span></h1>
        </div>
        {!group.exit_date && (
          <button className="btn btn-primary" onClick={() => { setShowEvent(true); setEventForm({ event_type: 'group_transfer', details: { head_count: group.current_count } }) }}>+ Запиши събитие</button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <div className="stat-value">{group.category === 'weaner' ? 'Подрастване' : 'Угояване'}</div>
          <div className="stat-label">Категория</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-value">{group.current_count}</div>
          <div className="stat-label">Текущ брой (от {group.entry_count})</div>
        </div>
        <div className="stat-card green">
          <div className="stat-value">{fmtKg(group.current_weight_avg_kg)}</div>
          <div className="stat-label">Текущо тегло (ср.)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{group.hall_name || '-'}</div>
          <div className="stat-label">Хале</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <div className={`tab ${tab === 'info' ? 'active' : ''}`} onClick={() => setTab('info')}>Информация</div>
        <div className={`tab ${tab === 'transfers' ? 'active' : ''}`} onClick={() => setTab('transfers')}>Трансфери</div>
        <div className={`tab ${tab === 'journal' ? 'active' : ''}`} onClick={() => setTab('journal')}>Дневник</div>
      </div>

      {/* ═══ TAB: INFO ═══ */}
      {tab === 'info' && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3>Основна информация</h3>
            <div className="grid grid-4">
              <div><small>Група</small><div><strong>{group.group_name}</strong></div></div>
              <div><small>Категория</small><div>{group.category === 'weaner' ? 'Подрастване' : 'Угояване'}</div></div>
              <div><small>Хале</small><div>{group.hall_name || '-'}</div></div>
              <div><small>Статус</small><div><span className={`badge ${statusColor}`}>{status}</span></div></div>
              <div><small>Дата на вход</small><div>{fmtDate(group.entry_date)}</div></div>
              <div><small>Цел за клане</small><div>{fmtDate(group.target_slaughter_date)}</div></div>
              <div><small>Бройка вход</small><div>{group.entry_count}</div></div>
              <div><small>Текущ брой</small><div>{group.current_count}</div></div>
              <div><small>Тегло вход (ср.)</small><div>{fmtKg(group.entry_weight_avg_kg)}</div></div>
              <div><small>Текущо тегло (ср.)</small><div>{fmtKg(group.current_weight_avg_kg)}</div></div>
              {group.exit_date && <div><small>Дата на изход</small><div>{fmtDate(group.exit_date)}</div></div>}
              {group.exit_weight_avg_kg && <div><small>Тегло изход (ср.)</small><div>{fmtKg(group.exit_weight_avg_kg)}</div></div>}
            </div>
          </div>

          {/* Genetics / Source litters */}
          <div className="card" style={{ marginBottom: 16 }}>
            <h3>Произход (Генетика)</h3>
            {genetics.length > 0 ? (
              <table>
                <thead><tr><th>Люпило #</th><th>Майка</th><th>Кърмачка</th><th>Паритет</th><th>Родени живи</th><th>Отбити</th><th>Тегло отб.</th><th>Дата отб.</th></tr></thead>
                <tbody>
                  {genetics.map(l => (
                    <tr key={l.id}>
                      <td>#{l.id}</td>
                      <td><Link to={`/animals/${l.birth_sow_id}`}><strong>{l.sow_ear_tag}</strong></Link></td>
                      <td>{l.nurse_sow_id ? <Link to={`/animals/${l.nurse_sow_id}`}><strong>{l.nurse_ear_tag}</strong></Link> : '-'}</td>
                      <td>{l.parity_number}</td>
                      <td>{l.born_alive}</td>
                      <td>{l.weaned_count || '-'}</td>
                      <td>{l.weaning_weight_kg ? fmtKg(l.weaning_weight_kg) : '-'}</td>
                      <td>{fmtDate(l.weaning_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : litIds.length > 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Litter IDs: {litIds.join(', ')}</p>
            ) : (
              <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Няма данни за произход</p>
            )}
          </div>

          {/* Active withdrawals */}
          {activeWd.length > 0 && (
            <div className="card" style={{ borderLeft: '4px solid var(--danger)' }}>
              <h3>Карентни срокове</h3>
              <table>
                <thead><tr><th>Медикамент</th><th>Начало</th><th>Край</th><th>Оставащи дни</th><th>Статус</th></tr></thead>
                <tbody>
                  {activeWd.map((w, i) => {
                    const daysLeft = Math.max(0, Math.ceil((new Date(w.end_date) - new Date()) / 86400000))
                    return (
                      <tr key={i}>
                        <td>{w.medicine_name}</td>
                        <td>{fmtDate(w.start_date)}</td>
                        <td>{fmtDate(w.end_date)}</td>
                        <td><strong>{daysLeft}</strong></td>
                        <td><span className="badge red">Активен</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ═══ TAB: TRANSFERS ═══ */}
      {tab === 'transfers' && (
        <div className="card">
          <h3>История на трансфери</h3>
          {transferHistory.length > 0 ? (
            <table>
              <thead><tr><th>Дата</th><th>От хале</th><th>Към хале</th><th>Тегло (ср.)</th><th>Бройка</th><th>Бележки</th><th>Извършил</th></tr></thead>
              <tbody>{transferHistory.map((t, i) => {
                const d = typeof t.details === 'string' ? JSON.parse(t.details) : (t.details || {})
                return (
                  <tr key={i}>
                    <td>{fmtDate(t.event_date)}</td>
                    <td>{t.from_hall_name || '-'}</td>
                    <td>{t.to_hall_name || '-'}</td>
                    <td>{d.weight_avg_kg ? fmtKg(d.weight_avg_kg) : '-'}</td>
                    <td>{d.head_count || '-'}</td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.notes || '-'}</td>
                    <td>{t.performed_by_name || '-'}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          ) : <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Няма записи за трансфери</p>}
        </div>
      )}

      {/* ═══ TAB: JOURNAL ═══ */}
      {tab === 'journal' && (
        <div className="card">
          <h3>Дневник на събития</h3>
          {events.length > 0 ? (
            <table>
              <thead><tr><th>Дата</th><th>Тип</th><th>Детайли</th><th>Извършил</th></tr></thead>
              <tbody>{events.map((ev, i) => {
                const d = typeof ev.details === 'string' ? JSON.parse(ev.details) : (ev.details || {})
                const detailParts = []
                if (d.weight_avg_kg) detailParts.push(`${d.weight_avg_kg} кг`)
                if (d.head_count) detailParts.push(`${d.head_count} гл.`)
                if (d.count) detailParts.push(`${d.count} бр.`)
                if (d.reason) detailParts.push(d.reason)
                if (d.medicine_name) detailParts.push(d.medicine_name)
                if (d.dose) detailParts.push(`${d.dose} мл`)
                if (d.diagnosis) detailParts.push(d.diagnosis)
                if (d.notes) detailParts.push(d.notes)
                return (
                  <tr key={i}>
                    <td>{fmtDate(ev.event_date)}</td>
                    <td><span className="badge">{EVENT_TYPE_BG[ev.event_type] || ev.event_type}</span></td>
                    <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{detailParts.join(' | ') || '-'}</td>
                    <td>{ev.performed_by_name || '-'}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          ) : <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Няма записи</p>}
        </div>
      )}

      {/* ═══ EVENT MODAL ═══ */}
      {showEvent && (
        <div className="modal-overlay" onClick={() => setShowEvent(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Записване на събитие</h2>
            <form onSubmit={recordEvent}>
              <div className="form-group">
                <label>Тип събитие</label>
                <select value={eventForm.event_type} onChange={e => setEventForm({ event_type: e.target.value, details: e.target.value === 'group_transfer' ? { head_count: group.current_count } : {} })}>
                  <option value="group_transfer">Трансфер</option>
                  <option value="weighing">Претегляне</option>
                  <option value="group_death">Смъртност</option>
                  <option value="vaccination">Ваксинация</option>
                  <option value="treatment">Лечение</option>
                </select>
              </div>

              {/* Transfer fields */}
              {eventForm.event_type === 'group_transfer' && (
                <>
                  <div className="form-group">
                    <label>Към хале</label>
                    <select value={eventForm.details.to_hall_id || ''} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, to_hall_id: e.target.value } }))} required>
                      <option value="">Избери...</option>
                      {halls.filter(h => h.is_active !== false).map(h => <option key={h.id} value={h.id}>{h.name} ({h.sector_name || ''}) — {h.current_occupancy || 0}/{h.capacity}</option>)}
                    </select>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Средно тегло (кг)</label>
                      <input type="number" step="0.1" min="0" value={eventForm.details.weight_avg_kg || ''} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, weight_avg_kg: e.target.value } }))} required />
                    </div>
                    <div className="form-group">
                      <label>Брой глави</label>
                      <input type="number" min="1" value={eventForm.details.head_count || ''} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, head_count: e.target.value } }))} required />
                    </div>
                  </div>
                </>
              )}

              {/* Weighing fields */}
              {eventForm.event_type === 'weighing' && (
                <div className="form-row">
                  <div className="form-group">
                    <label>Средно тегло (кг)</label>
                    <input type="number" step="0.1" min="0" value={eventForm.details.weight_avg_kg || ''} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, weight_avg_kg: e.target.value } }))} required />
                  </div>
                  <div className="form-group">
                    <label>Брой глави</label>
                    <input type="number" min="1" value={eventForm.details.head_count || group.current_count} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, head_count: e.target.value } }))} />
                  </div>
                </div>
              )}

              {/* Mortality fields */}
              {eventForm.event_type === 'group_death' && (
                <div className="form-row">
                  <div className="form-group">
                    <label>Брой</label>
                    <input type="number" min="1" value={eventForm.details.count || ''} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, count: e.target.value } }))} required />
                  </div>
                  <div className="form-group">
                    <label>Причина</label>
                    <select value={eventForm.details.reason || ''} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, reason: e.target.value } }))}>
                      <option value="">-- Изберете --</option>
                      <option value="болест">Болест</option>
                      <option value="травма">Травма</option>
                      <option value="друго">Друго</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Vaccination fields */}
              {eventForm.event_type === 'vaccination' && (
                <div className="form-row">
                  <div className="form-group">
                    <label>Медикамент</label>
                    <select value={eventForm.details.medicine_id || ''} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, medicine_id: e.target.value } }))} required>
                      <option value="">Избери...</option>
                      {medicines.map(m => <option key={m.id} value={m.id}>{m.name_bg || m.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Доза (мл)</label>
                    <input type="number" step="0.1" min="0" value={eventForm.details.dose || ''} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, dose: e.target.value } }))} />
                  </div>
                </div>
              )}

              {/* Treatment fields */}
              {eventForm.event_type === 'treatment' && (
                <>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Медикамент</label>
                      <select value={eventForm.details.medicine_id || ''} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, medicine_id: e.target.value } }))} required>
                        <option value="">Избери...</option>
                        {medicines.map(m => <option key={m.id} value={m.id}>{m.name_bg || m.name}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Доза (мл)</label>
                      <input type="number" step="0.1" min="0" value={eventForm.details.dose || ''} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, dose: e.target.value } }))} />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Диагноза</label>
                    <input value={eventForm.details.diagnosis || ''} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, diagnosis: e.target.value } }))} />
                  </div>
                </>
              )}

              {/* Date + Notes — common to all */}
              <div className="form-group">
                <label>Дата</label>
                <input type="date" value={eventForm.details.date || new Date().toISOString().split('T')[0]} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, date: e.target.value } }))} />
              </div>
              <div className="form-group">
                <label>Бележки</label>
                <textarea rows={2} value={eventForm.details.notes || ''} onChange={e => setEventForm(p => ({ ...p, details: { ...p.details, notes: e.target.value } }))} />
              </div>

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
