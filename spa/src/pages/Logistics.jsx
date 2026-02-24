import { useState, useEffect } from 'react'
import { api, exportCsv } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

function fmtDate(d) { if (!d) return '-'; const dt = new Date(d); return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}` }

const STATUS_BG = { clean: 'Чист', dirty: 'Мръсен', maintenance: 'В сервиз', out_of_service: 'Извън експлоатация' }
const STATUS_COLOR = { clean: 'green', dirty: 'red', maintenance: 'yellow', out_of_service: 'grey' }
const ROUTE_STATUS = { planned: 'Планиран', in_progress: 'В ход', completed: 'Завършен', cancelled: 'Отменен' }
const ROUTE_COLOR = { planned: 'blue', in_progress: 'yellow', completed: 'green', cancelled: 'grey' }

export default function Logistics() {
  const { user } = useAuth()
  const [tab, setTab] = useState('vehicles')
  const [vehicles, setVehicles] = useState([])
  const [silos, setSilos] = useState([])
  const [routes, setRoutes] = useState([])
  const [disinfections, setDisinfections] = useState([])
  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(null) // 'vehicle', 'route', 'fill', 'disinfect'
  const [form, setForm] = useState({})

  const load = async () => {
    setLoading(true)
    try {
      if (tab === 'vehicles') {
        const [v, d] = await Promise.all([api('vehicles.list'), api('personnel.list', { role: 'driver' })])
        setVehicles(v.vehicles || [])
        setDrivers(d.personnel || [])
      } else if (tab === 'silos') {
        const s = await api('silos.list')
        setSilos(s.silos || [])
      } else if (tab === 'routes') {
        const [r, v, d] = await Promise.all([api('delivery.list'), api('vehicles.list'), api('personnel.list', { role: 'driver' })])
        setRoutes(r.routes || [])
        setVehicles(v.vehicles || [])
        setDrivers(d.personnel || [])
      } else if (tab === 'disinfection') {
        const [dl, v] = await Promise.all([api('disinfection.list'), api('vehicles.list')])
        setDisinfections(dl.logs || [])
        setVehicles(v.vehicles || [])
      }
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [tab])

  const submitVehicle = async (e) => {
    e.preventDefault()
    try {
      await api('vehicles.upsert', form)
      setShowModal(null); load()
    } catch (err) { alert(err.message) }
  }

  const submitRoute = async (e) => {
    e.preventDefault()
    try {
      const stops = (form.stops || []).filter(s => s.silo_id && s.tons > 0)
      if (stops.length === 0) { alert('Добавете поне една спирка'); return }
      await api('delivery.create', { vehicle_id: form.vehicle_id, driver_id: form.driver_id, stops, notes: form.notes, created_by: user?.id, km_start: form.km_start ? parseInt(form.km_start) : undefined })
      setShowModal(null); load()
    } catch (err) { alert(err.message) }
  }

  const completeRoute = async (routeId) => {
    const kmEnd = prompt('Километраж при завършване (км):')
    if (kmEnd === null) return
    try {
      await api('delivery.complete', { id: routeId, km_end: kmEnd ? parseInt(kmEnd) : undefined })
      load()
    } catch (err) { alert(err.message) }
  }

  const cancelRoute = async (routeId) => {
    if (!confirm('Отмяна на маршрута?')) return
    try { await api('delivery.cancel', { id: routeId }); load() } catch (err) { alert(err.message) }
  }

  const submitFill = async (e) => {
    e.preventDefault()
    try {
      await api('silos.fill', { silo_id: parseInt(form.silo_id), tons: parseFloat(form.tons) })
      setShowModal(null); load()
    } catch (err) { alert(err.message) }
  }

  const submitDisinfect = async (e) => {
    e.preventDefault()
    try {
      await api('disinfection.record', { vehicle_id: parseInt(form.vehicle_id), wash_confirmed: form.wash, disinfect_confirmed: form.disinfect, performed_by: user?.id, notes: form.notes })
      setShowModal(null); load()
    } catch (err) { alert(err.message) }
  }

  const checkSiloLevels = async () => {
    try {
      const res = await api('silos.checkLevels')
      alert(`Проверени: ${res.checked || 0} силоза. Нови аларми: ${res.alertsGenerated || 0}`)
    } catch (err) { alert(err.message) }
  }

  const addStop = () => {
    setForm(f => ({ ...f, stops: [...(f.stops || []), { silo_id: '', tons: '' }] }))
  }

  const updateStop = (idx, field, val) => {
    setForm(f => {
      const stops = [...(f.stops || [])]
      stops[idx] = { ...stops[idx], [field]: val }
      return { ...f, stops }
    })
  }

  const removeStop = (idx) => {
    setForm(f => ({ ...f, stops: (f.stops || []).filter((_, i) => i !== idx) }))
  }

  return (
    <>
      <div className="page-header">
        <h1>Логистика</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {tab === 'routes' && <button className="btn btn-outline btn-sm" onClick={() => exportCsv('delivery_routes')}>Експорт CSV</button>}
          {tab === 'silos' && <button className="btn btn-outline btn-sm" onClick={checkSiloLevels}>Провери нива</button>}
        </div>
      </div>

      <div className="tabs">
        {[['vehicles', 'МПС'], ['silos', 'Силози'], ['routes', 'Маршрути'], ['disinfection', 'Дезинфекция']].map(([k, label]) => (
          <div key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</div>
        ))}
      </div>

      {loading ? <div className="loading">Зареждане...</div> : (
        <>
          {/* ── VEHICLES TAB ── */}
          {tab === 'vehicles' && (
            <>
              <div style={{ marginBottom: 12 }}>
                <button className="btn btn-primary" onClick={() => { setForm({ vehicle_type: 'feed_truck' }); setShowModal('vehicle') }}>+ Ново МПС</button>
              </div>
              <div className="grid grid-4">
                {vehicles.map(v => (
                  <div key={v.id} className="card" style={{ padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <strong>{v.plate_number}</strong>
                      <span className={`badge ${STATUS_COLOR[v.status]}`}>{STATUS_BG[v.status]}</span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      <div>{v.vehicle_type === 'feed_truck' ? 'Фуражовоз' : 'Животински транспорт'}</div>
                      {v.capacity_tons > 0 && <div>Капацитет: {v.capacity_tons} т</div>}
                      <div>Шофьор: {v.driver_name || '—'}</div>
                      <div>Км: {v.current_km ? Number(v.current_km).toLocaleString('bg-BG') : '—'}</div>
                      {v.last_disinfection_at && <div>Посл. дезинф.: {fmtDate(v.last_disinfection_at)}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── SILOS TAB ── */}
          {tab === 'silos' && (
            <>
              <div style={{ marginBottom: 12 }}>
                <button className="btn btn-primary" onClick={() => { setForm({ silo_id: '', tons: '' }); setShowModal('fill') }}>Зареди ръчно</button>
              </div>
              <div className="card">
                <table>
                  <thead><tr><th>Хале</th><th>Силоз</th><th>Рецепта</th><th>Капацитет</th><th>Ниво</th><th>%</th><th>Статус</th></tr></thead>
                  <tbody>
                    {silos.map(s => {
                      const pct = parseFloat(s.fill_pct) || 0
                      const color = pct >= 50 ? 'green' : pct >= 20 ? 'yellow' : 'red'
                      return (
                        <tr key={s.id}>
                          <td>{s.hall_name}</td>
                          <td>{s.silo_name}</td>
                          <td>{s.recipe_name_bg || s.feed_type || '-'}</td>
                          <td>{s.capacity_tons} т</td>
                          <td>{Number(s.current_level_tons).toFixed(2)} т</td>
                          <td><strong>{pct}%</strong></td>
                          <td><span className={`badge ${color}`}>{pct >= 50 ? 'OK' : pct >= 20 ? 'Ниско' : 'Критично'}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── ROUTES TAB ── */}
          {tab === 'routes' && (
            <>
              <div style={{ marginBottom: 12 }}>
                <button className="btn btn-primary" onClick={async () => {
                  try { const s = await api('silos.list'); setSilos(s.silos || []) } catch {}
                  setForm({ vehicle_id: '', driver_id: '', stops: [{ silo_id: '', tons: '' }], notes: '' }); setShowModal('route')
                }}>+ Нов маршрут</button>
              </div>
              <div className="card">
                <table>
                  <thead><tr><th>Дата</th><th>МПС</th><th>Шофьор</th><th>Спирки</th><th>Тонове</th><th>Км</th><th>Статус</th><th>Действия</th></tr></thead>
                  <tbody>
                    {routes.length > 0 ? routes.map(r => (
                      <tr key={r.id}>
                        <td>{fmtDate(r.route_date)}</td>
                        <td>{r.plate_number}</td>
                        <td>{r.driver_name}</td>
                        <td>{r.stop_count}</td>
                        <td>{Number(r.total_tons).toFixed(2)} т</td>
                        <td>{r.km_start && r.km_end ? `${r.km_end - r.km_start} км` : '-'}</td>
                        <td><span className={`badge ${ROUTE_COLOR[r.status]}`}>{ROUTE_STATUS[r.status]}</span></td>
                        <td>
                          {r.status === 'planned' && (
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn btn-sm btn-primary" onClick={() => completeRoute(r.id)}>Завърши</button>
                              <button className="btn btn-sm btn-outline" onClick={() => cancelRoute(r.id)}>Отмени</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )) : <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Няма маршрути</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── DISINFECTION TAB ── */}
          {tab === 'disinfection' && (
            <>
              <div style={{ marginBottom: 12 }}>
                <button className="btn btn-primary" onClick={() => { setForm({ vehicle_id: '', wash: true, disinfect: true, notes: '' }); setShowModal('disinfect') }}>+ Регистрирай дезинфекция</button>
              </div>
              <div className="card">
                <table>
                  <thead><tr><th>Дата</th><th>МПС</th><th>Измиване</th><th>Дезинфекция</th><th>Извършил</th><th>Бележки</th></tr></thead>
                  <tbody>
                    {disinfections.length > 0 ? disinfections.map(d => (
                      <tr key={d.id}>
                        <td>{fmtDate(d.disinfection_date)}</td>
                        <td>{d.plate_number}</td>
                        <td>{d.wash_confirmed ? '✓' : '✗'}</td>
                        <td>{d.disinfect_confirmed ? '✓' : '✗'}</td>
                        <td>{d.performed_by_name}</td>
                        <td>{d.notes || '-'}</td>
                      </tr>
                    )) : <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Няма записи</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {/* ── VEHICLE MODAL ── */}
      {showModal === 'vehicle' && (
        <div className="modal-overlay" onClick={() => setShowModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Ново МПС</h2>
            <form onSubmit={submitVehicle}>
              <div className="form-row">
                <div className="form-group">
                  <label>Рег. номер</label>
                  <input value={form.plate_number || ''} onChange={e => setForm(f => ({ ...f, plate_number: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Тип</label>
                  <select value={form.vehicle_type || 'feed_truck'} onChange={e => setForm(f => ({ ...f, vehicle_type: e.target.value }))}>
                    <option value="feed_truck">Фуражовоз</option>
                    <option value="livestock_transport">Животински транспорт</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Капацитет (тона)</label>
                  <input type="number" step="0.1" min="0" value={form.capacity_tons || ''} onChange={e => setForm(f => ({ ...f, capacity_tons: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Шофьор</label>
                  <select value={form.assigned_driver_id || ''} onChange={e => setForm(f => ({ ...f, assigned_driver_id: e.target.value ? parseInt(e.target.value) : null }))}>
                    <option value="">— Без —</option>
                    {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(null)}>Отказ</button>
                <button type="submit" className="btn btn-primary">Запиши</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── ROUTE MODAL ── */}
      {showModal === 'route' && (
        <div className="modal-overlay" onClick={() => setShowModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <h2>Нов маршрут</h2>
            <form onSubmit={submitRoute}>
              <div className="form-row">
                <div className="form-group">
                  <label>МПС (само чисти)</label>
                  <select value={form.vehicle_id || ''} onChange={e => setForm(f => ({ ...f, vehicle_id: parseInt(e.target.value) }))} required>
                    <option value="">Избери...</option>
                    {vehicles.filter(v => v.status === 'clean' && v.vehicle_type === 'feed_truck').map(v => (
                      <option key={v.id} value={v.id}>{v.plate_number} ({v.capacity_tons}т)</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Шофьор</label>
                  <select value={form.driver_id || ''} onChange={e => setForm(f => ({ ...f, driver_id: parseInt(e.target.value) }))} required>
                    <option value="">Избери...</option>
                    {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Км старт</label>
                <input type="number" value={form.km_start || ''} onChange={e => setForm(f => ({ ...f, km_start: e.target.value }))} />
              </div>
              <h3 style={{ marginTop: 16, marginBottom: 8 }}>Спирки</h3>
              {(form.stops || []).map((stop, i) => (
                <div key={i} className="form-row" style={{ alignItems: 'end' }}>
                  <div className="form-group" style={{ flex: 2 }}>
                    <label>Силоз</label>
                    <select value={stop.silo_id || ''} onChange={e => updateStop(i, 'silo_id', parseInt(e.target.value))} required>
                      <option value="">Избери...</option>
                      {silos.map(s => <option key={s.id} value={s.id}>{s.hall_name} — {s.silo_name} ({s.fill_pct}%)</option>)}
                    </select>
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>Тонове</label>
                    <input type="number" step="0.1" min="0.1" value={stop.tons || ''} onChange={e => updateStop(i, 'tons', parseFloat(e.target.value))} required />
                  </div>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => removeStop(i)} style={{ marginBottom: 16 }}>✗</button>
                </div>
              ))}
              <button type="button" className="btn btn-outline btn-sm" onClick={addStop} style={{ marginBottom: 16 }}>+ Спирка</button>
              {form.vehicle_id && (form.stops || []).length > 0 && (() => {
                const totalT = (form.stops || []).reduce((s, st) => s + (parseFloat(st.tons) || 0), 0)
                const cap = vehicles.find(v => v.id === form.vehicle_id)?.capacity_tons || 0
                return (
                  <div style={{ background: totalT > parseFloat(cap) ? '#ffebee' : '#e8f5e9', padding: '8px 12px', borderRadius: 6, marginBottom: 16, fontSize: 13 }}>
                    Общо: <strong>{totalT.toFixed(1)}т</strong> / {cap}т капацитет
                    {totalT > parseFloat(cap) && <span style={{ color: 'var(--danger)', marginLeft: 8 }}>Надвишен капацитет!</span>}
                  </div>
                )
              })()}
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(null)}>Отказ</button>
                <button type="submit" className="btn btn-primary">Създай маршрут</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── FILL SILO MODAL ── */}
      {showModal === 'fill' && (
        <div className="modal-overlay" onClick={() => setShowModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Ръчно зареждане на силоз</h2>
            <form onSubmit={submitFill}>
              <div className="form-group">
                <label>Силоз</label>
                <select value={form.silo_id || ''} onChange={e => setForm(f => ({ ...f, silo_id: e.target.value }))} required>
                  <option value="">Избери...</option>
                  {silos.map(s => <option key={s.id} value={s.id}>{s.hall_name} — {s.silo_name} ({Number(s.current_level_tons).toFixed(1)}/{s.capacity_tons}т)</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Количество (тона)</label>
                <input type="number" step="0.01" min="0.01" value={form.tons || ''} onChange={e => setForm(f => ({ ...f, tons: e.target.value }))} required />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(null)}>Отказ</button>
                <button type="submit" className="btn btn-primary">Зареди</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── DISINFECT MODAL ── */}
      {showModal === 'disinfect' && (
        <div className="modal-overlay" onClick={() => setShowModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Регистрация на дезинфекция</h2>
            <form onSubmit={submitDisinfect}>
              <div className="form-group">
                <label>МПС (мръсни)</label>
                <select value={form.vehicle_id || ''} onChange={e => setForm(f => ({ ...f, vehicle_id: e.target.value }))} required>
                  <option value="">Избери...</option>
                  {vehicles.filter(v => v.status === 'dirty').map(v => <option key={v.id} value={v.id}>{v.plate_number}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={form.wash || false} onChange={e => setForm(f => ({ ...f, wash: e.target.checked }))} />
                  Измиване потвърдено
                </label>
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={form.disinfect || false} onChange={e => setForm(f => ({ ...f, disinfect: e.target.checked }))} />
                  Дезинфекция потвърдена
                </label>
              </div>
              <div className="form-group">
                <label>Бележки</label>
                <textarea rows={2} value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(null)}>Отказ</button>
                <button type="submit" className="btn btn-primary">Запиши</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
