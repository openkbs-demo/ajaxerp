import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

function fmtDate(d) { if (!d) return '-'; const dt = new Date(d); return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}` }
function fmtKg(v) { return v != null ? `${Number(v).toLocaleString('bg-BG')} кг` : '-' }

export default function GroupCard() {
  const { id } = useParams()
  const { user } = useAuth()
  const [group, setGroup] = useState(null)
  const [loading, setLoading] = useState(true)
  const [transferHistory, setTransferHistory] = useState([])
  const [traceData, setTraceData] = useState(null)
  const [traceRecords, setTraceRecords] = useState([])
  const [genetics, setGenetics] = useState([])
  const [halls, setHalls] = useState([])
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [transferForm, setTransferForm] = useState({})
  const [tab, setTab] = useState('info')

  const load = async () => {
    setLoading(true)
    try {
      const [gRes, thRes, hRes, trRes] = await Promise.all([
        api('groups.list'),
        api('groups.transferHistory', { group_id: parseInt(id) }),
        api('halls.list'),
        api('traceability.list', { limit: 20 })
      ])
      const g = (gRes.groups || []).find(g => g.id === parseInt(id))
      setGroup(g || null)
      setTransferHistory(thRes.transfers || [])
      setHalls(hRes.halls || [])
      setTraceRecords((trRes.records || []).filter(r => r.group_id === parseInt(id)))

      // Load genetics from source_litter_ids
      if (g?.source_litter_ids) {
        const litIds = typeof g.source_litter_ids === 'string' ? JSON.parse(g.source_litter_ids) : g.source_litter_ids
        if (litIds.length > 0) {
          const litRes = await api('litters.list', { weaned_only: false, limit: 100 })
          const matched = (litRes.litters || []).filter(l => litIds.includes(l.id))
          setGenetics(matched)
        }
      }
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

  const generateTrace = async () => {
    try {
      const res = await api('traceability.generate', { group_id: parseInt(id), generated_by: user?.id })
      setTraceData(res.record || res)
      load()
    } catch (e) { alert(e.message) }
  }

  const viewTraceRecord = async (recId) => {
    try {
      const res = await api('traceability.get', { id: recId })
      setTraceData(res.record)
    } catch (e) { alert(e.message) }
  }

  const submitTransfer = async (e) => {
    e.preventDefault()
    try {
      await api('groups.transfer', {
        group_id: parseInt(id),
        to_hall_id: parseInt(transferForm.to_hall_id),
        transfer_date: transferForm.transfer_date || undefined,
        weight_avg_kg: transferForm.weight_avg_kg ? parseFloat(transferForm.weight_avg_kg) : undefined,
        head_count: transferForm.head_count ? parseInt(transferForm.head_count) : undefined,
        performed_by: user?.id,
        notes: transferForm.notes
      })
      setShowTransferModal(false)
      setTransferForm({})
      load()
    } catch (e) { alert(e.message) }
  }

  if (loading) return <div className="loading">Зареждане...</div>
  if (!group) return <div className="loading">Групата не е намерена</div>

  const isReady = group.category === 'finisher' && !group.exit_date && parseFloat(group.current_weight_avg_kg) >= 122
  const status = group.exit_date ? 'Изпратена' : isReady ? 'Готова' : 'Активна'
  const statusColor = group.exit_date ? 'grey' : isReady ? 'blue' : 'green'
  const litIds = group.source_litter_ids ? (typeof group.source_litter_ids === 'string' ? JSON.parse(group.source_litter_ids) : group.source_litter_ids) : []

  return (
    <>
      <div className="page-header">
        <div>
          <Link to="/groups" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>&larr; Към списъка</Link>
          <h1 style={{ margin: '4px 0 0' }}>{group.group_name} <span className={`badge ${statusColor}`}>{status}</span></h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!group.exit_date && <button className="btn btn-outline" onClick={() => { setShowTransferModal(true); setTransferForm({ head_count: group.current_count }) }}>Трансфер</button>}
          {isReady && <Link to="/groups" className="btn btn-primary">Експедиция</Link>}
        </div>
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
        <div className={`tab ${tab === 'trace' ? 'active' : ''}`} onClick={() => setTab('trace')}>Проследимост</div>
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
          <div className="card">
            <h3>Произход (Генетика)</h3>
            {genetics.length > 0 ? (
              <table>
                <thead><tr><th>Люпило #</th><th>Майка</th><th>Паритет</th><th>Родени живи</th><th>Отбити</th><th>Тегло отб.</th><th>Дата отб.</th></tr></thead>
                <tbody>
                  {genetics.map(l => (
                    <tr key={l.id}>
                      <td>#{l.id}</td>
                      <td><strong>{l.sow_ear_tag}</strong></td>
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
        </>
      )}

      {/* ═══ TAB: TRANSFERS ═══ */}
      {tab === 'transfers' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>История на трансфери</h3>
            {!group.exit_date && <button className="btn btn-sm primary" onClick={() => { setShowTransferModal(true); setTransferForm({ head_count: group.current_count }) }}>+ Нов трансфер</button>}
          </div>
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

      {/* ═══ TAB: TRACEABILITY ═══ */}
      {tab === 'trace' && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Проследимост</h3>
              <button className="btn primary" onClick={generateTrace}>Генерирай</button>
            </div>
          </div>

          {traceData && (
            <TraceChainView data={typeof traceData.data === 'string' ? JSON.parse(traceData.data) : (traceData.data || traceData)} />
          )}

          {traceRecords.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3>Предишни записи</h3>
              <table>
                <thead><tr><th>Дата</th><th>Генерирал</th><th></th></tr></thead>
                <tbody>
                  {traceRecords.map(r => (
                    <tr key={r.id}>
                      <td>{fmtDate(r.generated_at)}</td>
                      <td>{r.generated_by_name || '-'}</td>
                      <td><button className="btn small" onClick={() => viewTraceRecord(r.id)}>Преглед</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Transfer Modal */}
      {showTransferModal && (
        <div className="modal-overlay" onClick={() => setShowTransferModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Трансфер на група</h2>
            <form onSubmit={submitTransfer}>
              <div className="form-group">
                <label>Към хале</label>
                <select value={transferForm.to_hall_id || ''} onChange={e => setTransferForm(f => ({ ...f, to_hall_id: e.target.value }))} required>
                  <option value="">Избери...</option>
                  {halls.filter(h => h.is_active !== false).map(h => <option key={h.id} value={h.id}>{h.name} ({h.sector_name || ''}) — {h.current_occupancy || 0}/{h.capacity}</option>)}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Средно тегло (кг)</label>
                  <input type="number" step="0.1" min="0" value={transferForm.weight_avg_kg || ''} onChange={e => setTransferForm(f => ({ ...f, weight_avg_kg: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Брой глави</label>
                  <input type="number" min="1" value={transferForm.head_count || ''} onChange={e => setTransferForm(f => ({ ...f, head_count: e.target.value }))} required />
                </div>
              </div>
              <div className="form-group">
                <label>Дата</label>
                <input type="date" value={transferForm.transfer_date || new Date().toISOString().split('T')[0]} onChange={e => setTransferForm(f => ({ ...f, transfer_date: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>Бележки</label>
                <textarea rows={2} value={transferForm.notes || ''} onChange={e => setTransferForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowTransferModal(false)}>Отказ</button>
                <button type="submit" className="btn btn-primary">Запиши трансфер</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

// ═════════════════════════════════════════════════════════════════════════
// TraceChainView
// ═════════════════════════════════════════════════════════════════════════

function TraceChainView({ data }) {
  if (!data) return null
  const [openSections, setOpenSections] = useState({ batch: true, genetics: true, feed: true, vet: true, withdrawals: true, transport: true })
  const toggle = (key) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }))

  const sections = [
    { key: 'batch', title: 'Партида', icon: '\uD83D\uDCE6', color: '#3498db',
      render: () => data.batch ? (
        <div className="grid grid-3">
          <div><small>Група</small><div><strong>{data.batch.group_name}</strong></div></div>
          <div><small>Хале</small><div>{data.batch.hall_name}</div></div>
          <div><small>Вход</small><div>{fmtDate(data.batch.entry_date)}</div></div>
          <div><small>Бройка вход</small><div>{data.batch.entry_count}</div></div>
          <div><small>Текущо тегло</small><div>{data.batch.current_weight_avg} кг</div></div>
          <div><small>Текущ брой</small><div>{data.batch.current_count}</div></div>
        </div>
      ) : <p>Няма данни</p>
    },
    { key: 'genetics', title: 'Генетика', icon: '\uD83E\uDDEC', color: '#9b59b6',
      render: () => data.genetics?.length > 0 ? (
        <table><thead><tr><th>Майка</th><th>Порода</th><th>Паритет</th><th>Родени живи</th></tr></thead>
        <tbody>{data.genetics.map((g, i) => <tr key={i}><td>{g.ear_tag}</td><td>{g.breed || '-'}</td><td>{g.parity_number}</td><td>{g.born_alive}</td></tr>)}</tbody></table>
      ) : <p style={{ color: 'var(--text-secondary)' }}>Няма генетични данни</p>
    },
    { key: 'feed', title: 'Фураж', icon: '\uD83C\uDF3E', color: '#f39c12',
      render: () => data.feed?.length > 0 ? (
        <table><thead><tr><th>Силоз</th><th>Рецепта</th><th>Ниво (т.)</th></tr></thead>
        <tbody>{data.feed.map((f, i) => <tr key={i}><td>{f.silo_name}</td><td>{f.recipe_name || f.feed_type}</td><td>{f.current_level_tons}</td></tr>)}</tbody></table>
      ) : <p style={{ color: 'var(--text-secondary)' }}>Няма данни за фуражи</p>
    },
    { key: 'vet', title: 'Ветеринарен дневник', icon: '\uD83D\uDC89', color: '#e74c3c',
      render: () => data.vet?.length > 0 ? (
        <table><thead><tr><th>Дата</th><th>Тип</th><th>Детайли</th><th>Извършил</th></tr></thead>
        <tbody>{data.vet.map((v, i) => <tr key={i}><td>{fmtDate(v.event_date)}</td><td>{v.event_type}</td><td>{typeof v.details === 'object' ? JSON.stringify(v.details) : v.details}</td><td>{v.performed_by_name || '-'}</td></tr>)}</tbody></table>
      ) : <p style={{ color: 'var(--text-secondary)' }}>Няма ветеринарни събития</p>
    },
    { key: 'withdrawals', title: 'Карентни срокове', icon: '\u23F1\uFE0F', color: '#e67e22',
      render: () => data.withdrawals?.length > 0 ? (
        <table><thead><tr><th>Медикамент</th><th>Начало</th><th>Край</th><th>Статус</th></tr></thead>
        <tbody>{data.withdrawals.map((w, i) => <tr key={i}><td>{w.medicine_name}</td><td>{fmtDate(w.start_date)}</td><td>{fmtDate(w.end_date)}</td>
        <td><span className={`badge ${w.status === 'active' ? 'red' : 'green'}`}>{w.status === 'active' ? 'Активен' : 'Изтекъл'}</span></td></tr>)}</tbody></table>
      ) : <p style={{ color: 'var(--text-secondary)' }}>Няма карентни срокове — <span style={{ color: 'var(--success)' }}>Чиста група</span></p>
    },
    { key: 'transport', title: 'Транспорт', icon: '\uD83D\uDE9B', color: '#2ecc71',
      render: () => data.transport?.length > 0 ? (
        <table><thead><tr><th>Дата</th><th>МПС</th><th>Купувач</th><th>Глави</th><th>Тегло товар.</th><th>Тегло дест.</th><th>Свиване</th></tr></thead>
        <tbody>{data.transport.map((t, i) => <tr key={i}><td>{fmtDate(t.dispatch_date)}</td><td>{t.plate_number || '-'}</td><td>{t.buyer_name || '-'}</td>
        <td>{t.head_count}</td><td>{t.weight_at_loading_kg || '-'} кг</td><td>{t.weight_at_destination_kg || '-'} кг</td>
        <td>{t.shrinkage_pct != null ? t.shrinkage_pct + '%' : '-'}</td></tr>)}</tbody></table>
      ) : <p style={{ color: 'var(--text-secondary)' }}>Няма данни за транспорт</p>
    }
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {sections.map(s => (
        <div key={s.key} className="card" style={{ borderLeft: `4px solid ${s.color}` }}>
          <h3 style={{ cursor: 'pointer', margin: 0 }} onClick={() => toggle(s.key)}>
            {s.icon} {s.title} {openSections[s.key] ? '\u25BC' : '\u25B6'}
          </h3>
          {openSections[s.key] && <div style={{ marginTop: 8 }}>{s.render()}</div>}
        </div>
      ))}
    </div>
  )
}
