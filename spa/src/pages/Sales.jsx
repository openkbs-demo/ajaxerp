import { useState, useEffect } from 'react'
import { api, exportCsv } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

function fmtEur(v) { return v != null ? Number(v).toLocaleString('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €' : '-' }
function fmtDate(d) { if (!d) return '-'; const dt = new Date(d); return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}` }

const TYPE_BG = { finisher: 'Финишери', weaner: 'Отбити', culled: 'Бракувани' }

export default function Sales() {
  const { user } = useAuth()
  const [sales, setSales] = useState([])
  const [summary, setSummary] = useState(null)
  const [tab, setTab] = useState('all')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ sale_type: 'finisher', buyer_name: '', head_count: '', total_weight_kg: '', price_per_kg: '', price_per_head: '', invoice_number: '', notes: '' })

  const load = async () => {
    setLoading(true)
    try {
      const params = {}
      if (tab !== 'all') params.sale_type = tab
      const [list, sum] = await Promise.all([
        api('sales.list', params),
        api('sales.summary', {})
      ])
      setSales(list.sales || [])
      setSummary(sum.summary)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [tab])

  const submit = async (e) => {
    e.preventDefault()
    try {
      const payload = { ...form, created_by: user?.id }
      payload.head_count = parseInt(form.head_count) || 0
      if (form.sale_type !== 'weaner') {
        payload.total_weight_kg = parseFloat(form.total_weight_kg) || 0
        payload.price_per_kg = parseFloat(form.price_per_kg) || 0
        delete payload.price_per_head
      } else {
        payload.price_per_head = parseFloat(form.price_per_head) || 0
        delete payload.total_weight_kg
        delete payload.price_per_kg
      }
      await api('sales.record', payload)
      setShowModal(false)
      setForm({ sale_type: 'finisher', buyer_name: '', head_count: '', total_weight_kg: '', price_per_kg: '', price_per_head: '', invoice_number: '', notes: '' })
      load()
    } catch (err) { alert(err.message) }
  }

  return (
    <>
      <div className="page-header">
        <h1>Продажби</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={() => exportCsv('sales')}>Експорт CSV</button>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Нова продажба</button>
        </div>
      </div>

      {/* Summary */}
      {summary?.total && (
        <div className="grid grid-4" style={{ marginBottom: 24 }}>
          <div className="stat-card green">
            <div className="stat-value">{fmtEur(summary.total.total_eur)}</div>
            <div className="stat-label">Общо приходи</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{summary.total.total_heads || 0}</div>
            <div className="stat-label">Общо глави</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{summary.total.total_kg ? Number(summary.total.total_kg).toLocaleString('bg-BG') + ' кг' : '-'}</div>
            <div className="stat-label">Общо тегло</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{summary.total.total_kg > 0 ? (Number(summary.total.total_eur) / Number(summary.total.total_kg)).toFixed(2) + ' €/кг' : '-'}</div>
            <div className="stat-label">Средна цена/кг</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        {['all', 'finisher', 'weaner', 'culled'].map(t => (
          <div key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'all' ? 'Всички' : TYPE_BG[t]}
          </div>
        ))}
      </div>

      {loading ? <div className="loading">Зареждане...</div> : (
        <div className="card">
          <table>
            <thead><tr><th>Дата</th><th>Тип</th><th>Купувач</th><th>Глави</th><th>Тегло</th><th>Цена</th><th>Сума</th><th>Фактура</th></tr></thead>
            <tbody>
              {sales.length > 0 ? sales.map(s => (
                <tr key={s.id}>
                  <td>{fmtDate(s.sale_date)}</td>
                  <td><span className="badge blue">{TYPE_BG[s.sale_type] || s.sale_type}</span></td>
                  <td>{s.buyer_name || '-'}</td>
                  <td>{s.head_count}</td>
                  <td>{s.total_weight_kg ? `${Number(s.total_weight_kg).toLocaleString('bg-BG')} кг` : '-'}</td>
                  <td>{s.price_per_kg ? `${Number(s.price_per_kg).toFixed(2)} €/кг` : s.price_per_head ? `${Number(s.price_per_head).toFixed(2)} €/бр` : '-'}</td>
                  <td style={{fontWeight:600}}>{fmtEur(s.total_amount_eur)}</td>
                  <td>{s.invoice_number || '-'}</td>
                </tr>
              )) : <tr><td colSpan={8} style={{textAlign:'center',color:'var(--text-secondary)'}}>Няма записи</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* New Sale Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Нова продажба</h2>
            <form onSubmit={submit}>
              <div className="form-group">
                <label>Тип продажба</label>
                <select value={form.sale_type} onChange={e => setForm(p => ({ ...p, sale_type: e.target.value }))}>
                  <option value="finisher">Финишери</option>
                  <option value="weaner">Отбити</option>
                  <option value="culled">Бракувани</option>
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Купувач</label>
                  <input value={form.buyer_name} onChange={e => setForm(p => ({ ...p, buyer_name: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Брой глави</label>
                  <input type="number" min="1" value={form.head_count} onChange={e => setForm(p => ({ ...p, head_count: e.target.value }))} required />
                </div>
              </div>
              {form.sale_type !== 'weaner' ? (
                <div className="form-row">
                  <div className="form-group">
                    <label>Общо тегло (кг)</label>
                    <input type="number" step="0.01" min="0" value={form.total_weight_kg} onChange={e => setForm(p => ({ ...p, total_weight_kg: e.target.value }))} required />
                  </div>
                  <div className="form-group">
                    <label>Цена/кг (€)</label>
                    <input type="number" step="0.01" min="0" value={form.price_per_kg} onChange={e => setForm(p => ({ ...p, price_per_kg: e.target.value }))} required />
                  </div>
                </div>
              ) : (
                <div className="form-group">
                  <label>Цена/брой (€)</label>
                  <input type="number" step="0.01" min="0" value={form.price_per_head} onChange={e => setForm(p => ({ ...p, price_per_head: e.target.value }))} required />
                </div>
              )}
              {form.sale_type !== 'weaner' && form.head_count && form.total_weight_kg && form.price_per_kg && (
                <div style={{background:'#e8f5e9',padding:'8px 12px',borderRadius:6,marginBottom:16,fontSize:13}}>
                  Сума: <strong>{fmtEur(parseFloat(form.total_weight_kg) * parseFloat(form.price_per_kg))}</strong>
                  {' | '}Ср. тегло: <strong>{(parseFloat(form.total_weight_kg) / parseInt(form.head_count)).toFixed(1)} кг/глава</strong>
                </div>
              )}
              {form.sale_type === 'weaner' && form.head_count && form.price_per_head && (
                <div style={{background:'#e8f5e9',padding:'8px 12px',borderRadius:6,marginBottom:16,fontSize:13}}>
                  Сума: <strong>{fmtEur(parseInt(form.head_count) * parseFloat(form.price_per_head))}</strong>
                </div>
              )}
              <div className="form-row">
                <div className="form-group">
                  <label>Номер фактура</label>
                  <input value={form.invoice_number} onChange={e => setForm(p => ({ ...p, invoice_number: e.target.value }))} />
                </div>
              </div>
              <div className="form-group">
                <label>Бележки</label>
                <textarea rows={2} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Отказ</button>
                <button type="submit" className="btn btn-primary">Запиши</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
