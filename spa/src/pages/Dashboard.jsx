import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.js'

const STATUS_BG = {
  awaiting_breeding: 'Очаква заплождане', inseminated: 'Осеменена', pregnant_confirmed: 'Бременна',
  in_farrowing: 'В родилно', lactating: 'Лактираща', weaned_resting: 'Отбита/Почивка',
  culled: 'Бракувана', active: 'Активен'
}
const CAT_BG = {
  gilt: 'Ремонтни', sow: 'Свине майки', boar: 'Нерези',
  suckling_piglet: 'Бозайници', weaner: 'Подрастващи', finisher: 'Угояване'
}

function fmtDate(d) {
  if (!d) return '-'
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}`
}
function fmtBgn(v) { return v != null ? Number(v).toLocaleString('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' лв' : '-' }

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api('dashboard').then(setData).catch(console.error).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading">Зареждане...</div>
  if (!data) return <div className="loading">Грешка при зареждане на данните</div>

  const totalAnimals = data.totalByCategory?.reduce((s, r) => s + parseInt(r.count), 0) || 0
  const totalAlerts = data.alertCounts?.reduce((s, r) => s + parseInt(r.count), 0) || 0
  const criticalAlerts = data.alertCounts?.find(a => a.severity === 'critical')?.count || 0

  return (
    <>
      <div className="page-header">
        <h1>Табло за управление</h1>
        <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{fmtDate(new Date())}</span>
      </div>

      {/* Summary stats */}
      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        <div className="stat-card green">
          <div className="stat-value">{totalAnimals}</div>
          <div className="stat-label">Общо животни</div>
        </div>
        <div className={`stat-card ${criticalAlerts > 0 ? 'red' : 'green'}`}>
          <div className="stat-value">{totalAlerts}</div>
          <div className="stat-label">Активни аларми</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{data.feedSummary?.below_threshold || 0}</div>
          <div className="stat-label">Фуражи под минимума</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{data.totalByCategory?.find(c => c.category === 'sow')?.count || 0}</div>
          <div className="stat-label">Свине майки</div>
        </div>
      </div>

      <div className="grid grid-2">
        {/* KPIs */}
        <div className="card">
          <h3>Производствени KPI</h3>
          {data.kpis?.length > 0 ? (
            <table>
              <thead><tr><th>Показател</th><th>Стойност</th><th>Цел</th><th>Статус</th></tr></thead>
              <tbody>
                {data.kpis.map(k => (
                  <tr key={k.name}>
                    <td>{k.label}</td>
                    <td><strong>{k.value !== null ? k.value : '-'}</strong> {k.unit}</td>
                    <td>{k.lowerIsBetter ? '<' : ''}{k.target} {k.unit}</td>
                    <td><span className={`badge ${k.color}`}>{k.color === 'green' ? 'OK' : k.color === 'yellow' ? 'Внимание' : k.color === 'red' ? 'Проблем' : '-'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{color:'var(--text-secondary)'}}>Няма KPI данни. Стартирайте преизчисляване.</p>}
        </div>

        {/* Alerts */}
        <div className="card">
          <h3>Последни аларми <Link to="/alerts" style={{fontSize:12,float:'right'}}>Виж всички</Link></h3>
          {data.recentAlerts?.length > 0 ? data.recentAlerts.map(a => (
            <div key={a.id} className={`alert-item ${a.severity}`}>
              <div className="alert-msg">{a.message}</div>
              <div className="alert-time">{fmtDate(a.created_at)}</div>
            </div>
          )) : <p style={{color:'var(--text-secondary)'}}>Няма активни аларми.</p>}
        </div>
      </div>

      {/* Financial summary */}
      {data.finance && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Финансови показатели <Link to="/finance" style={{fontSize:12,float:'right'}}>Пълен отчет</Link></h3>
          <div className="grid grid-4" style={{ marginBottom: 16 }}>
            <div className="stat-card green">
              <div className="stat-value" style={{fontSize:20}}>{fmtBgn(data.finance.revenue)}</div>
              <div className="stat-label">Приходи ({data.finance.month})</div>
            </div>
            <div className="stat-card red">
              <div className="stat-value" style={{fontSize:20}}>{fmtBgn(data.finance.expenses)}</div>
              <div className="stat-label">Разходи</div>
            </div>
            <div className={`stat-card ${data.finance.profit >= 0 ? 'green' : 'red'}`}>
              <div className="stat-value" style={{fontSize:20}}>{fmtBgn(data.finance.profit)}</div>
              <div className="stat-label">Печалба</div>
            </div>
            <div className={`stat-card ${data.finance.margin >= 15 ? 'green' : data.finance.margin >= 5 ? 'yellow' : 'red'}`}>
              <div className="stat-value" style={{fontSize:20}}>{data.finance.margin?.toFixed(1)}%</div>
              <div className="stat-label">Опер. марж</div>
            </div>
          </div>
          {data.finance.kpis?.length > 0 && (
            <table>
              <thead><tr><th>KPI</th><th>Стойност</th><th>Цел</th><th>Статус</th></tr></thead>
              <tbody>
                {data.finance.kpis.map(k => (
                  <tr key={k.name}>
                    <td>{k.label}</td>
                    <td><strong>{k.value != null ? k.value : '-'}</strong> {k.unit}</td>
                    <td>{k.lowerIsBetter ? '<' : '>'} {k.target} {k.unit}</td>
                    <td><span className={`badge ${k.color}`}>{k.color === 'green' ? 'OK' : k.color === 'yellow' ? 'Внимание' : 'Проблем'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Employee profitability & Water monitoring — Spec Final Package #7 (GAD Dashboard) */}
      <div className="grid grid-2" style={{ marginTop: 16, gap: 16 }}>
        {data.employeeProfit && (
          <div className="card">
            <h3>Доходност на служител (GAD) <Link to="/reports" style={{fontSize:12,float:'right'}}>Пълен отчет</Link></h3>
            <div className="grid grid-2" style={{ marginBottom: 8 }}>
              <div className={`stat-card ${data.employeeProfit.profitPerEmployee >= 0 ? 'green' : 'red'}`}>
                <div className="stat-value" style={{fontSize:18}}>{fmtBgn(data.employeeProfit.profitPerEmployee)}</div>
                <div className="stat-label">Печалба/служител</div>
              </div>
              <div className="stat-card blue">
                <div className="stat-value" style={{fontSize:18}}>{fmtBgn(data.employeeProfit.revenuePerEmployee)}</div>
                <div className="stat-label">Приход/служител</div>
              </div>
            </div>
            <table>
              <tbody>
                <tr><td>Персонал</td><td><strong>{data.employeeProfit.totalStaff}</strong> души</td></tr>
                <tr><td>Разход труд/кг месо</td><td><strong>{fmtBgn(data.employeeProfit.labourCostPerKg)}</strong>/кг</td></tr>
              </tbody>
            </table>
          </div>
        )}

        {data.water && (
          <div className="card">
            <h3>Мониторинг вода</h3>
            <div className="grid grid-3" style={{ marginBottom: 8 }}>
              <div className="stat-card blue">
                <div className="stat-value" style={{fontSize:18}}>{data.water.todayReadings}</div>
                <div className="stat-label">Отчитания днес</div>
              </div>
              <div className={`stat-card ${data.water.alertsToday > 0 ? 'red' : 'green'}`}>
                <div className="stat-value" style={{fontSize:18}}>{data.water.alertsToday}</div>
                <div className="stat-label">Аларми вода</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{fontSize:18}}>{data.water.avgConsumption} m3</div>
                <div className="stat-label">Ср. консумация (7д)</div>
              </div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Спад {">"} 15% за 24ч задейства аларма за възможна инфекция (ПРРС/Грип)</p>
          </div>
        )}
      </div>

      {/* Logistics summary */}
      {data.logistics && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Логистика <Link to="/logistics" style={{fontSize:12,float:'right'}}>Управление</Link></h3>
          <div className="grid grid-4">
            <div className="stat-card green">
              <div className="stat-value" style={{fontSize:20}}>{data.logistics.vehicles?.clean || 0}</div>
              <div className="stat-label">Чисти МПС</div>
            </div>
            <div className={`stat-card ${data.logistics.vehicles?.dirty > 0 ? 'red' : 'green'}`}>
              <div className="stat-value" style={{fontSize:20}}>{data.logistics.vehicles?.dirty || 0}</div>
              <div className="stat-label">Мръсни МПС</div>
            </div>
            <div className={`stat-card ${data.logistics.lowSilos > 0 ? 'red' : 'green'}`}>
              <div className="stat-value" style={{fontSize:20}}>{data.logistics.lowSilos}</div>
              <div className="stat-label">Силози под мин.</div>
            </div>
            <div className="stat-card blue">
              <div className="stat-value" style={{fontSize:20}}>{data.logistics.pendingDispatches}</div>
              <div className="stat-label"><Link to="/dispatch" style={{color:'inherit'}}>Предст. експедиции</Link></div>
            </div>
          </div>
        </div>
      )}

      {/* Biosecurity summary */}
      {data.biosecurity && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Биосигурност <Link to="/biosecurity" style={{fontSize:12,float:'right'}}>Управление</Link></h3>
          <div className="grid grid-3">
            <div className={`stat-card ${data.biosecurity.violationsToday > 0 ? 'red' : 'green'}`}>
              <div className="stat-value" style={{fontSize:20}}>{data.biosecurity.violationsToday}</div>
              <div className="stat-label">Нарушения днес</div>
            </div>
            <div className={`stat-card ${data.biosecurity.activeWithdrawals > 0 ? 'red' : 'green'}`}>
              <div className="stat-value" style={{fontSize:20}}>{data.biosecurity.activeWithdrawals}</div>
              <div className="stat-label">Активни кар. срокове</div>
            </div>
            <div className={`stat-card ${data.biosecurity.hallsInHygiene > 0 ? 'yellow' : 'green'}`}>
              <div className="stat-value" style={{fontSize:20}}>{data.biosecurity.hallsInHygiene}</div>
              <div className="stat-label">Халета в хигиена</div>
            </div>
          </div>
        </div>
      )}

      {/* Bonuses summary */}
      {data.bonuses && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>KPI Бонуси ({data.bonuses.currentMonth}) <Link to="/bonuses" style={{fontSize:12,float:'right'}}>Управление</Link></h3>
          <div className="grid grid-3">
            <div className="stat-card blue">
              <div className="stat-value" style={{fontSize:20}}>{data.bonuses.calculated}</div>
              <div className="stat-label">Изчислени</div>
            </div>
            <div className="stat-card green">
              <div className="stat-value" style={{fontSize:20}}>{data.bonuses.approved}</div>
              <div className="stat-label">Одобрени</div>
            </div>
            <div className="stat-card green">
              <div className="stat-value" style={{fontSize:18}}>{fmtBgn(data.bonuses.totalBonusBgn)}</div>
              <div className="stat-label">Общо бонуси</div>
            </div>
          </div>
        </div>
      )}

      {/* Traceability summary */}
      {data.traceability && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Проследимост <Link to="/traceability" style={{fontSize:12,float:'right'}}>Документи</Link></h3>
          <div className="grid grid-2">
            <div className="stat-card blue">
              <div className="stat-value" style={{fontSize:20}}>{data.traceability.totalRecords}</div>
              <div className="stat-label">Проследени партиди</div>
            </div>
            <div className="stat-card blue">
              <div className="stat-value" style={{fontSize:20}}>{data.traceability.totalDocuments}</div>
              <div className="stat-label">Регулаторни документи</div>
            </div>
          </div>
          {data.traceability.recentDocuments?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <small style={{ color: 'var(--text-secondary)' }}>Последни:</small>
              {data.traceability.recentDocuments.map(d => (
                <div key={d.id} style={{ fontSize: 12, padding: '2px 0' }}>
                  <span className={`badge ${d.status === 'final' ? 'blue' : d.status === 'submitted' ? 'green' : 'yellow'}`} style={{ marginRight: 4 }}>{d.status}</span>
                  {d.reference_number} — {d.title}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Animals by category */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Животни по категория и статус</h3>
        <div className="grid grid-3">
          {data.totalByCategory?.map(c => (
            <div key={c.category} className="stat-card" style={{ textAlign: 'left', padding: '12px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>{CAT_BG[c.category] || c.category}</strong>
                <span className="badge blue">{c.count}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                {data.animalCounts?.filter(a => a.category === c.category).map(a =>
                  `${STATUS_BG[a.status] || a.status}: ${a.count}`
                ).join(' | ')}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Halls overview */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Запълване на халета <Link to="/halls" style={{fontSize:12,float:'right'}}>Управление</Link></h3>
        <table>
          <thead><tr><th>Хале</th><th>Сектор</th><th>Животни</th><th>Капацитет</th><th>Запълване</th></tr></thead>
          <tbody>
            {data.animalsByHall?.map(h => {
              const pct = h.capacity > 0 ? Math.round(parseInt(h.animal_count) / h.capacity * 100) : 0
              return (
                <tr key={h.id}>
                  <td><strong>{h.hall_name}</strong></td>
                  <td>{h.sector_name}</td>
                  <td>{h.animal_count}</td>
                  <td>{h.capacity}</td>
                  <td>
                    <div style={{ background: '#eee', borderRadius: 4, height: 8, width: 80 }}>
                      <div style={{ background: pct > 90 ? 'var(--danger)' : pct > 70 ? 'var(--warning)' : 'var(--success)', borderRadius: 4, height: 8, width: `${Math.min(pct, 100)}%` }} />
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{pct}%</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
