import { useState, useEffect } from 'react'
import { api, exportCsv } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

function fmtEur(v) { return v != null ? Number(v).toLocaleString('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €' : '-' }
function fmtDate(d) { if (!d) return '-'; const dt = new Date(d); return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}` }

const CAT_BG = { feed: 'Фуражи', salary: 'Заплати', veterinary: 'Ветеринарни', other: 'Други' }

export default function Expenses() {
  const { user } = useAuth()
  const [expenses, setExpenses] = useState([])
  const [summary, setSummary] = useState(null)
  const [tab, setTab] = useState('all')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showSalary, setShowSalary] = useState(false)
  const [salaryMonth, setSalaryMonth] = useState(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
  })
  const [templates, setTemplates] = useState([])
  const [medicines, setMedicines] = useState([])
  const [form, setForm] = useState({ category: 'other', subcategory: '', description: '', amount_eur: '', notes: '' })

  const load = async () => {
    setLoading(true)
    try {
      const params = {}
      if (tab !== 'all') params.category = tab
      const [list, sum] = await Promise.all([
        api('expenses.list', params),
        api('expenses.summary', {})
      ])
      setExpenses(list.expenses || [])
      setSummary(sum.summary)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [tab])

  const loadTemplates = async () => {
    try {
      const [t, m] = await Promise.all([
        api('salary.templates.list'),
        api('medicine.list')
      ])
      setTemplates(t.templates || [])
      setMedicines(m.medicines || [])
    } catch (e) { console.error(e) }
  }

  useEffect(() => { loadTemplates() }, [])

  const submitExpense = async (e) => {
    e.preventDefault()
    try {
      await api('expenses.record', {
        category: form.category,
        subcategory: form.subcategory,
        description: form.description,
        amount_eur: parseFloat(form.amount_eur),
        notes: form.notes,
        created_by: user?.id
      })
      setShowModal(false)
      setForm({ category: 'other', subcategory: '', description: '', amount_eur: '', notes: '' })
      load()
    } catch (err) { alert(err.message) }
  }

  const generateSalaries = async () => {
    try {
      const res = await api('salary.generate', { month_key: salaryMonth, created_by: user?.id })
      alert(`Генерирани ${res.count} записа за ${fmtEur(res.total_eur)}`)
      setShowSalary(false)
      load()
    } catch (err) { alert(err.message) }
  }

  return (
    <>
      <div className="page-header">
        <h1>Разходи</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={() => exportCsv('expenses')}>Експорт CSV</button>
          <button className="btn btn-outline" onClick={() => setShowSalary(true)}>Генерирай заплати</button>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Нов разход</button>
        </div>
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid grid-4" style={{ marginBottom: 24 }}>
          {summary.byCategory?.map(c => (
            <div key={c.category} className="stat-card">
              <div className="stat-value">{fmtEur(c.total_eur)}</div>
              <div className="stat-label">{CAT_BG[c.category] || c.category} ({c.entry_count} записа)</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        {['all', 'feed', 'salary', 'veterinary', 'other'].map(t => (
          <div key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'all' ? 'Всички' : CAT_BG[t]}
          </div>
        ))}
      </div>

      {loading ? <div className="loading">Зареждане...</div> : (
        <div className="card">
          <table>
            <thead><tr><th>Дата</th><th>Категория</th><th>Подкатегория</th><th>Описание</th><th>Сума</th><th>Сектор</th></tr></thead>
            <tbody>
              {expenses.length > 0 ? expenses.map(ex => (
                <tr key={ex.id}>
                  <td>{fmtDate(ex.entry_date)}</td>
                  <td><span className={`badge ${ex.category === 'feed' ? 'green' : ex.category === 'salary' ? 'blue' : ex.category === 'veterinary' ? 'yellow' : 'grey'}`}>{CAT_BG[ex.category] || ex.category}</span></td>
                  <td>{ex.subcategory || '-'}</td>
                  <td style={{maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{ex.description || '-'}</td>
                  <td style={{fontWeight:600}}>{fmtEur(ex.amount_eur)}</td>
                  <td>{ex.sector_name || '-'}</td>
                </tr>
              )) : <tr><td colSpan={6} style={{textAlign:'center',color:'var(--text-secondary)'}}>Няма записи</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Salary templates & medicines */}
      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>Шаблони заплати</h3>
          <table>
            <thead><tr><th>Роля</th><th>Базова заплата</th></tr></thead>
            <tbody>
              {templates.map(t => (
                <tr key={t.id}><td>{t.role}</td><td>{fmtEur(t.base_salary_eur)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Каталог медикаменти</h3>
          <table>
            <thead><tr><th>Медикамент</th><th>Единица</th><th>Цена</th><th>Наличност</th></tr></thead>
            <tbody>
              {medicines.map(m => (
                <tr key={m.id}>
                  <td>{m.name_bg || m.name}</td>
                  <td>{m.unit}</td>
                  <td>{fmtEur(m.price_per_unit_eur)}</td>
                  <td><span className={parseFloat(m.current_stock) <= parseFloat(m.reorder_threshold) ? 'badge red' : ''}>{m.current_stock} {m.unit}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Expense Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Нов разход</h2>
            <form onSubmit={submitExpense}>
              <div className="form-row">
                <div className="form-group">
                  <label>Категория</label>
                  <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                    <option value="feed">Фуражи</option>
                    <option value="veterinary">Ветеринарни</option>
                    <option value="other">Други</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Подкатегория</label>
                  <input value={form.subcategory} onChange={e => setForm(p => ({ ...p, subcategory: e.target.value }))} placeholder="Доставка, транспорт..." />
                </div>
              </div>
              <div className="form-group">
                <label>Описание</label>
                <input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label>Сума (€)</label>
                <input type="number" step="0.01" min="0" value={form.amount_eur} onChange={e => setForm(p => ({ ...p, amount_eur: e.target.value }))} required />
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

      {/* Generate Salaries Modal */}
      {showSalary && (
        <div className="modal-overlay" onClick={() => setShowSalary(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Генериране на заплати</h2>
            <div className="form-group">
              <label>Месец</label>
              <input type="month" value={salaryMonth} onChange={e => setSalaryMonth(e.target.value)} />
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Ще се генерират разходни записи за всички активни служители по техния шаблон за заплата.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setShowSalary(false)}>Отказ</button>
              <button type="button" className="btn btn-primary" onClick={generateSalaries}>Генерирай</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
