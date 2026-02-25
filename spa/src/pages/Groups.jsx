import { useState, useEffect } from 'react'
import { api, exportCsv } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

function fmtDate(d) { if (!d) return '-'; const dt = new Date(d); return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}` }
function fmtEur(v) { return v != null ? Number(v).toLocaleString('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €' : '-' }
function fmtKg(v) { return v != null ? `${Number(v).toLocaleString('bg-BG')} кг` : '-' }

// ─── Dispatch constants ──────────────────────────────────────────────────
const STATUS_BG = { proposed: 'Предложена', confirmed: 'Потвърдена', loading: 'Товарене', in_transit: 'В транзит', delivered: 'Доставена', cancelled: 'Отменена' }
const STATUS_COLOR = { proposed: 'blue', confirmed: 'yellow', loading: 'yellow', in_transit: 'blue', delivered: 'green', cancelled: 'grey' }
const WORKFLOW = { proposed: 'confirmed', confirmed: 'loading', loading: 'in_transit', in_transit: 'delivered' }
const WORKFLOW_LABEL = { proposed: 'Потвърди', confirmed: 'Товарене', loading: 'Тръгни', in_transit: 'Доставено' }

// ─── Regulatory constants ────────────────────────────────────────────────
const DOC_TYPE_BG = { diary_no1: 'Дневник №1 (БАБХ)', vetis_certificate: 'ВЕТИС Сертификат', animal_register: 'ИАСРЖ Регистър' }
const DOC_STATUS_BG = { draft: 'Чернова', final: 'Финализиран', submitted: 'Подаден' }
const DOC_STATUS_COLOR = { draft: 'yellow', final: 'blue', submitted: 'green' }

// ═════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════════

export default function Groups() {
  const { user } = useAuth()
  const [tab, setTab] = useState('groups')
  const [loading, setLoading] = useState(true)

  // Groups tab state
  const [groups, setGroups] = useState([])
  const [halls, setHalls] = useState([])
  const [expandedGroup, setExpandedGroup] = useState(null)
  const [transferHistory, setTransferHistory] = useState([])
  const [traceData, setTraceData] = useState(null)
  const [showTransferModal, setShowTransferModal] = useState(null)
  const [transferForm, setTransferForm] = useState({})
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState({})
  const [litters, setLitters] = useState([])

  // Dispatch tab state
  const [dispatches, setDispatches] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [drivers, setDrivers] = useState([])
  const [showDispatchModal, setShowDispatchModal] = useState(false)
  const [dispatchForm, setDispatchForm] = useState({})
  const [showWeightModal, setShowWeightModal] = useState(null)
  const [weightForm, setWeightForm] = useState({})

  // Regulatory tab state
  const [documents, setDocuments] = useState([])
  const [docType, setDocType] = useState('diary_no1')
  const [docForm, setDocForm] = useState({})
  const [regDispatches, setRegDispatches] = useState([])
  const [viewDoc, setViewDoc] = useState(null)
  const [regStats, setRegStats] = useState(null)

  // ─── Data loading ──────────────────────────────────────────────────────
  const loadGroups = async () => {
    const [g, h] = await Promise.all([
      api('groups.list'),
      api('halls.list')
    ])
    setGroups(g.groups || [])
    setHalls(h.halls || [])
  }

  const loadDispatch = async () => {
    const [d, v, dr] = await Promise.all([
      api('dispatch.list'),
      api('vehicles.list'),
      api('personnel.list', { role: 'driver' })
    ])
    setDispatches(d.dispatches || [])
    setVehicles(v.vehicles || [])
    setDrivers(dr.personnel || [])
  }

  const loadRegulatory = async () => {
    const [docs, disp, st] = await Promise.all([
      api('regulatory.list', { limit: 50 }),
      api('dispatch.list', { limit: 50 }),
      api('regulatory.stats')
    ])
    setDocuments(docs.documents || [])
    setRegDispatches(disp.dispatches || [])
    setRegStats(st.stats || null)
  }

  const load = async () => {
    setLoading(true)
    try {
      await loadGroups()
      if (tab === 'dispatch') await loadDispatch()
      if (tab === 'regulatory') await loadRegulatory()
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [tab])

  // ─── Group detail expand ───────────────────────────────────────────────
  const toggleGroup = async (gId) => {
    if (expandedGroup === gId) {
      setExpandedGroup(null)
      setTransferHistory([])
      setTraceData(null)
      return
    }
    setExpandedGroup(gId)
    setTraceData(null)
    try {
      const res = await api('groups.transferHistory', { group_id: gId })
      setTransferHistory(res.transfers || [])
    } catch (e) { setTransferHistory([]) }
  }

  const generateTrace = async (groupId) => {
    try {
      const res = await api('traceability.generate', { group_id: groupId, generated_by: user?.id })
      setTraceData(res.record || res)
    } catch (e) { alert(e.message) }
  }

  // ─── Group transfer ────────────────────────────────────────────────────
  const submitTransfer = async (e) => {
    e.preventDefault()
    try {
      await api('groups.transfer', {
        group_id: showTransferModal,
        to_hall_id: parseInt(transferForm.to_hall_id),
        transfer_date: transferForm.transfer_date || undefined,
        weight_avg_kg: transferForm.weight_avg_kg ? parseFloat(transferForm.weight_avg_kg) : undefined,
        head_count: transferForm.head_count ? parseInt(transferForm.head_count) : undefined,
        performed_by: user?.id,
        notes: transferForm.notes
      })
      setShowTransferModal(null)
      setTransferForm({})
      setExpandedGroup(null)
      load()
    } catch (e) { alert(e.message) }
  }

  // ─── Group create ──────────────────────────────────────────────────────
  const openCreateModal = async () => {
    setCreateForm({ category: 'weaner' })
    setShowCreateModal(true)
    try {
      const res = await api('litters.list', { weaned_only: true, limit: 30 })
      setLitters(res.litters || [])
    } catch (e) { setLitters([]) }
  }

  const submitCreate = async (e) => {
    e.preventDefault()
    try {
      const selectedLitters = createForm.source_litter_ids || []
      await api('groups.create', {
        group_name: createForm.group_name,
        category: createForm.category,
        hall_id: createForm.hall_id ? parseInt(createForm.hall_id) : undefined,
        entry_count: createForm.entry_count ? parseInt(createForm.entry_count) : undefined,
        entry_weight_avg_kg: createForm.entry_weight_avg_kg ? parseFloat(createForm.entry_weight_avg_kg) : undefined,
        target_slaughter_date: createForm.target_slaughter_date || undefined,
        source_litter_ids: selectedLitters.length > 0 ? selectedLitters : undefined
      })
      setShowCreateModal(false)
      load()
    } catch (e) { alert(e.message) }
  }

  // ─── Dispatch actions ──────────────────────────────────────────────────
  const submitDispatch = async (e) => {
    e.preventDefault()
    try {
      await api('dispatch.create', {
        group_id: parseInt(dispatchForm.group_id),
        dispatch_date: dispatchForm.dispatch_date,
        buyer_name: dispatchForm.buyer_name,
        destination: dispatchForm.destination,
        vehicle_id: dispatchForm.vehicle_id ? parseInt(dispatchForm.vehicle_id) : undefined,
        driver_id: dispatchForm.driver_id ? parseInt(dispatchForm.driver_id) : undefined,
        head_count: parseInt(dispatchForm.head_count),
        notes: dispatchForm.notes,
        created_by: user?.id
      })
      setShowDispatchModal(false)
      load()
    } catch (e) { alert(e.message) }
  }

  const advanceStatus = async (d) => {
    const nextStatus = WORKFLOW[d.status]
    if (!nextStatus) return
    if (nextStatus === 'loading') {
      setShowWeightModal(d.id)
      setWeightForm({ type: 'loading', weight: '' })
      return
    }
    if (nextStatus === 'delivered') {
      setShowWeightModal(d.id)
      setWeightForm({ type: 'destination', weight: '' })
      return
    }
    try {
      await api('dispatch.update', { id: d.id, status: nextStatus })
      load()
    } catch (e) { alert(e.message) }
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
      setShowWeightModal(null)
      load()
    } catch (e) { alert(e.message) }
  }

  const cancelDispatch = async (id) => {
    if (!confirm('Отмяна на заявката?')) return
    try { await api('dispatch.update', { id, status: 'cancelled' }); load() } catch (e) { alert(e.message) }
  }

  const autoCheck = async () => {
    try {
      const res = await api('dispatch.autoCheck')
      alert(`Създадени ${res.created || 0} нови предложения за експедиция`)
      load()
    } catch (e) { alert(e.message) }
  }

  // ─── Regulatory actions ────────────────────────────────────────────────
  const generateDoc = async (e) => {
    e.preventDefault()
    try {
      const params = { document_type: docType, generated_by: user?.id }
      if (docType === 'diary_no1' || docType === 'animal_register') {
        params.from_date = docForm.from_date
        params.to_date = docForm.to_date
      }
      if (docType === 'vetis_certificate') params.dispatch_id = parseInt(docForm.dispatch_id)
      await api('regulatory.generate', params)
      setDocForm({})
      load()
    } catch (e) { alert(e.message) }
  }

  const finalizeDoc = async (id) => {
    try { await api('regulatory.finalize', { id, finalized_by: user?.id }); load() } catch (e) { alert(e.message) }
  }
  const submitDoc = async (id) => {
    try { await api('regulatory.submit', { id }); load() } catch (e) { alert(e.message) }
  }
  const exportDoc = async (id) => {
    try {
      const res = await api('regulatory.export', { id })
      if (res.body) {
        const blob = new Blob([res.body], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = `doc-${id}.csv`
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
    } catch (e) { alert(e.message) }
  }
  const viewDocument = async (id) => {
    try {
      const res = await api('regulatory.get', { id })
      setViewDoc(res.document)
    } catch (e) { alert(e.message) }
  }

  // ─── Group stats ───────────────────────────────────────────────────────
  const activeGroups = groups.filter(g => !g.exit_date)
  const totalAnimals = activeGroups.reduce((s, g) => s + (g.current_count || 0), 0)
  const readyForDispatch = activeGroups.filter(g => g.category === 'finisher' && parseFloat(g.current_weight_avg_kg) >= 122)

  // Dispatch stats
  const proposed = dispatches.filter(d => d.status === 'proposed').length
  const inLoading = dispatches.filter(d => d.status === 'loading').length
  const inTransit = dispatches.filter(d => d.status === 'in_transit').length
  const delivered = dispatches.filter(d => d.status === 'delivered').length

  if (loading) return <div className="loading">Зареждане...</div>

  return (
    <>
      <div className="page-header">
        <h1>Групи / Партиди</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {tab === 'groups' && <button className="btn primary" onClick={openCreateModal}>+ Нова група</button>}
          {tab === 'dispatch' && (
            <>
              <button className="btn btn-outline btn-sm" onClick={() => exportCsv('dispatches')}>Експорт CSV</button>
              <button className="btn btn-outline" onClick={autoCheck}>Провери за автоматични</button>
              <button className="btn btn-primary" onClick={() => { setDispatchForm({ dispatch_date: new Date().toISOString().split('T')[0] }); setShowDispatchModal(true) }}>+ Нова заявка</button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ marginBottom: 16, display: 'flex', gap: 0, borderBottom: '2px solid var(--border)' }}>
        <button className={`tab ${tab === 'groups' ? 'active' : ''}`} onClick={() => setTab('groups')}>Групи</button>
        <button className={`tab ${tab === 'dispatch' ? 'active' : ''}`} onClick={() => setTab('dispatch')}>Експедиция</button>
        <button className={`tab ${tab === 'regulatory' ? 'active' : ''}`} onClick={() => setTab('regulatory')}>Регулаторни</button>
      </div>

      {/* ═══ TAB 1: GROUPS ═══ */}
      {tab === 'groups' && (
        <>
          <div className="grid grid-4" style={{ marginBottom: 16 }}>
            <div className="stat-card green"><div className="stat-value">{activeGroups.length}</div><div className="stat-label">Активни групи</div></div>
            <div className="stat-card blue"><div className="stat-value">{totalAnimals.toLocaleString('bg-BG')}</div><div className="stat-label">Общо животни</div></div>
            <div className="stat-card"><div className="stat-value">{readyForDispatch.length}</div><div className="stat-label">Готови за клане</div></div>
            <div className="stat-card yellow"><div className="stat-value">{groups.filter(g => g.category === 'weaner' && !g.exit_date).length}</div><div className="stat-label">Подрастващи</div></div>
          </div>

          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Група</th><th>Категория</th><th>Хале</th><th>Вход</th>
                  <th>Бр. вход/тек.</th><th>Тегло вход/тек.</th><th>Цел клане</th><th>Статус</th><th></th>
                </tr>
              </thead>
              <tbody>
                {groups.length > 0 ? groups.map(g => {
                  const isReady = g.category === 'finisher' && !g.exit_date && parseFloat(g.current_weight_avg_kg) >= 122
                  const status = g.exit_date ? 'Изпратена' : isReady ? 'Готова' : 'Активна'
                  const statusColor = g.exit_date ? 'grey' : isReady ? 'blue' : 'green'
                  return (
                    <tr key={g.id} onClick={() => toggleGroup(g.id)} style={{ cursor: 'pointer', background: expandedGroup === g.id ? '#f8f9fa' : undefined }}>
                      <td><strong>{g.group_name}</strong></td>
                      <td><span className={`badge ${g.category === 'weaner' ? 'yellow' : 'blue'}`}>{g.category === 'weaner' ? 'Подраст.' : 'Угояване'}</span></td>
                      <td>{g.hall_name || '-'}</td>
                      <td>{fmtDate(g.entry_date)}</td>
                      <td>{g.entry_count} / {g.current_count}</td>
                      <td>{fmtKg(g.entry_weight_avg_kg)} / {fmtKg(g.current_weight_avg_kg)}</td>
                      <td>{fmtDate(g.target_slaughter_date)}</td>
                      <td><span className={`badge ${statusColor}`}>{status}</span></td>
                      <td onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 4 }}>
                        {!g.exit_date && <button className="btn btn-sm" onClick={() => { setShowTransferModal(g.id); setTransferForm({ head_count: g.current_count }) }}>Трансфер</button>}
                        {isReady && <button className="btn btn-sm btn-primary" onClick={() => { setTab('dispatch'); setDispatchForm({ group_id: String(g.id), head_count: g.current_count, dispatch_date: new Date().toISOString().split('T')[0] }); setShowDispatchModal(true) }}>Експедиция</button>}
                      </td>
                    </tr>
                  )
                }) : <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Няма групи</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Expanded group detail */}
          {expandedGroup && (() => {
            const g = groups.find(g => g.id === expandedGroup)
            if (!g) return null
            return (
              <div className="card" style={{ marginTop: 12, borderLeft: '4px solid var(--primary)' }}>
                <h3>Детайли: {g.group_name}</h3>

                {/* Basic info */}
                <div className="grid grid-4" style={{ marginBottom: 12 }}>
                  <div><small>Категория</small><div><strong>{g.category === 'weaner' ? 'Подрастване' : 'Угояване'}</strong></div></div>
                  <div><small>Хале</small><div>{g.hall_name || '-'}</div></div>
                  <div><small>Дата на вход</small><div>{fmtDate(g.entry_date)}</div></div>
                  <div><small>Цел за клане</small><div>{fmtDate(g.target_slaughter_date)}</div></div>
                  <div><small>Бройка вход</small><div>{g.entry_count}</div></div>
                  <div><small>Текущ брой</small><div>{g.current_count}</div></div>
                  <div><small>Тегло вход (ср.)</small><div>{fmtKg(g.entry_weight_avg_kg)}</div></div>
                  <div><small>Текущо тегло (ср.)</small><div>{fmtKg(g.current_weight_avg_kg)}</div></div>
                </div>

                {/* Source litters / Genetics */}
                {g.source_litter_ids && JSON.parse(typeof g.source_litter_ids === 'string' ? g.source_litter_ids : JSON.stringify(g.source_litter_ids)).length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <h4>Произход (Генетика)</h4>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Litter IDs: {JSON.parse(typeof g.source_litter_ids === 'string' ? g.source_litter_ids : JSON.stringify(g.source_litter_ids)).join(', ')}</p>
                  </div>
                )}

                {/* Transfer history */}
                <div style={{ marginBottom: 12 }}>
                  <h4>История на трансфери</h4>
                  {transferHistory.length > 0 ? (
                    <table>
                      <thead><tr><th>Дата</th><th>От хале</th><th>Към хале</th><th>Тегло (ср.)</th><th>Бройка</th><th>Извършил</th></tr></thead>
                      <tbody>{transferHistory.map((t, i) => {
                        const d = typeof t.details === 'string' ? JSON.parse(t.details) : (t.details || {})
                        return (
                          <tr key={i}>
                            <td>{fmtDate(t.event_date)}</td>
                            <td>{t.from_hall_name || '-'}</td>
                            <td>{t.to_hall_name || '-'}</td>
                            <td>{d.weight_avg_kg ? fmtKg(d.weight_avg_kg) : '-'}</td>
                            <td>{d.head_count || '-'}</td>
                            <td>{t.performed_by_name || '-'}</td>
                          </tr>
                        )
                      })}</tbody>
                    </table>
                  ) : <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Няма записи за трансфери</p>}
                </div>

                {/* Traceability */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <h4 style={{ margin: 0 }}>Проследимост</h4>
                    <button className="btn btn-sm primary" onClick={() => generateTrace(g.id)}>Генерирай</button>
                  </div>
                  {traceData && <TraceChainView data={typeof traceData.data === 'string' ? JSON.parse(traceData.data) : (traceData.data || traceData)} />}
                </div>
              </div>
            )
          })()}
        </>
      )}

      {/* ═══ TAB 2: DISPATCH ═══ */}
      {tab === 'dispatch' && (
        <>
          <div className="grid grid-4" style={{ marginBottom: 24 }}>
            <div className="stat-card blue"><div className="stat-value">{proposed}</div><div className="stat-label">Предложени</div></div>
            <div className="stat-card yellow"><div className="stat-value">{inLoading}</div><div className="stat-label">В товарене</div></div>
            <div className="stat-card"><div className="stat-value">{inTransit}</div><div className="stat-label">В транзит</div></div>
            <div className="stat-card green"><div className="stat-value">{delivered}</div><div className="stat-label">Доставени</div></div>
          </div>

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
                    <td>{d.weight_at_loading_kg ? fmtKg(d.weight_at_loading_kg) : '-'}</td>
                    <td>{d.weight_at_destination_kg ? fmtKg(d.weight_at_destination_kg) : '-'}</td>
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
        </>
      )}

      {/* ═══ TAB 3: REGULATORY ═══ */}
      {tab === 'regulatory' && (
        <>
          {regStats && (
            <div className="grid grid-3" style={{ marginBottom: 16 }}>
              <div className="stat-card blue"><div className="stat-value">{regStats.total}</div><div className="stat-label">Общо документи</div></div>
              <div className="stat-card green"><div className="stat-value">{regStats.byType?.filter(s => s.status === 'final').reduce((s, r) => s + parseInt(r.count), 0) || 0}</div><div className="stat-label">Финализирани</div></div>
              <div className="stat-card"><div className="stat-value">{regStats.byType?.filter(s => s.status === 'submitted').reduce((s, r) => s + parseInt(r.count), 0) || 0}</div><div className="stat-label">Подадени</div></div>
            </div>
          )}

          <div className="card" style={{ marginBottom: 16 }}>
            <h3>Генерирай документ</h3>
            <form onSubmit={generateDoc}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
                <div>
                  <label>Тип</label>
                  <select value={docType} onChange={e => { setDocType(e.target.value); setDocForm({}) }}>
                    <option value="diary_no1">Дневник №1 (БАБХ)</option>
                    <option value="vetis_certificate">ВЕТИС Сертификат</option>
                    <option value="animal_register">ИАСРЖ Регистър</option>
                  </select>
                </div>
                {(docType === 'diary_no1' || docType === 'animal_register') && (
                  <>
                    <div><label>От дата</label><input type="date" required value={docForm.from_date || ''} onChange={e => setDocForm({ ...docForm, from_date: e.target.value })} /></div>
                    <div><label>До дата</label><input type="date" required value={docForm.to_date || ''} onChange={e => setDocForm({ ...docForm, to_date: e.target.value })} /></div>
                  </>
                )}
                {docType === 'vetis_certificate' && (
                  <div style={{ gridColumn: 'span 2' }}>
                    <label>Експедиция</label>
                    <select required value={docForm.dispatch_id || ''} onChange={e => setDocForm({ ...docForm, dispatch_id: e.target.value })}>
                      <option value="">-- Изберете --</option>
                      {regDispatches.map(d => <option key={d.id} value={d.id}>#{d.id} — {d.group_name} ({d.status})</option>)}
                    </select>
                  </div>
                )}
                <button type="submit" className="btn primary">Генерирай</button>
              </div>
            </form>
          </div>

          <div className="card">
            <h3>Регулаторни документи</h3>
            <table>
              <thead><tr><th>Реф. №</th><th>Тип</th><th>Заглавие</th><th>Период</th><th>Статус</th><th></th></tr></thead>
              <tbody>
                {documents.map(d => (
                  <tr key={d.id}>
                    <td><strong>{d.reference_number}</strong></td>
                    <td>{DOC_TYPE_BG[d.document_type] || d.document_type}</td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.title}</td>
                    <td>{d.period_from && d.period_to ? `${fmtDate(d.period_from)} — ${fmtDate(d.period_to)}` : '-'}</td>
                    <td><span className={`badge ${DOC_STATUS_COLOR[d.status]}`}>{DOC_STATUS_BG[d.status]}</span></td>
                    <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <button className="btn small" onClick={() => viewDocument(d.id)}>Преглед</button>
                      {d.status === 'draft' && <button className="btn small" onClick={() => finalizeDoc(d.id)}>Финализирай</button>}
                      {d.status === 'final' && <button className="btn small" onClick={() => submitDoc(d.id)}>Подай</button>}
                      <button className="btn small" onClick={() => exportDoc(d.id)}>CSV</button>
                    </td>
                  </tr>
                ))}
                {documents.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Няма документи</td></tr>}
              </tbody>
            </table>
          </div>

          {viewDoc && (
            <div className="modal-backdrop" onClick={() => setViewDoc(null)}>
              <div className="modal" style={{ maxWidth: 800, maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
                <h3>{viewDoc.title} <span className={`badge ${DOC_STATUS_COLOR[viewDoc.status]}`}>{DOC_STATUS_BG[viewDoc.status]}</span></h3>
                <p><strong>Реф.:</strong> {viewDoc.reference_number} | <strong>Период:</strong> {fmtDate(viewDoc.period_from)} — {fmtDate(viewDoc.period_to)}</p>
                <DocumentPreview doc={viewDoc} />
                <div style={{ marginTop: 12, textAlign: 'right' }}><button className="btn" onClick={() => setViewDoc(null)}>Затвори</button></div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══ MODALS ═══ */}

      {/* Transfer Modal */}
      {showTransferModal && (
        <div className="modal-overlay" onClick={() => setShowTransferModal(null)}>
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
                <button type="button" className="btn btn-outline" onClick={() => setShowTransferModal(null)}>Отказ</button>
                <button type="submit" className="btn btn-primary">Запиши трансфер</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Group Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Нова група</h2>
            <form onSubmit={submitCreate}>
              <div className="form-group">
                <label>Име на групата</label>
                <input value={createForm.group_name || ''} onChange={e => setCreateForm(f => ({ ...f, group_name: e.target.value }))} required />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Категория</label>
                  <select value={createForm.category || 'weaner'} onChange={e => setCreateForm(f => ({ ...f, category: e.target.value }))}>
                    <option value="weaner">Подрастване</option>
                    <option value="finisher">Угояване</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Хале</label>
                  <select value={createForm.hall_id || ''} onChange={e => setCreateForm(f => ({ ...f, hall_id: e.target.value }))}>
                    <option value="">— Без —</option>
                    {halls.filter(h => h.is_active !== false).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Брой глави</label>
                  <input type="number" min="1" value={createForm.entry_count || ''} onChange={e => setCreateForm(f => ({ ...f, entry_count: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Средно тегло (кг)</label>
                  <input type="number" step="0.1" min="0" value={createForm.entry_weight_avg_kg || ''} onChange={e => setCreateForm(f => ({ ...f, entry_weight_avg_kg: e.target.value }))} />
                </div>
              </div>
              <div className="form-group">
                <label>Цел за клане</label>
                <input type="date" value={createForm.target_slaughter_date || ''} onChange={e => setCreateForm(f => ({ ...f, target_slaughter_date: e.target.value }))} />
              </div>
              {litters.length > 0 && (
                <div className="form-group">
                  <label>Произход (люпила)</label>
                  <select multiple size={4} value={(createForm.source_litter_ids || []).map(String)} onChange={e => {
                    const selected = Array.from(e.target.selectedOptions, o => parseInt(o.value))
                    setCreateForm(f => ({ ...f, source_litter_ids: selected }))
                  }}>
                    {litters.map(l => <option key={l.id} value={l.id}>#{l.id} — {l.sow_ear_tag} (п.{l.parity_number}, {l.weaned_count} отб., {fmtDate(l.weaning_date)})</option>)}
                  </select>
                  <small style={{ color: 'var(--text-secondary)' }}>Задръжте Ctrl за множествен избор</small>
                </div>
              )}
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowCreateModal(false)}>Отказ</button>
                <button type="submit" className="btn btn-primary">Създай</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dispatch Create Modal */}
      {showDispatchModal && (
        <div className="modal-overlay" onClick={() => setShowDispatchModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Нова заявка за експедиция</h2>
            <form onSubmit={submitDispatch}>
              <div className="form-group">
                <label>Група (тегло &ge; 100 кг)</label>
                <select value={dispatchForm.group_id || ''} onChange={e => {
                  const g = groups.find(g => g.id === parseInt(e.target.value))
                  setDispatchForm(f => ({ ...f, group_id: e.target.value, head_count: g?.current_count || '' }))
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
                  <input type="date" value={dispatchForm.dispatch_date || ''} onChange={e => setDispatchForm(f => ({ ...f, dispatch_date: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Брой глави</label>
                  <input type="number" min="1" value={dispatchForm.head_count || ''} onChange={e => setDispatchForm(f => ({ ...f, head_count: e.target.value }))} required />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Купувач</label>
                  <input value={dispatchForm.buyer_name || ''} onChange={e => setDispatchForm(f => ({ ...f, buyer_name: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Дестинация</label>
                  <input value={dispatchForm.destination || ''} onChange={e => setDispatchForm(f => ({ ...f, destination: e.target.value }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>МПС</label>
                  <select value={dispatchForm.vehicle_id || ''} onChange={e => setDispatchForm(f => ({ ...f, vehicle_id: e.target.value }))}>
                    <option value="">— Без —</option>
                    {vehicles.filter(v => v.vehicle_type === 'livestock_transport' || v.status === 'clean').map(v => (
                      <option key={v.id} value={v.id}>{v.plate_number}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Шофьор</label>
                  <select value={dispatchForm.driver_id || ''} onChange={e => setDispatchForm(f => ({ ...f, driver_id: e.target.value }))}>
                    <option value="">— Без —</option>
                    {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Бележки</label>
                <textarea rows={2} value={dispatchForm.notes || ''} onChange={e => setDispatchForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowDispatchModal(false)}>Отказ</button>
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

// ═════════════════════════════════════════════════════════════════════════
// TraceChainView — collapsible traceability chain (from Traceability.jsx)
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

// ═════════════════════════════════════════════════════════════════════════
// DocumentPreview — regulatory document preview (from Traceability.jsx)
// ═════════════════════════════════════════════════════════════════════════

function DocumentPreview({ doc }) {
  const data = typeof doc.data === 'string' ? JSON.parse(doc.data) : doc.data
  if (!data) return <p>Няма данни</p>

  if (doc.document_type === 'diary_no1') {
    return (
      <div>
        <h4>Ваксинации ({data.vaccinations?.length || 0})</h4>
        {data.vaccinations?.length > 0 ? (
          <table><thead><tr><th>Дата</th><th>Хале</th><th>Детайли</th></tr></thead>
          <tbody>{data.vaccinations.map((v, i) => <tr key={i}><td>{fmtDate(v.event_date)}</td><td>{v.hall_name}</td><td>{JSON.stringify(v.details || {})}</td></tr>)}</tbody></table>
        ) : <p style={{ color: 'var(--text-secondary)' }}>Няма</p>}
        <h4>Дезинфекции ({data.disinfections?.length || 0})</h4>
        {data.disinfections?.length > 0 ? (
          <table><thead><tr><th>Дата</th><th>МПС</th><th>Измиване</th><th>Дезинфекция</th></tr></thead>
          <tbody>{data.disinfections.map((d2, i) => <tr key={i}><td>{fmtDate(d2.disinfection_date)}</td><td>{d2.plate_number}</td><td>{d2.wash_confirmed ? 'Да' : 'Не'}</td><td>{d2.disinfect_confirmed ? 'Да' : 'Не'}</td></tr>)}</tbody></table>
        ) : <p style={{ color: 'var(--text-secondary)' }}>Няма</p>}
        <h4>Смъртност ({data.mortality?.length || 0})</h4>
        {data.mortality?.length > 0 ? (
          <table><thead><tr><th>Дата</th><th>Хале</th><th>Категория</th></tr></thead>
          <tbody>{data.mortality.map((m, i) => <tr key={i}><td>{fmtDate(m.event_date)}</td><td>{m.hall_name}</td><td>{m.category}</td></tr>)}</tbody></table>
        ) : <p style={{ color: 'var(--text-secondary)' }}>Няма</p>}
        <h4>Третирания ({data.treatments?.length || 0})</h4>
        {data.treatments?.length > 0 ? (
          <table><thead><tr><th>Дата</th><th>Хале</th><th>Детайли</th></tr></thead>
          <tbody>{data.treatments.map((t, i) => <tr key={i}><td>{fmtDate(t.event_date)}</td><td>{t.hall_name}</td><td>{JSON.stringify(t.details || {})}</td></tr>)}</tbody></table>
        ) : <p style={{ color: 'var(--text-secondary)' }}>Няма</p>}
        <h4>Движения ({data.transfers?.length || 0})</h4>
        {data.transfers?.length > 0 ? (
          <table><thead><tr><th>Дата</th><th>Хале</th><th>Детайли</th></tr></thead>
          <tbody>{data.transfers.map((t, i) => <tr key={i}><td>{fmtDate(t.event_date)}</td><td>{t.hall_name}</td><td>{JSON.stringify(t.details || {})}</td></tr>)}</tbody></table>
        ) : <p style={{ color: 'var(--text-secondary)' }}>Няма</p>}
      </div>
    )
  }

  if (doc.document_type === 'vetis_certificate') {
    return (
      <div>
        <h4>Експедиция</h4>
        {data.dispatch && (
          <div className="grid grid-3">
            <div><small>Група</small><div><strong>{data.dispatch.group}</strong></div></div>
            <div><small>Хале</small><div>{data.dispatch.hall}</div></div>
            <div><small>Глави</small><div>{data.dispatch.head_count}</div></div>
            <div><small>Купувач</small><div>{data.dispatch.buyer}</div></div>
            <div><small>Дестинация</small><div>{data.dispatch.destination}</div></div>
            <div><small>Тегло</small><div>{data.dispatch.weight_loading} кг</div></div>
          </div>
        )}
        <h4 style={{ marginTop: 12 }}>Здравен статус</h4>
        <div className={`alert-item ${data.healthStatus?.hasActiveWithdrawals ? 'critical' : 'info'}`}>
          <strong>{data.healthStatus?.certification}</strong>
        </div>
        {data.healthStatus?.vaccinations?.length > 0 && (
          <>
            <h4>Ваксинации</h4>
            <table><thead><tr><th>Дата</th><th>Детайли</th></tr></thead>
            <tbody>{data.healthStatus.vaccinations.map((v, i) => <tr key={i}><td>{fmtDate(v.event_date)}</td><td>{JSON.stringify(v.details || {})}</td></tr>)}</tbody></table>
          </>
        )}
      </div>
    )
  }

  if (doc.document_type === 'animal_register') {
    return (
      <div>
        <h4>Начално състояние</h4>
        <div className="grid grid-3">
          {Object.entries(data.initial || {}).map(([k, v]) => <div key={k}><small>{k}</small><div><strong>{v}</strong></div></div>)}
        </div>
        <h4 style={{ marginTop: 12 }}>Крайно състояние</h4>
        <div className="grid grid-3">
          {Object.entries(data.final || {}).map(([k, v]) => <div key={k}><small>{k}</small><div><strong>{v}</strong></div></div>)}
        </div>
        <h4 style={{ marginTop: 12 }}>Движения</h4>
        <div className="grid grid-4">
          <div><small>Родени</small><div>{data.movements?.born || 0}</div></div>
          <div><small>Продадени</small><div>{data.movements?.sold || 0}</div></div>
          <div><small>Умрели</small><div>{data.movements?.died || 0}</div></div>
          <div><small>Бракувани</small><div>{data.movements?.culled || 0}</div></div>
        </div>
        <h4 style={{ marginTop: 12 }}>Баланс</h4>
        <div className={`alert-item ${data.balanceCheck ? 'info' : 'critical'}`}>
          {data.balanceCheck ? 'Балансът е коректен' : 'Несъответствие в баланса'}
        </div>
      </div>
    )
  }

  return <pre style={{ fontSize: 12, overflow: 'auto' }}>{JSON.stringify(data, null, 2)}</pre>
}
