import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

function fmtDate(d) { if (!d) return '-'; const dt = new Date(d); return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}` }
function fmtBgn(v) { return v != null ? Number(v).toLocaleString('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' лв' : '-' }

const DOC_TYPE_BG = { diary_no1: 'Дневник №1 (БАБХ)', vetis_certificate: 'ВЕТИС Сертификат', animal_register: 'ИАСРЖ Регистър' }
const STATUS_BG = { draft: 'Чернова', final: 'Финализиран', submitted: 'Подаден' }
const STATUS_COLOR = { draft: 'yellow', final: 'blue', submitted: 'green' }

export default function Traceability() {
  const { user } = useAuth()
  const [tab, setTab] = useState('trace')
  const [loading, setLoading] = useState(true)

  // Traceability tab
  const [groups, setGroups] = useState([])
  const [selectedGroup, setSelectedGroup] = useState('')
  const [traceData, setTraceData] = useState(null)
  const [traceRecords, setTraceRecords] = useState([])
  const [generating, setGenerating] = useState(false)

  // Regulatory tab
  const [documents, setDocuments] = useState([])
  const [docType, setDocType] = useState('diary_no1')
  const [docForm, setDocForm] = useState({})
  const [dispatches, setDispatches] = useState([])
  const [viewDoc, setViewDoc] = useState(null)
  const [stats, setStats] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const [g, tr] = await Promise.all([
        api('groups.list'),
        api('traceability.list', { limit: 20 })
      ])
      setGroups(g.groups || [])
      setTraceRecords(tr.records || [])
      if (tab === 'regulatory') {
        const [docs, disp, st] = await Promise.all([
          api('regulatory.list', { limit: 50 }),
          api('dispatch.list', { limit: 50 }),
          api('regulatory.stats')
        ])
        setDocuments(docs.documents || [])
        setDispatches(disp.dispatches || [])
        setStats(st.stats || null)
      }
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [tab])

  const generateTrace = async () => {
    if (!selectedGroup) return
    setGenerating(true)
    try {
      const res = await api('traceability.generate', { group_id: parseInt(selectedGroup), generated_by: user?.id })
      setTraceData(res.record || res)
      load()
    } catch (e) { alert(e.message) }
    setGenerating(false)
  }

  const viewTraceRecord = async (id) => {
    try {
      const res = await api('traceability.get', { id })
      setTraceData(res.record)
    } catch (e) { alert(e.message) }
  }

  const generateDoc = async (e) => {
    e.preventDefault()
    try {
      const params = { document_type: docType, generated_by: user?.id }
      if (docType === 'diary_no1' || docType === 'animal_register') {
        params.from_date = docForm.from_date
        params.to_date = docForm.to_date
      }
      if (docType === 'vetis_certificate') {
        params.dispatch_id = parseInt(docForm.dispatch_id)
      }
      await api('regulatory.generate', params)
      setDocForm({})
      load()
    } catch (e) { alert(e.message) }
  }

  const finalizeDoc = async (id) => {
    try {
      await api('regulatory.finalize', { id, finalized_by: user?.id })
      load()
    } catch (e) { alert(e.message) }
  }

  const submitDoc = async (id) => {
    try {
      await api('regulatory.submit', { id })
      load()
    } catch (e) { alert(e.message) }
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

  if (loading) return <div className="loading">Зареждане...</div>

  return (
    <>
      <div className="page-header">
        <h1>Проследимост и Регулаторни</h1>
      </div>

      <div className="tabs" style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        <button className={`btn ${tab === 'trace' ? 'primary' : ''}`} onClick={() => setTab('trace')}>Проследимост</button>
        <button className={`btn ${tab === 'regulatory' ? 'primary' : ''}`} onClick={() => setTab('regulatory')}>Регулаторни документи</button>
      </div>

      {/* TRACEABILITY TAB */}
      {tab === 'trace' && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3>Генерирай проследимост</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
              <div style={{ flex: 1 }}>
                <label>Група</label>
                <select value={selectedGroup} onChange={e => setSelectedGroup(e.target.value)}>
                  <option value="">-- Изберете група --</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.group_name} ({g.category}) — {g.current_count} бр.</option>)}
                </select>
              </div>
              <button className="btn primary" onClick={generateTrace} disabled={generating || !selectedGroup}>
                {generating ? 'Генериране...' : 'Генерирай'}
              </button>
            </div>
          </div>

          {/* Chain View */}
          {traceData && (
            <TraceChainView data={typeof traceData.data === 'string' ? JSON.parse(traceData.data) : (traceData.data || traceData)} />
          )}

          {/* Previous records */}
          <div className="card" style={{ marginTop: 16 }}>
            <h3>Предишни записи</h3>
            <table>
              <thead><tr><th>Група</th><th>Дата</th><th>Генерирал</th><th></th></tr></thead>
              <tbody>
                {traceRecords.map(r => (
                  <tr key={r.id}>
                    <td><strong>{r.group_name}</strong></td>
                    <td>{fmtDate(r.generated_at)}</td>
                    <td>{r.generated_by_name || '-'}</td>
                    <td><button className="btn small" onClick={() => viewTraceRecord(r.id)}>Преглед</button></td>
                  </tr>
                ))}
                {traceRecords.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Няма записи</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* REGULATORY TAB */}
      {tab === 'regulatory' && (
        <div>
          {/* Stats */}
          {stats && (
            <div className="grid grid-3" style={{ marginBottom: 16 }}>
              <div className="stat-card blue">
                <div className="stat-value">{stats.total}</div>
                <div className="stat-label">Общо документи</div>
              </div>
              <div className="stat-card green">
                <div className="stat-value">{stats.byType?.filter(s => s.status === 'final').reduce((s, r) => s + parseInt(r.count), 0) || 0}</div>
                <div className="stat-label">Финализирани</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{stats.byType?.filter(s => s.status === 'submitted').reduce((s, r) => s + parseInt(r.count), 0) || 0}</div>
                <div className="stat-label">Подадени</div>
              </div>
            </div>
          )}

          {/* Generate form */}
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
                      {dispatches.map(d => <option key={d.id} value={d.id}>#{d.id} — {d.group_name} ({d.status})</option>)}
                    </select>
                  </div>
                )}
                <button type="submit" className="btn primary">Генерирай</button>
              </div>
            </form>
          </div>

          {/* Documents table */}
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
                    <td><span className={`badge ${STATUS_COLOR[d.status]}`}>{STATUS_BG[d.status]}</span></td>
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

          {/* Document preview modal */}
          {viewDoc && (
            <div className="modal-backdrop" onClick={() => setViewDoc(null)}>
              <div className="modal" style={{ maxWidth: 800, maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
                <h3>{viewDoc.title} <span className={`badge ${STATUS_COLOR[viewDoc.status]}`}>{STATUS_BG[viewDoc.status]}</span></h3>
                <p><strong>Реф.:</strong> {viewDoc.reference_number} | <strong>Период:</strong> {fmtDate(viewDoc.period_from)} — {fmtDate(viewDoc.period_to)}</p>
                <DocumentPreview doc={viewDoc} />
                <div style={{ marginTop: 12, textAlign: 'right' }}>
                  <button className="btn" onClick={() => setViewDoc(null)}>Затвори</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}

function TraceChainView({ data }) {
  if (!data) return null
  const [openSections, setOpenSections] = useState({ batch: true, genetics: true, feed: true, vet: true, withdrawals: true, transport: true })
  const toggle = (key) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }))

  const sections = [
    { key: 'batch', title: 'Партида', icon: '📦', color: '#3498db',
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
    { key: 'genetics', title: 'Генетика', icon: '🧬', color: '#9b59b6',
      render: () => data.genetics?.length > 0 ? (
        <table><thead><tr><th>Майка</th><th>Порода</th><th>Паритет</th><th>Родени живи</th></tr></thead>
        <tbody>{data.genetics.map((g, i) => <tr key={i}><td>{g.ear_tag}</td><td>{g.breed || '-'}</td><td>{g.parity_number}</td><td>{g.born_alive}</td></tr>)}</tbody></table>
      ) : <p style={{ color: 'var(--text-secondary)' }}>Няма генетични данни</p>
    },
    { key: 'feed', title: 'Фураж', icon: '🌾', color: '#f39c12',
      render: () => data.feed?.length > 0 ? (
        <table><thead><tr><th>Силоз</th><th>Рецепта</th><th>Ниво (т.)</th></tr></thead>
        <tbody>{data.feed.map((f, i) => <tr key={i}><td>{f.silo_name}</td><td>{f.recipe_name || f.feed_type}</td><td>{f.current_level_tons}</td></tr>)}</tbody></table>
      ) : <p style={{ color: 'var(--text-secondary)' }}>Няма данни за фуражи</p>
    },
    { key: 'vet', title: 'Ветеринарен дневник', icon: '💉', color: '#e74c3c',
      render: () => data.vet?.length > 0 ? (
        <table><thead><tr><th>Дата</th><th>Тип</th><th>Детайли</th><th>Извършил</th></tr></thead>
        <tbody>{data.vet.map((v, i) => <tr key={i}><td>{fmtDate(v.event_date)}</td><td>{v.event_type}</td><td>{typeof v.details === 'object' ? JSON.stringify(v.details) : v.details}</td><td>{v.performed_by_name || '-'}</td></tr>)}</tbody></table>
      ) : <p style={{ color: 'var(--text-secondary)' }}>Няма ветеринарни събития</p>
    },
    { key: 'withdrawals', title: 'Карентни срокове', icon: '⏱️', color: '#e67e22',
      render: () => data.withdrawals?.length > 0 ? (
        <table><thead><tr><th>Медикамент</th><th>Начало</th><th>Край</th><th>Статус</th></tr></thead>
        <tbody>{data.withdrawals.map((w, i) => <tr key={i}><td>{w.medicine_name}</td><td>{fmtDate(w.start_date)}</td><td>{fmtDate(w.end_date)}</td>
        <td><span className={`badge ${w.status === 'active' ? 'red' : 'green'}`}>{w.status === 'active' ? 'Активен' : 'Изтекъл'}</span></td></tr>)}</tbody></table>
      ) : <p style={{ color: 'var(--text-secondary)' }}>Няма карентни срокове — <span style={{ color: 'var(--success)' }}>✅ Чиста група</span></p>
    },
    { key: 'transport', title: 'Транспорт', icon: '🚛', color: '#2ecc71',
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
            {s.icon} {s.title} {openSections[s.key] ? '▼' : '▶'}
          </h3>
          {openSections[s.key] && <div style={{ marginTop: 8 }}>{s.render()}</div>}
        </div>
      ))}
    </div>
  )
}

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
          {data.balanceCheck ? '✅ Балансът е коректен' : '⚠️ Несъответствие в баланса'}
        </div>
      </div>
    )
  }

  return <pre style={{ fontSize: 12, overflow: 'auto' }}>{JSON.stringify(data, null, 2)}</pre>
}
