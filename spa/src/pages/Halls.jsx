import { useState, useEffect } from 'react'
import { api } from '../api.js'

export default function Halls() {
  const [halls, setHalls] = useState([])
  const [sectors, setSectors] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', sector_id: '', biosecurity_zone: 'black', capacity: 100 })

  const load = () => {
    setLoading(true)
    Promise.all([
      api('halls.list', {}).then(r => setHalls(r.halls)),
      api('sectors.list').then(r => setSectors(r.sectors))
    ]).catch(console.error).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleAdd = async (e) => {
    e.preventDefault()
    try {
      await api('halls.create', { ...form, sector_id: parseInt(form.sector_id), capacity: parseInt(form.capacity) })
      setShowAdd(false)
      setForm({ name: '', sector_id: '', biosecurity_zone: 'black', capacity: 100 })
      load()
    } catch (err) { alert(err.message) }
  }

  return (
    <>
      <div className="page-header">
        <h1>Халета и сектори</h1>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Добави хале</button>
      </div>

      {/* Sectors overview */}
      <div className="grid grid-3" style={{ marginBottom: 24 }}>
        {sectors.map(s => {
          const sectorHalls = halls.filter(h => h.sector_code === s.code)
          const totalCap = sectorHalls.reduce((sum, h) => sum + h.capacity, 0)
          const totalOcc = sectorHalls.reduce((sum, h) => sum + (h.current_occupancy || 0), 0)
          return (
            <div key={s.id} className="stat-card" style={{ textAlign: 'left', padding: '16px 20px' }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{s.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.code} | {sectorHalls.length} халета</div>
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span>Запълване: {totalOcc}/{totalCap}</span>
                  <span>{totalCap > 0 ? Math.round(totalOcc / totalCap * 100) : 0}%</span>
                </div>
                <div style={{ background: '#eee', borderRadius: 4, height: 8 }}>
                  <div style={{ background: 'var(--primary)', borderRadius: 4, height: 8, width: `${totalCap > 0 ? Math.min(totalOcc / totalCap * 100, 100) : 0}%` }} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Halls table */}
      <div className="card">
        <h3>Всички халета ({halls.length})</h3>
        {loading ? <div className="loading">Зареждане...</div> : (
          <table>
            <thead><tr><th>Име</th><th>Сектор</th><th>Зона</th><th>Капацитет</th><th>Запълване</th><th>Статус</th></tr></thead>
            <tbody>
              {halls.map(h => {
                const pct = h.capacity > 0 ? Math.round((h.current_occupancy || 0) / h.capacity * 100) : 0
                return (
                  <tr key={h.id}>
                    <td><strong>{h.name}</strong></td>
                    <td>{h.sector_name}</td>
                    <td><span className={`badge ${h.biosecurity_zone === 'black' ? 'grey' : h.biosecurity_zone === 'grey' ? 'yellow' : 'green'}`}>{h.biosecurity_zone === 'black' ? 'Черна' : h.biosecurity_zone === 'grey' ? 'Сива' : 'Бяла'}</span></td>
                    <td>{h.capacity}</td>
                    <td>
                      {h.current_occupancy || 0} / {h.capacity}
                      <div style={{ background: '#eee', borderRadius: 4, height: 6, width: 60, display: 'inline-block', marginLeft: 8, verticalAlign: 'middle' }}>
                        <div style={{ background: pct > 90 ? 'var(--danger)' : pct > 70 ? 'var(--warning)' : 'var(--success)', borderRadius: 4, height: 6, width: `${Math.min(pct, 100)}%` }} />
                      </div>
                    </td>
                    <td>{h.is_active ? <span className="badge green">Активно</span> : <span className="badge grey">Неактивно</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Добавяне на хале</h2>
            <form onSubmit={handleAdd}>
              <div className="form-row">
                <div className="form-group">
                  <label>Име</label>
                  <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="РОД-8" required />
                </div>
                <div className="form-group">
                  <label>Сектор</label>
                  <select value={form.sector_id} onChange={e => setForm(p => ({ ...p, sector_id: e.target.value }))} required>
                    <option value="">-- Изберете --</option>
                    {sectors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Биосигурностна зона</label>
                  <select value={form.biosecurity_zone} onChange={e => setForm(p => ({ ...p, biosecurity_zone: e.target.value }))}>
                    <option value="white">Бяла</option>
                    <option value="grey">Сива</option>
                    <option value="black">Черна</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Капацитет</label>
                  <input type="number" min="1" value={form.capacity} onChange={e => setForm(p => ({ ...p, capacity: e.target.value }))} required />
                </div>
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
