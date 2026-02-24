import { useState, useEffect } from 'react'
import { api, exportCsv } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

function fmtEur(v) { return v != null ? Number(v).toLocaleString('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €' : '-' }
function fmtDate(d) { if (!d) return '-'; const dt = new Date(d); return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}` }

const STATUS_BG = { proposed: 'Предложена', confirmed: 'Потвърдена', loading: 'Товарене', in_transit: 'В транзит', delivered: 'Доставена', cancelled: 'Отменена' }
const STATUS_COLOR = { proposed: 'blue', confirmed: 'yellow', loading: 'yellow', in_transit: 'blue', delivered: 'green', cancelled: 'grey' }
const WORKFLOW = { proposed: 'confirmed', confirmed: 'loading', loading: 'in_transit', in_transit: 'delivered' }
const WORKFLOW_LABEL = { proposed: 'Потвърди', confirmed: 'Товарене', loading: 'Тръгни', in_transit: 'Доставено' }

export default function Dispatch() {
  const { user } = useAuth()
  const [dispatches, setDispatches] = useState([])
  const [groups, setGroups] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showWeightModal, setShowWeightModal] = useState(null) // dispatch id
  const [form, setForm] = useState({})
  const [weightForm, setWeightForm] = useState({})

  const load = async () => {
    setLoading(true)
    try {
      const [d, g, v, dr] = await Promise.all([
        api('dispatch.list'),
        api('groups.list'),
        api('vehicles.list'),
        api('personnel.list', { role: 'driver' })
      ])
      setDispatches(d.dispatches || [])
      setGroups(g.groups || [])
      setVehicles(v.vehicles || [])
      setDrivers(dr.personnel || [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const submitDispatch = async (e) => {
    e.preventDefault()
    try {
      await api('dispatch.create', {
        group_id: parseInt(form.group_id),
        dispatch_date: form.dispatch_date,
        buyer_name: form.buyer_name,
        destination: form.destination,
        vehicle_id: form.vehicle_id ? parseInt(form.vehicle_id) : undefined,
        driver_id: form.driver_id ? parseInt(form.driver_id) : undefined,
        head_count: parseInt(form.head_count),
        notes: form.notes,
        created_by: user?.id
      })
      setShowModal(false); load()
    } catch (err) { alert(err.message) }
  }

  const advanceStatus = async (d) => {
    const nextStatus = WORKFLOW[d.status]
    if (!nextStatus) return

    if (nextStatus === 'loading') {
      // Ask for weight at loading
      setShowWeightModal(d.id)
      setWeightForm({ type: 'loading', weight: '' })
      return
    }
    if (nextStatus === 'delivered') {
      // Ask for weight at destination
      setShowWeightModal(d.id)
      setWeightForm({ type: 'destination', weight: '' })
      return
    }

    try {
      await api('dispatch.update', { id: d.id, status: nextStatus })
      load()
    } catch (err) { alert(err.message) }
  }

  const submitWeight = async (e) => {
    e.preventDefault()
    try {
      const update = { id: showWeightModal }
      if (weightForm.type === 'loading') {
        update.status = 'loading'
        update.weight_at_loading_kg = parseFloat(weightForm.weight)
      } else {
        update.status = 'delivered'
        update.weight_at_destination_kg = parseFloat(weightForm.weight)
      }
      await api('dispatch.update', update)
      setShowWeightModal(null); load()
    } catch (err) { alert(err.message) }
  }

  const cancelDispatch = async (id) => {
    if (!confirm('Отмяна на заявката?')) return
    try { await api('dispatch.update', { id, status: 'cancelled' }); load() } catch (err) { alert(err.message) }
  }

  const autoCheck = async () => {
    try {
      const res = await api('dispatch.autoCheck')
      alert(`Създадени ${res.created || 0} нови предложения за експедиция`)
      load()
    } catch (err) { alert(err.message) }
  }

  // Summary stats
  const proposed = dispatches.filter(d => d.status === 'proposed').length
  const inLoading = dispatches.filter(d => d.status === 'loading').length
  const inTransit = dispatches.filter(d => d.status === 'in_transit').length
  const delivered = dispatches.filter(d => d.status === 'delivered').length

  return (
    <>
      <div className="page-header">
        <h1>Експедиция</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={() => exportCsv('dispatches')}>Експорт CSV</button>
          <button className="btn btn-outline" onClick={autoCheck}>Провери за автоматични</button>
          <button className="btn btn-primary" onClick={() => { setForm({ dispatch_date: new Date().toISOString().split('T')[0] }); setShowModal(true) }}>+ Нова заявка</button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        <div className="stat-card blue">
          <div className="stat-value">{proposed}</div>
          <div className="stat-label">Предложени</div>
        </div>
        <div className="stat-card yellow">
          <div className="stat-value">{inLoading}</div>
          <div className="stat-label">В товарене</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{inTransit}</div>
          <div className="stat-label">В транзит</div>
        </div>
        <div className="stat-card green">
          <div className="stat-value">{delivered}</div>
          <div className="stat-label">Доставени</div>
        </div>
      </div>

      {loading ? <div className="loading">Зареждане...</div> : (
        <div className="card">
          <table>
            <thead><tr><th>Дата</th><th>Група</th><th>Хале</th><th>Глави</th><th>Тегло тов.</th><th>Тегло клан.</th><th>Фира</th><th>МПС</th><th>Статус</th><th>Действия</th></tr></thead>
            <tbody>
              {dispatches.length > 0 ? dispatches.map(d => (
                <tr key={d.id} style={d.auto_generated ? { background: '#f3f0ff' } : undefined}>
                  <td>{fmtDate(d.dispatch_date)}</td>
                  <td><strong>{d.group_name}</strong></td>
                  <td>{d.hall_name || '-'}</td>
                  <td>{d.head_count}</td>
                  <td>{d.weight_at_loading_kg ? `${Number(d.weight_at_loading_kg).toLocaleString('bg-BG')} кг` : '-'}</td>
                  <td>{d.weight_at_destination_kg ? `${Number(d.weight_at_destination_kg).toLocaleString('bg-BG')} кг` : '-'}</td>
                  <td>{d.shrinkage_pct != null ? <span className={`badge ${parseFloat(d.shrinkage_pct) > 3 ? 'red' : parseFloat(d.shrinkage_pct) > 2 ? 'yellow' : 'green'}`}>{d.shrinkage_pct}%</span> : '-'}</td>
                  <td>{d.plate_number || '-'}</td>
                  <td><span className={`badge ${STATUS_COLOR[d.status]}`}>{STATUS_BG[d.status]}</span>{d.auto_generated && <small style={{ marginLeft: 4, color: 'var(--text-secondary)' }}>авто</small>}</td>
                  <td>
                    {WORKFLOW[d.status] && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-sm btn-primary" onClick={() => advanceStatus(d)}>{WORKFLOW_LABEL[d.status]}</button>
                        {d.status !== 'in_transit' && <button className="btn btn-sm btn-outline" onClick={() => cancelDispatch(d.id)}>Отмени</button>}
                      </div>
                    )}
                  </td>
                </tr>
              )) : <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Няма заявки</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* New Dispatch Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Нова заявка за експедиция</h2>
            <form onSubmit={submitDispatch}>
              <div className="form-group">
                <label>Група (тегло &ge; 100 кг)</label>
                <select value={form.group_id || ''} onChange={e => {
                  const g = groups.find(g => g.id === parseInt(e.target.value))
                  setForm(f => ({ ...f, group_id: e.target.value, head_count: g?.current_count || '' }))
                }} required>
                  <option value="">Избери...</option>
                  {groups.filter(g => !g.exit_date && parseFloat(g.current_weight_avg_kg) >= 100).map(g => (
                    <option key={g.id} value={g.id}>{g.group_name} ({g.current_count} глави, ~{g.current_weight_avg_kg} кг)</option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Дата на експедиция</label>
                  <input type="date" value={form.dispatch_date || ''} onChange={e => setForm(f => ({ ...f, dispatch_date: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Брой глави</label>
                  <input type="number" min="1" value={form.head_count || ''} onChange={e => setForm(f => ({ ...f, head_count: e.target.value }))} required />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Купувач</label>
                  <input value={form.buyer_name || ''} onChange={e => setForm(f => ({ ...f, buyer_name: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Дестинация</label>
                  <input value={form.destination || ''} onChange={e => setForm(f => ({ ...f, destination: e.target.value }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>МПС</label>
                  <select value={form.vehicle_id || ''} onChange={e => setForm(f => ({ ...f, vehicle_id: e.target.value }))}>
                    <option value="">— Без —</option>
                    {vehicles.filter(v => v.vehicle_type === 'livestock_transport' || v.status === 'clean').map(v => (
                      <option key={v.id} value={v.id}>{v.plate_number}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Шофьор</label>
                  <select value={form.driver_id || ''} onChange={e => setForm(f => ({ ...f, driver_id: e.target.value }))}>
                    <option value="">— Без —</option>
                    {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Бележки</label>
                <textarea rows={2} value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Отказ</button>
                <button type="submit" className="btn btn-primary">Създай заявка</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Weight Modal */}
      {showWeightModal && (
        <div className="modal-overlay" onClick={() => setShowWeightModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{weightForm.type === 'loading' ? 'Тегло при товарене' : 'Тегло при кланица'}</h2>
            <form onSubmit={submitWeight}>
              <div className="form-group">
                <label>{weightForm.type === 'loading' ? 'Общо тегло при товарене (кг)' : 'Общо тегло при кланица (кг)'}</label>
                <input type="number" step="0.01" min="0" value={weightForm.weight || ''} onChange={e => setWeightForm(f => ({ ...f, weight: e.target.value }))} required autoFocus />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowWeightModal(null)}>Отказ</button>
                <button type="submit" className="btn btn-primary">Запиши</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
