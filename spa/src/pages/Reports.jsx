import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

function fmtEur(v) { return v != null ? Number(v).toLocaleString('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €' : '-' }
function fmtDate(d) { if (!d) return '-'; const dt = new Date(d); return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}` }
function fmtNum(v, dec = 1) { return v != null ? Number(v).toFixed(dec) : '-' }

export default function Reports() {
  const { user } = useAuth()
  const [tab, setTab] = useState('npd')

  return (
    <>
      <div className="page-header">
        <h1>Отчети</h1>
      </div>
      <div className="tabs">
        <div className={`tab ${tab === 'npd' ? 'active' : ''}`} onClick={() => setTab('npd')}>NPD</div>
        <div className={`tab ${tab === 'weight' ? 'active' : ''}`} onClick={() => setTab('weight')}>Тегло</div>
        <div className={`tab ${tab === 'feed' ? 'active' : ''}`} onClick={() => setTab('feed')}>Фуражи</div>
        <div className={`tab ${tab === 'halls' ? 'active' : ''}`} onClick={() => setTab('halls')}>Халета</div>
        <div className={`tab ${tab === 'inventory' ? 'active' : ''}`} onClick={() => setTab('inventory')}>Инвентар</div>
        <div className={`tab ${tab === 'trucks' ? 'active' : ''}`} onClick={() => setTab('trucks')}>Фуражовози</div>
        <div className={`tab ${tab === 'mortality' ? 'active' : ''}`} onClick={() => setTab('mortality')}>Смъртност (€)</div>
        <div className={`tab ${tab === 'dailyio' ? 'active' : ''}`} onClick={() => setTab('dailyio')}>Вход/Изход</div>
      </div>
      {tab === 'npd' && <NpdReport />}
      {tab === 'weight' && <WeightReport />}
      {tab === 'feed' && <FeedReport />}
      {tab === 'halls' && <HallReport />}
      {tab === 'inventory' && <InventoryReport user={user} />}
      {tab === 'trucks' && <TruckEfficiencyReport />}
      {tab === 'mortality' && <MortalityValueReport />}
      {tab === 'dailyio' && <DailyIOReport />}
    </>
  )
}

function NpdReport() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api('reports.npd', {}).then(r => setData(r.npd)).catch(console.error).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading">Зареждане...</div>
  if (!data) return <div className="loading">Няма данни</div>

  const statusColor = data.avg_npd <= data.target ? 'green' : data.avg_npd <= data.target * 1.2 ? 'yellow' : 'red'

  return (
    <>
      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className={`stat-card ${statusColor}`}>
          <div className="stat-value">{fmtNum(data.avg_npd, 1)}</div>
          <div className="stat-label">Среден NPD (дни)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{data.target}</div>
          <div className="stat-label">Цел (дни)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{data.total_sows}</div>
          <div className="stat-label">Брой свине</div>
        </div>
      </div>
      <div className="card">
        <h3>NPD по свиня (Непродуктивни дни)</h3>
        <table>
          <thead><tr><th>Ушна марка</th><th>Паритет</th><th>Статус</th><th>Хале</th><th>NPD (дни)</th><th>Оценка</th></tr></thead>
          <tbody>
            {data.sows?.length > 0 ? data.sows.map(s => (
              <tr key={s.id}>
                <td><strong>{s.ear_tag || `#${s.id}`}</strong></td>
                <td>{s.parity}</td>
                <td>{s.status}</td>
                <td>{s.hall_name || '-'}</td>
                <td><strong>{s.npd_days}</strong></td>
                <td><span className={`badge ${s.npd_days <= 35 ? 'green' : s.npd_days <= 50 ? 'yellow' : 'red'}`}>
                  {s.npd_days <= 35 ? 'OK' : s.npd_days <= 50 ? 'Внимание' : 'Проблем'}
                </span></td>
              </tr>
            )) : <tr><td colSpan={6} style={{textAlign:'center',color:'var(--text-secondary)'}}>Няма данни за NPD</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

