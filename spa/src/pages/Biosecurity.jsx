import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

function fmtDate(d) { if (!d) return '-'; const dt = new Date(d); return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}` }
function fmtDateTime(d) { if (!d) return '-'; const dt = new Date(d); return `${fmtDate(d)} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}` }

const STATUS_BG = { open: 'Отворено', resolved: 'Решено', active: 'Активен', expired: 'Изтекъл', cleared: 'Изчистен', started: 'Стартирана', cleaning: 'Почистване', disinfection: 'Дезинфекция', completed: 'Завършена', cancelled: 'Отменена' }
const STATUS_COLOR = { open: 'red', resolved: 'green', active: 'red', expired: 'grey', cleared: 'green', started: 'yellow', cleaning: 'yellow', disinfection: 'blue', completed: 'green', cancelled: 'grey' }

export default function Biosecurity() {
  const { user } = useAuth()
  const [tab, setTab] = useState('access')
  const [loading, setLoading] = useState(true)

  // Access tab
  const [accessHistory, setAccessHistory] = useState([])
  const [halls, setHalls] = useState([])
  const [personnel, setPersonnel] = useState([])
  const [accessForm, setAccessForm] = useState({})
  const [check48h, setCheck48h] = useState(null)

  // Violations tab
  const [violations, setViolations] = useState([])

  // Hygiene tab
  const [hygieneStatuses, setHygieneStatuses] = useState([])

  // Withdrawals tab
  const [withdrawals, setWithdrawals] = useState([])
  const [medWithdrawals, setMedWithdrawals] = useState([])

  // Heatmap tab
  const [heatmap, setHeatmap] = useState(null)

  // Locations tab
  const [locations, setLocations] = useState([])

  const loadData = async () => {
    setLoading(true)
    try {
      const [h, p] = await Promise.all([
        api('halls.list'),
        api('personnel.list')
      ])
      setHalls(h.halls || [])
      setPersonnel(p.personnel || [])
      if (tab === 'access') {
        const hist = await api('access.history', { limit: 50 })
        setAccessHistory(hist.history || [])
      } else if (tab === 'violations') {
        const v = await api('biosecurity.violations', { status: 'open' })
        setViolations(v.violations || [])
      } else if (tab === 'hygiene') {
        const hs = await api('hall.hygieneStatus', {})
        setHygieneStatuses(hs.pauses || [])
      } else if (tab === 'withdrawals') {
        const [aw, mw] = await Promise.all([
          api('withdrawal.active', {}),
          api('medicine.withdrawals')
        ])
        setWithdrawals(aw.withdrawals || [])
        setMedWithdrawals(mw.withdrawals || [])
      } else if (tab === 'heatmap') {
        const res = await api('biosecurity.heatmap', {})
        setHeatmap(res.heatmap || null)
      } else if (tab === 'locations') {
        const res = await api('access.currentLocations', {})
        setLocations(res.locations || [])
      }
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { loadData() }, [tab])

  const logAccess = async (e) => {
    e.preventDefault()
    try {
      const res = await api('access.log', {
        personnel_id: parseInt(accessForm.personnel_id),
        hall_id: parseInt(accessForm.hall_id),
        access_action: accessForm.access_action || 'entry',
        method: 'manual',
        shower_confirmed: accessForm.shower_confirmed || false,
        override: accessForm.override || false,
        override_reason: accessForm.override_reason
      })
      if (res.warning) alert(res.warning)
      setAccessForm({})
      loadData()
    } catch (err) { alert(err.message) }
  }

  const doCheck48h = async () => {
    if (!accessForm.personnel_id) return
    try {
      const res = await api('access.check48h', { personnel_id: parseInt(accessForm.personnel_id) })
      setCheck48h(res)
    } catch (e) { alert(e.message) }
  }

  const resolveViolation = async (id) => {
    try {
      await api('biosecurity.resolve', { id, resolved_by: user?.id, resolution_notes: 'Решено от оператор' })
      loadData()
    } catch (e) { alert(e.message) }
  }

  const startHygiene = async (hallId) => {
    try {
      await api('hall.startHygiene', { hall_id: hallId, started_by: user?.id })
      loadData()
    } catch (e) { alert(e.message) }
  }

  const confirmHygiene = async (id, step) => {
    try {
      await api('hall.confirmHygiene', { id, step, confirmed_by: user?.id })
      loadData()
    } catch (e) { alert(e.message) }
  }

  const clearWithdrawal = async (id) => {
    try {
      await api('withdrawal.clear', { id, cleared_by: user?.id, reason: 'Ръчно изчистен' })
      loadData()
    } catch (e) { alert(e.message) }
  }

  if (loading) return <div className="loading">Зареждане...</div>

  return (
    <>
      <div className="page-header">
        <h1>Биосигурност</h1>
      </div>

      <div className="tabs" style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[['access', 'Достъп'], ['violations', 'Нарушения'], ['hygiene', 'Хигиена халета'], ['withdrawals', 'Карентни срокове'], ['heatmap', 'Heatmap'], ['locations', 'Текущи позиции']].map(([key, label]) => (
          <button key={key} className={`btn ${tab === key ? 'primary' : ''}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {/* ACCESS TAB */}
      {tab === 'access' && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3>Регистрация на достъп</h3>
            <form onSubmit={logAccess} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
              <div>
                <label>Персонал</label>
                <select value={accessForm.personnel_id || ''} onChange={e => setAccessForm({ ...accessForm, personnel_id: e.target.value })} required>
                  <option value="">-- Изберете --</option>
                  {personnel.map(p => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
                </select>
              </div>
              <div>
                <label>Хале</label>
                <select value={accessForm.hall_id || ''} onChange={e => setAccessForm({ ...accessForm, hall_id: e.target.value })} required>
                  <option value="">-- Изберете --</option>
                  {halls.map(h => <option key={h.id} value={h.id}>{h.name} ({h.sector_name})</option>)}
                </select>
              </div>
              <div>
                <label>Действие</label>
                <select value={accessForm.access_action || 'entry'} onChange={e => setAccessForm({ ...accessForm, access_action: e.target.value })}>
                  <option value="entry">Вход</option>
                  <option value="exit">Изход</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn" onClick={doCheck48h}>Провери 48h</button>
                <button type="submit" className="btn primary">Запиши</button>
              </div>
            </form>
            <div style={{ marginTop: 8 }}>
              <label><input type="checkbox" checked={accessForm.shower_confirmed || false} onChange={e => setAccessForm({ ...accessForm, shower_confirmed: e.target.checked })} /> Душ потвърден</label>
              <label style={{ marginLeft: 16 }}><input type="checkbox" checked={accessForm.override || false} onChange={e => setAccessForm({ ...accessForm, override: e.target.checked })} /> Override</label>
              {accessForm.override && <input placeholder="Причина за override" value={accessForm.override_reason || ''} onChange={e => setAccessForm({ ...accessForm, override_reason: e.target.value })} style={{ marginLeft: 8, width: 250 }} />}
            </div>
            {check48h && (
              <div className={`alert-item ${check48h.allowed ? 'info' : 'critical'}`} style={{ marginTop: 8 }}>
                {check48h.allowed ? '✅ Достъпът е разрешен' : `⚠️ БЛОКИРАН: ${check48h.reason || 'Посещение на FIN < 48h'}`}
                {check48h.recentAccess?.length > 0 && (
                  <div style={{ fontSize: 12, marginTop: 4 }}>Последни: {check48h.recentAccess.map(a => `${a.hall_name} (${fmtDateTime(a.created_at)})`).join(', ')}</div>
                )}
              </div>
            )}
          </div>

          <div className="card">
            <h3>История на достъп</h3>
            <table>
              <thead><tr><th>Дата/час</th><th>Персонал</th><th>Хале</th><th>Сектор</th><th>Действие</th><th>Душ</th></tr></thead>
              <tbody>
                {accessHistory.map(a => (
                  <tr key={a.id}>
                    <td>{fmtDateTime(a.created_at)}</td>
                    <td>{a.personnel_name}</td>
                    <td>{a.hall_name}</td>
                    <td>{a.sector_code}</td>
                    <td>{a.action === 'entry' ? 'Вход' : 'Изход'}</td>
                    <td>{a.shower_confirmed ? '✅' : '❌'}</td>
                  </tr>
                ))}
                {accessHistory.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Няма записи</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIOLATIONS TAB */}
      {tab === 'violations' && (
        <div className="card">
          <h3>Нарушения на биосигурността</h3>
          <table>
            <thead><tr><th>Дата</th><th>Тип</th><th>Описание</th><th>Персонал</th><th>Статус</th><th></th></tr></thead>
            <tbody>
              {violations.map(v => (
                <tr key={v.id}>
                  <td>{fmtDateTime(v.created_at)}</td>
                  <td>{v.violation_type}</td>
                  <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.description}</td>
                  <td>{v.personnel_name}</td>
                  <td><span className={`badge ${STATUS_COLOR[v.status]}`}>{STATUS_BG[v.status]}</span></td>
                  <td>{v.status === 'open' && <button className="btn small" onClick={() => resolveViolation(v.id)}>Реши</button>}</td>
                </tr>
              ))}
              {violations.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Няма отворени нарушения</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* HYGIENE TAB */}
      {tab === 'hygiene' && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3>Стартирай хигиенна пауза</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {halls.map(h => (
                <button key={h.id} className="btn small" onClick={() => startHygiene(h.id)} title={h.name}>
                  {h.name}
                </button>
              ))}
            </div>
          </div>
          <div className="card">
            <h3>Активни хигиенни паузи</h3>
            <table>
              <thead><tr><th>Хале</th><th>Начало</th><th>Дни</th><th>Почистване</th><th>Дезинфекция</th><th>Статус</th><th></th></tr></thead>
              <tbody>
                {hygieneStatuses.map(p => (
                  <tr key={p.id}>
                    <td><strong>{p.hall_name}</strong></td>
                    <td>{fmtDate(p.start_date)}</td>
                    <td>{p.required_days}</td>
                    <td>{p.cleaning_confirmed ? `✅ ${fmtDate(p.cleaning_confirmed_at)}` : '⏳ Не'}</td>
                    <td>{p.disinfection_confirmed ? `✅ ${fmtDate(p.disinfection_confirmed_at)}` : '⏳ Не'}</td>
                    <td><span className={`badge ${STATUS_COLOR[p.status]}`}>{STATUS_BG[p.status]}</span></td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      {!p.cleaning_confirmed && <button className="btn small" onClick={() => confirmHygiene(p.id, 'cleaning')}>Почисти</button>}
                      {p.cleaning_confirmed && !p.disinfection_confirmed && <button className="btn small" onClick={() => confirmHygiene(p.id, 'disinfection')}>Дезинф.</button>}
                      {p.disinfection_confirmed && p.status !== 'completed' && <button className="btn small primary" onClick={() => confirmHygiene(p.id, 'complete')}>Завърши</button>}
                    </td>
                  </tr>
                ))}
                {hygieneStatuses.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Няма активни паузи</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* WITHDRAWALS TAB */}
      {tab === 'withdrawals' && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3>Карентни срокове по медикамент</h3>
            <table>
              <thead><tr><th>Медикамент</th><th>Дни</th><th>Приложимо за</th><th>Бележки</th></tr></thead>
              <tbody>
                {medWithdrawals.map(m => (
                  <tr key={m.id}>
                    <td><strong>{m.medicine_name_bg || m.medicine_name}</strong></td>
                    <td><span className={`badge ${m.withdrawal_days > 0 ? 'red' : 'green'}`}>{m.withdrawal_days} дни</span></td>
                    <td>{m.applies_to}</td>
                    <td>{m.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>Активни карентни срокове</h3>
            <table>
              <thead><tr><th>Група/Животно</th><th>Медикамент</th><th>Начало</th><th>Край</th><th>Статус</th><th></th></tr></thead>
              <tbody>
                {withdrawals.map(w => (
                  <tr key={w.id}>
                    <td>{w.group_name || w.animal_ear_tag || '-'}</td>
                    <td>{w.medicine_name_bg || w.medicine_name}</td>
                    <td>{fmtDate(w.start_date)}</td>
                    <td>{fmtDate(w.end_date)}</td>
                    <td><span className={`badge ${STATUS_COLOR[w.status]}`}>{STATUS_BG[w.status]}</span></td>
                    <td>{w.status === 'active' && <button className="btn small" onClick={() => clearWithdrawal(w.id)}>Изчисти</button>}</td>
                  </tr>
                ))}
                {withdrawals.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Няма активни карентни срокове</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* HEATMAP TAB — Spec Section V.Б: Staff movement heatmap */}
      {tab === 'heatmap' && (
        <div>
          {heatmap ? (
            <>
              <div className="card" style={{ marginBottom: 16 }}>
                <h3>Карта на движение на персонала ({heatmap.from} - {heatmap.to})</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 8 }}>Брой влизания по служител/хале. Потенциални нарушения на биосигурността са маркирани.</p>
                {heatmap.entries?.length > 0 ? (
                  <table>
                    <thead><tr><th>Служител</th><th>Хале</th><th>Влизания</th><th>Нарушения</th></tr></thead>
                    <tbody>
                      {heatmap.entries.map((e, i) => {
                        const viol = heatmap.violations?.find(v => v.personnel_id === e.personnel_id && v.hall_id === e.hall_id)
                        return (
                          <tr key={i} style={viol ? { background: 'var(--danger-bg, rgba(255,0,0,0.05))' } : undefined}>
                            <td><strong>{e.personnel_name}</strong></td>
                            <td>{e.hall_name}</td>
                            <td>
                              <span style={{
                                display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                                background: parseInt(e.entries) > 10 ? 'var(--danger, #dc3545)' : parseInt(e.entries) > 5 ? 'var(--warning, #ffc107)' : 'var(--success, #28a745)',
                                color: parseInt(e.entries) > 5 ? '#000' : '#fff'
                              }}>
                                {e.entries}
                              </span>
                            </td>
                            <td>{viol ? <span className="badge red">{viol.violation_count}</span> : '-'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                ) : <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Няма записи за достъп в периода</p>}
              </div>
              {heatmap.violations?.length > 0 && (
                <div className="card">
                  <h3 style={{ color: 'var(--danger)' }}>Нарушения по служител</h3>
                  <table>
                    <thead><tr><th>Служител</th><th>Хале</th><th>Нарушения</th></tr></thead>
                    <tbody>
                      {heatmap.violations.map((v, i) => (
                        <tr key={i}>
                          <td><strong>{v.personnel_name}</strong></td>
                          <td>{v.hall_name || '-'}</td>
                          <td><span className="badge red">{v.violation_count}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Няма данни за heatmap</p>}
        </div>
      )}

      {/* CURRENT LOCATIONS TAB — Spec Section VI.А: Real-time staff positions */}
      {tab === 'locations' && (
        <div className="card">
          <h3>Текущи позиции на персонала (последни 12 часа)</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 8 }}>Показва последното хале с действие "Вход" за всеки служител.</p>
          {locations.length > 0 ? (
            <table>
              <thead><tr><th>Служител</th><th>Длъжност</th><th>Хале</th><th>Сектор</th><th>Зона</th><th>Последен вход</th></tr></thead>
              <tbody>
                {locations.map(l => (
                  <tr key={l.personnel_id}>
                    <td><strong>{l.personnel_name}</strong></td>
                    <td>{l.role}</td>
                    <td>{l.hall_name}</td>
                    <td>{l.sector_name}</td>
                    <td><span className={`badge ${l.zone === 'black' ? 'red' : l.zone === 'grey' ? 'yellow' : 'green'}`}>{l.zone === 'black' ? 'Черна' : l.zone === 'grey' ? 'Сива' : 'Бяла'}</span></td>
                    <td>{fmtDateTime(l.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Няма регистрирани позиции в последните 12 часа</p>}
        </div>
      )}
    </>
  )
}
