import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'

const CAT_BG = { gilt: 'Ремонтна', sow: 'Свиня майка', boar: 'Нерез', suckling_piglet: 'Бозайник', weaner: 'Подрастващо', finisher: 'Угояване' }
const STATUS_BG = {
  awaiting_breeding: 'Очаква заплождане', inseminated: 'Осеменена', pregnant_confirmed: 'Бременна',
  in_farrowing: 'В родилно', lactating: 'Лактираща', weaned_resting: 'Почивка',
  culled: 'Бракувана', active: 'Активен'
}
const STATUS_COLOR = {
  awaiting_breeding: 'blue', inseminated: 'yellow', pregnant_confirmed: 'green',
  in_farrowing: 'red', lactating: 'green', weaned_resting: 'grey', culled: 'grey', active: 'green'
}

function fmtDate(d) {
  if (!d) return '-'
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}`
}

export default function Animals() {
  const [animals, setAnimals] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ category: '', status: '' })
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ ear_tag: '', category: 'gilt', breed: 'DanBred Landrace', date_of_birth: '' })
  const [halls, setHalls] = useState([])

  const load = async () => {
    setLoading(true)
    try {
      const res = await api('animals.list', { ...filters, limit: 100 })
      setAnimals(res.animals)
      setTotal(res.total)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [filters.category, filters.status])
  useEffect(() => { api('halls.list', {}).then(r => setHalls(r.halls)).catch(() => {}) }, [])

  const handleAdd = async (e) => {
    e.preventDefault()
    try {
      await api('animals.register', form)
      setShowAdd(false)
      setForm({ ear_tag: '', category: 'gilt', breed: 'DanBred Landrace', date_of_birth: '' })
      load()
    } catch (err) { alert(err.message) }
  }

  return (
    <>
      <div className="page-header">
        <h1>Животни ({total})</h1>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Регистрирай</button>
      </div>

      <div className="filters">
        <select value={filters.category} onChange={e => setFilters(p => ({ ...p, category: e.target.value }))}>
          <option value="">Всички категории</option>
          {Object.entries(CAT_BG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filters.status} onChange={e => setFilters(p => ({ ...p, status: e.target.value }))}>
          <option value="">Всички статуси</option>
          {Object.entries(STATUS_BG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="card">
        {loading ? <div className="loading">Зареждане...</div> : (
          <table>
            <thead>
              <tr><th>Ушна марка</th><th>Категория</th><th>Порода</th><th>Статус</th><th>Прасене</th><th>Хале</th><th>Дата вход</th></tr>
            </thead>
            <tbody>
              {animals.map(a => (
                <tr key={a.id}>
                  <td><Link to={`/animals/${a.id}`} style={{ fontWeight: 600 }}>{a.ear_tag || `#${a.id}`}</Link></td>
                  <td>{CAT_BG[a.category] || a.category}</td>
                  <td>{a.breed || '-'}</td>
                  <td><span className={`badge ${STATUS_COLOR[a.status] || 'grey'}`}>{STATUS_BG[a.status] || a.status}</span></td>
                  <td>{a.parity_number || '-'}</td>
                  <td>{a.hall_name || '-'}</td>
                  <td>{fmtDate(a.entry_date)}</td>
                </tr>
              ))}
              {animals.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Няма животни</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {/* Add animal modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Регистриране на животно</h2>
            <form onSubmit={handleAdd}>
              <div className="form-row">
                <div className="form-group">
                  <label>Ушна марка</label>
                  <input placeholder="BG123456" value={form.ear_tag} onChange={e => setForm(p => ({ ...p, ear_tag: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Категория</label>
                  <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                    {Object.entries(CAT_BG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Порода</label>
                  <select value={form.breed} onChange={e => setForm(p => ({ ...p, breed: e.target.value }))}>
                    <option value="DanBred Landrace">DanBred Landrace</option>
                    <option value="DanBred Yorkshire">DanBred Yorkshire</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Дата на раждане</label>
                  <input type="date" value={form.date_of_birth} onChange={e => setForm(p => ({ ...p, date_of_birth: e.target.value }))} />
                </div>
              </div>
              <div className="form-group">
                <label>Хале</label>
                <select value={form.hall_id || ''} onChange={e => setForm(p => ({ ...p, hall_id: e.target.value || undefined }))}>
                  <option value="">-- Без хале --</option>
                  {halls.map(h => <option key={h.id} value={h.id}>{h.name} ({h.sector_name})</option>)}
                </select>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowAdd(false)}>Отказ</button>
                <button type="submit" className="btn btn-primary">Запиши</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