function WeightReport() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api('reports.weightVariation', {}).then(r => setData(r.weightVariation)).catch(console.error).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading">Зареждане...</div>
  if (!data) return <div className="loading">Няма данни</div>

  return (
    <>
      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className={`stat-card ${data.overall_cv != null && data.overall_cv <= 10 ? 'green' : 'yellow'}`}>
          <div className="stat-value">{data.overall_cv != null ? fmtNum(data.overall_cv, 1) + '%' : '-'}</div>
          <div className="stat-label">Общ CV%</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{'< 10%'}</div>
          <div className="stat-label">Цел CV%</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{data.batches?.length || 0}</div>
          <div className="stat-label">Партиди</div>
        </div>
      </div>
      <div className="card">
        <h3>Вариация на тегло по партида</h3>
        <table>
          <thead><tr><th>Партида</th><th>Хале</th><th>Дата изход</th><th>Глави</th><th>Ср. тегло</th><th>Стд. откл.</th><th>CV%</th><th>Оценка</th></tr></thead>
          <tbody>
            {data.batches?.length > 0 ? data.batches.map(b => (
              <tr key={b.group_id}>
                <td><strong>{b.group_name}</strong></td>
                <td>{b.hall_name || '-'}</td>
                <td>{fmtDate(b.exit_date)}</td>
                <td>{b.head_count}</td>
                <td>{fmtNum(b.avg_weight, 1)} кг</td>
                <td>{b.stddev != null ? fmtNum(b.stddev, 2) : '-'}</td>
                <td><strong>{b.cv != null ? fmtNum(b.cv, 1) + '%' : '-'}</strong></td>
                <td>{b.cv != null ? <span className={`badge ${b.cv <= 10 ? 'green' : b.cv <= 15 ? 'yellow' : 'red'}`}>
                  {b.cv <= 10 ? 'OK' : b.cv <= 15 ? 'Внимание' : 'Проблем'}
                </span> : '-'}</td>
              </tr>
            )) : <tr><td colSpan={8} style={{textAlign:'center',color:'var(--text-secondary)'}}>Няма данни за приключени партиди</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

function FeedReport() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api('reports.feedEfficiency', {}).then(r => setData(r.feedEfficiency)).catch(console.error).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading">Зареждане...</div>
  if (!data) return <div className="loading">Няма данни</div>

  const totalTons = data.byRecipe?.reduce((s, r) => s + r.total_tons, 0) || 0
  const totalBatches = data.byRecipe?.reduce((s, r) => s + r.batch_count, 0) || 0
  const totalCost = data.costByMonth?.reduce((s, r) => s + r.cost_eur, 0) || 0
  const avgCostPerTon = totalTons > 0 ? totalCost / totalTons : 0

  return (
    <>
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <div className="stat-value">{fmtNum(totalTons, 1)}</div>
          <div className="stat-label">Общо тонове</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalBatches}</div>
          <div className="stat-label">Производствени партиди</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmtEur(totalCost)}</div>
          <div className="stat-label">Общ разход</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmtEur(avgCostPerTon)}</div>
          <div className="stat-label">Разход/тон</div>
        </div>
      </div>
      <div className="card">
        <h3>Производство по рецепта</h3>
        <table>
          <thead><tr><th>Месец</th><th>Рецепта</th><th>Партиди</th><th>Тонове</th><th>Фира %</th><th>Загуба (тон)</th></tr></thead>
          <tbody>
            {data.byRecipe?.length > 0 ? data.byRecipe.map((r, i) => (
              <tr key={i}>
                <td>{r.month}</td>
                <td><strong>{r.recipe}</strong></td>
                <td>{r.batch_count}</td>
                <td>{fmtNum(r.total_tons, 2)}</td>
                <td>{fmtNum(r.shrinkage_pct, 2)}%</td>
                <td>{fmtNum(r.theoretical_loss_tons, 3)}</td>
              </tr>
            )) : <tr><td colSpan={6} style={{textAlign:'center',color:'var(--text-secondary)'}}>Няма производствени данни</td></tr>}
          </tbody>
        </table>
      </div>
      {data.costByMonth?.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Разход по месец</h3>
          <table>
            <thead><tr><th>Месец</th><th>Тонове</th><th>Разход (€)</th><th>Разход/тон</th></tr></thead>
            <tbody>
              {data.costByMonth.map(r => (
                <tr key={r.month}>
                  <td>{r.month}</td>
                  <td>{fmtNum(r.tons, 2)}</td>
                  <td>{fmtEur(r.cost_eur)}</td>
                  <td>{fmtEur(r.cost_per_ton)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function HallReport() {
  const [data, setData] = useState(null)
  const [sectors, setSectors] = useState([])
  const [sectorId, setSectorId] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api('halls.list', {}).then(r => {
      const sectorMap = new Map()
      ;(r.halls || []).forEach(h => {
        if (!sectorMap.has(h.sector_id)) sectorMap.set(h.sector_id, { id: h.sector_id, name: h.sector_name })
      })
      const secs = [...sectorMap.values()]
      setSectors(secs)
      if (secs.length > 0 && !sectorId) setSectorId(String(secs[0].id))
    }).catch(console.error).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!sectorId) return
    setLoading(true)
    api('reports.hallComparison', { sector_id: parseInt(sectorId) })
      .then(r => setData(r.hallComparison))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [sectorId])

  return (
    <>
      <div className="filters">
        <select value={sectorId} onChange={e => setSectorId(e.target.value)}>
          {sectors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {loading ? <div className="loading">Зареждане...</div> : !data ? <div className="loading">Няма данни</div> : (
        <div className="card">
          <h3>Сравнение на халета — {data.sector?.name} ({data.period?.days} дни)</h3>
          <table>
            <thead>
              <tr>
                <th>#</th><th>Хале</th><th>Капацитет</th>
                {data.halls?.[0]?.avg_born_alive !== undefined && <><th>Ср. живородени</th><th>Ср. отбити</th><th>Смъртност %</th><th>Ср. тегло отбиване</th></>}
                {data.halls?.[0]?.avg_exit_weight !== undefined && <><th>Ср. тегло вход</th><th>Ср. тегло изход</th><th>Смъртност %</th></>}
              </tr>
            </thead>
            <tbody>
              {data.halls?.map((h, i) => (
                <tr key={h.hall_id}>
                  <td>{i + 1}</td>
                  <td><strong>{h.hall_name}</strong></td>
                  <td>{h.capacity}</td>
                  {h.avg_born_alive !== undefined && <>
                    <td>{h.avg_born_alive}</td>
                    <td>{h.avg_weaned}</td>
                    <td><span className={`badge ${parseFloat(h.mortality_pct) <= 8 ? 'green' : parseFloat(h.mortality_pct) <= 12 ? 'yellow' : 'red'}`}>{h.mortality_pct}%</span></td>
                    <td>{h.avg_weaning_weight} кг</td>
                  </>}
                  {h.avg_exit_weight !== undefined && <>
                    <td>{h.avg_entry_weight} кг</td>
                    <td>{h.avg_exit_weight} кг</td>
                    <td><span className={`badge ${parseFloat(h.mortality_pct) <= 3 ? 'green' : parseFloat(h.mortality_pct) <= 5 ? 'yellow' : 'red'}`}>{h.mortality_pct}%</span></td>
                  </>}
                </tr>
              ))}
              {(!data.halls || data.halls.length === 0) && <tr><td colSpan={7} style={{textAlign:'center',color:'var(--text-secondary)'}}>Няма халета в този сектор</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function InventoryReport({ user }) {
  const [data, setData] = useState(null)
  const [counts, setCounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCount, setShowCount] = useState(false)
  const [components, setComponents] = useState([])
  const [form, setForm] = useState({ component_id: '', counted_kg: '' })

  const load = async () => {
    setLoading(true)
    try {
      const [inv, cl] = await Promise.all([
        api('reports.inventoryVariance', {}),
        api('inventory.counts.list', { limit: 20 })
      ])
      setData(inv.inventoryVariance)
      setCounts(cl.counts || [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const loadComponents = async () => {
    try {
      const res = await api('feed.components')
      setComponents(res.components || [])
    } catch (e) { console.error(e) }
  }

  const submitCount = async (e) => {
    e.preventDefault()
    try {
      await api('inventory.count', {
        component_id: parseInt(form.component_id),
        counted_kg: parseFloat(form.counted_kg),
        counted_by: user?.id
      })
      setShowCount(false)
      setForm({ component_id: '', counted_kg: '' })
      load()
    } catch (err) { alert(err.message) }
  }

  if (loading) return <div className="loading">Зареждане...</div>

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={() => { loadComponents(); setShowCount(true) }}>+ Физическо броене</button>
      </div>

      {data?.components?.length > 0 && (
        <div className="card">
          <h3>Inventory Variance (Теоретичен vs Реален склад)</h3>
          <table>
            <thead><tr><th>Компонент</th><th>Теоретичен (кг)</th><th>Реален (кг)</th><th>Вариация (кг)</th><th>Вариация %</th><th>Статус</th></tr></thead>
            <tbody>
              {data.components.map(c => (
                <tr key={c.component_id}>
                  <td><strong>{c.name_bg || c.name}</strong></td>
                  <td>{fmtNum(c.theoretical_kg, 1)}</td>
                  <td>{c.counted_kg != null ? fmtNum(c.counted_kg, 1) : <span style={{color:'var(--text-secondary)'}}>Не е броено</span>}</td>
                  <td style={{color: c.variance_kg != null && c.variance_kg < 0 ? 'var(--danger)' : 'var(--success)'}}>{c.variance_kg != null ? fmtNum(c.variance_kg, 1) : '-'}</td>
                  <td><strong>{c.variance_pct != null ? fmtNum(c.variance_pct, 2) + '%' : '-'}</strong></td>
                  <td><span className={`badge ${c.status === 'no_count' ? 'grey' : c.status}`}>
                    {c.status === 'no_count' ? 'Няма' : c.status === 'green' ? 'OK' : c.status === 'yellow' ? 'Внимание' : 'Проблем'}
                  </span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {counts.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Последни броения</h3>
          <table>
            <thead><tr><th>Дата</th><th>Компонент</th><th>Броено (кг)</th><th>Теоретичен (кг)</th><th>Вариация %</th><th>Бележки</th></tr></thead>
            <tbody>
              {counts.map(c => (
                <tr key={c.id}>
                  <td>{fmtDate(c.count_date)}</td>
                  <td>{c.component_name_bg || c.component_name}</td>
                  <td>{fmtNum(c.counted_kg, 1)}</td>
                  <td>{fmtNum(c.theoretical_kg, 1)}</td>
                  <td><span className={`badge ${Math.abs(parseFloat(c.variance_pct||0)) <= 2 ? 'green' : Math.abs(parseFloat(c.variance_pct||0)) <= 5 ? 'yellow' : 'red'}`}>{fmtNum(c.variance_pct, 2)}%</span></td>
                  <td>{c.notes || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Physical Count Modal */}
      {showCount && (
        <div className="modal-overlay" onClick={() => setShowCount(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Физическо броене</h2>
            <form onSubmit={submitCount}>
              <div className="form-group">
                <label>Компонент</label>
                <select value={form.component_id} onChange={e => setForm(p => ({ ...p, component_id: e.target.value }))} required>
                  <option value="">-- Изберете --</option>
                  {components.map(c => (
                    <option key={c.id} value={c.id}>{c.name_bg || c.name} (теор: {fmtNum(c.current_stock_kg, 0)} кг)</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Реално налично (кг)</label>
                <input type="number" step="0.01" min="0" value={form.counted_kg} onChange={e => setForm(p => ({ ...p, counted_kg: e.target.value }))} required />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowCount(false)}>Отказ</button>
                <button type="submit" className="btn btn-primary">Запиши</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

// ═══ Truck Efficiency Report (Spec Section V.В.3 — Big 5 #3) ═══
function TruckEfficiencyReport() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api('reports.truckEfficiency', {}).then(r => setData(r.truckEfficiency)).catch(console.error).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading">Зареждане...</div>
  if (!data) return <div className="loading">Няма данни</div>

  return (
    <>
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="stat-card"><div className="stat-value">{data.trucks?.length || 0}</div><div className="stat-label">Фуражовоза</div></div>
        <div className="stat-card"><div className="stat-value">{data.totals?.routes || 0}</div><div className="stat-label">Общо курсове</div></div>
        <div className="stat-card"><div className="stat-value">{fmtNum(data.totals?.tons, 1)}</div><div className="stat-label">Общо тонове</div></div>
        <div className="stat-card"><div className="stat-value">{fmtNum(data.totals?.km, 0)}</div><div className="stat-label">Общо км</div></div>
      </div>
      <div className="card">
        <h3>Ефективност на фуражовозите ({data.from} - {data.to})</h3>
        <table>
          <thead><tr><th>Рег. номер</th><th>Шофьор</th><th>Капацитет (т)</th><th>Курсове</th><th>Тонове</th><th>Ср. т/курс</th><th>Км</th><th>Часове</th></tr></thead>
          <tbody>
            {data.trucks?.length > 0 ? data.trucks.map(t => (
              <tr key={t.id}>
                <td><strong>{t.plate_number}</strong></td>
                <td>{t.driver_name || '-'}</td>
                <td>{fmtNum(t.capacity_tons, 1)}</td>
                <td>{t.completed_routes}</td>
                <td>{fmtNum(t.total_tons_delivered, 1)}</td>
                <td>{fmtNum(t.avg_tons_per_route, 2)}</td>
                <td>{fmtNum(t.total_km, 0)}</td>
                <td>{fmtNum(t.total_hours, 1)}</td>
              </tr>
            )) : <tr><td colSpan={8} style={{textAlign:'center',color:'var(--text-secondary)'}}>Няма завършени маршрути</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ═══ Mortality by Monetary Value Report (Spec Section IV.Д) ═══
function MortalityValueReport() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api('reports.mortalityValue', {}).then(r => setData(r.mortalityValue)).catch(console.error).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading">Зареждане...</div>
  if (!data) return <div className="loading">Няма данни</div>

  const CAT_BG = { suckling_piglet: 'Бозайник', weaner: 'Подрастващо', finisher: 'Угояване', gilt: 'Ремонтна', sow: 'Майка', boar: 'Нерез' }

  return (
    <>
      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className={`stat-card ${data.totalCount > 0 ? 'red' : 'green'}`}>
          <div className="stat-value">{data.totalCount}</div>
          <div className="stat-label">Умрели животни</div>
        </div>
        <div className="stat-card red">
          <div className="stat-value">{fmtEur(data.totalValueEur)}</div>
          <div className="stat-label">Загуба (€)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmtNum(data.totalValueEur, 0)} EUR</div>
          <div className="stat-label">Загуба (евро)</div>
        </div>
      </div>

      {data.bySector?.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Загуби по сектор</h3>
          <table>
            <thead><tr><th>Сектор</th><th>Брой</th><th>Стойност (€)</th></tr></thead>
            <tbody>
              {data.bySector.map(s => (
                <tr key={s.sector}><td><strong>{s.sector}</strong></td><td>{s.count}</td><td style={{color:'var(--danger)'}}>{fmtEur(s.valueEur)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.byCategory?.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Загуби по категория</h3>
          <table>
            <thead><tr><th>Категория</th><th>Брой</th><th>Стойност (€)</th><th>Ест. цена/бр (€)</th></tr></thead>
            <tbody>
              {data.byCategory.map(c => (
                <tr key={c.category}>
                  <td><strong>{CAT_BG[c.category] || c.category}</strong></td>
                  <td>{c.count}</td>
                  <td style={{color:'var(--danger)'}}>{fmtEur(c.valueEur)}</td>
                  <td>{fmtEur(data.costEstimates?.[c.category] || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.byDate?.length > 0 && (
        <div className="card">
          <h3>Загуби по дата</h3>
          <table>
            <thead><tr><th>Дата</th><th>Брой</th><th>Стойност (€)</th></tr></thead>
            <tbody>
              {data.byDate.map(d => (
                <tr key={d.date}><td>{fmtDate(d.date)}</td><td>{d.count}</td><td style={{color:'var(--danger)'}}>{fmtEur(d.valueEur)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ═══ Daily Input/Output Report (Spec Section IV.Д) ═══
function DailyIOReport() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])

  const load = () => {
    setLoading(true)
    api('reports.dailyIO', { date }).then(r => setData(r.dailyIO)).catch(console.error).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [date])

  if (loading) return <div className="loading">Зареждане...</div>
  if (!data) return <div className="loading">Няма данни</div>

  return (
    <>
      <div className="filters" style={{ marginBottom: 16 }}>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} />
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16, gap: 16 }}>
        <div className="card">
          <h3 style={{ color: 'var(--success)' }}>ВХОД (Input)</h3>
          <table>
            <tbody>
              <tr><td>Произведен фураж</td><td><strong>{fmtNum(data.input?.feedProducedTons, 2)} т</strong> ({data.input?.feedProductionBatches} партиди)</td></tr>
              <tr><td>Доставен фураж (по халета)</td><td><strong>{fmtNum(data.input?.feedDeliveredTons, 2)} т</strong> ({data.input?.deliveryRoutes} маршрута)</td></tr>
              <tr><td>Разход суровини</td><td><strong>{fmtEur(data.input?.rawMaterialsCostEur)}</strong></td></tr>
              <tr><td>Живородени</td><td><strong>{data.input?.bornAlive}</strong></td></tr>
              <tr><td>Мъртвородени</td><td>{data.input?.bornDead}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3 style={{ color: 'var(--danger)' }}>ИЗХОД (Output)</h3>
          <table>
            <tbody>
              <tr><td>Продадени (глави)</td><td><strong>{data.output?.soldHeads}</strong></td></tr>
              <tr><td>Продадени (кг)</td><td><strong>{fmtNum(data.output?.soldKg, 1)} кг</strong></td></tr>
              <tr><td>Приход от продажби</td><td><strong>{fmtEur(data.output?.soldRevenueEur)}</strong></td></tr>
              <tr><td>Умрели</td><td style={{color: data.output?.deaths > 0 ? 'var(--danger)' : undefined}}><strong>{data.output?.deaths}</strong></td></tr>
              <tr><td>Ест. прираст (кг)</td><td><strong>{fmtNum(data.output?.estimatedWeightGainKg, 0)} кг</strong></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Баланс</h3>
        <table>
          <tbody>
            <tr><td>Текущ брой животни</td><td><strong>{data.balance?.currentAnimalCount}</strong></td></tr>
            <tr><td>Финишъри в производство</td><td><strong>{data.balance?.finishersInProduction}</strong></td></tr>
          </tbody>
        </table>
      </div>
    </>
  )
}
