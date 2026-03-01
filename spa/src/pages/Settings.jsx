import { useState, useEffect, useCallback } from 'react'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

const ROLE_LABELS = {
  admin: 'Администратор',
  production_manager: 'Организатор производство',
  zooeng: 'Зооинженер / Лекар',
  farm_worker: 'Животновъд',
  driver: 'Шофьор / Тракторист',
  cleaner: 'Чистач / Общ работник'
}
const ROLES = Object.keys(ROLE_LABELS)

const AI_PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'openai', label: 'OpenAI (GPT)' }
]

const AI_MODELS = {
  anthropic: [
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — $3/$15 за MTok (Препоръчан)', default: true },
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6 — $5/$25 за MTok (Най-интелигентен)' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — $1/$5 за MTok (Най-бърз)' },
    { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5 — $3/$15 за MTok' },
    { value: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5 — $5/$25 за MTok' },
  ],
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o — $2.50/$10 за MTok (Препоръчан)', default: true },
    { value: 'gpt-4o-mini', label: 'GPT-4o mini — $0.15/$0.60 за MTok (Най-бърз)' },
    { value: 'o3', label: 'o3 — $10/$40 за MTok (Reasoning)' },
    { value: 'o4-mini', label: 'o4-mini — $1.10/$4.40 за MTok (Reasoning бърз)' },
    { value: 'gpt-4.1', label: 'GPT-4.1 — $2/$8 за MTok (Coding)' },
  ]
}

export default function Settings() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(null)
  const [result, setResult] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [tab, setTab] = useState('users')

  // User management state
  const [personnel, setPersonnel] = useState([])
  const [editUser, setEditUser] = useState(null)
  const [newUser, setNewUser] = useState(null)
  const [resetPw, setResetPw] = useState(null)
  const [msg, setMsg] = useState(null)

  // AI settings state
  const [aiProvider, setAiProvider] = useState('anthropic')
  const [aiModel, setAiModel] = useState('claude-sonnet-4-6')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [showAnthropicKey, setShowAnthropicKey] = useState(false)
  const [openaiKey, setOpenaiKey] = useState('')
  const [showOpenaiKey, setShowOpenaiKey] = useState(false)
  const [aiMsg, setAiMsg] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [siteHostname, setSiteHostname] = useState('')

  const loadPersonnel = useCallback(async () => {
    try {
      const res = await api('personnel.list')
      setPersonnel(res.personnel || [])
    } catch {}
  }, [])

  const loadAiSettings = useCallback(async () => {
    try {
      const res = await api('settings.getAll')
      const s = res.settings || {}
      if (s.ai_provider) setAiProvider(s.ai_provider)
      if (s.ai_model) setAiModel(s.ai_model)
      if (s.anthropic_api_key) setAnthropicKey(s.anthropic_api_key)
      if (s.openai_api_key) setOpenaiKey(s.openai_api_key)
      if (s.site_hostname) setSiteHostname(s.site_hostname)
    } catch {}
  }, [])

  useEffect(() => { loadPersonnel() }, [loadPersonnel])
  useEffect(() => { loadAiSettings() }, [loadAiSettings])

  if (user?.role !== 'admin') {
    return <div className="page"><h2>Настройки</h2><p>Само администратори имат достъп до тази страница.</p></div>
  }

  const run = async (action, label) => {
    setLoading(label)
    setResult(null)
    try {
      const res = await api(action)
      setResult({ ok: true, message: res.message || 'Успешно.' })
    } catch (err) {
      setResult({ ok: false, message: err.message })
    } finally {
      setLoading(null)
      setConfirm(null)
    }
  }

  const handleCreateUser = async (e) => {
    e.preventDefault()
    setMsg(null)
    try {
      await api('personnel.create', newUser)
      setMsg({ ok: true, text: 'Потребителят е създаден.' })
      setNewUser(null)
      loadPersonnel()
    } catch (err) { setMsg({ ok: false, text: err.message }) }
  }

  const handleUpdateUser = async (e) => {
    e.preventDefault()
    setMsg(null)
    try {
      await api('personnel.update', editUser)
      setMsg({ ok: true, text: 'Потребителят е обновен.' })
      setEditUser(null)
      loadPersonnel()
    } catch (err) { setMsg({ ok: false, text: err.message }) }
  }

  const handleToggleActive = async (p) => {
    try {
      await api('personnel.update', { id: p.id, is_active: !p.is_active })
      loadPersonnel()
    } catch {}
  }

  const handleResetPassword = async (e) => {
    e.preventDefault()
    setMsg(null)
    try {
      await api('personnel.resetPassword', { id: resetPw.id, new_password: resetPw.new_password })
      setMsg({ ok: true, text: 'Паролата е сменена.' })
      setResetPw(null)
    } catch (err) { setMsg({ ok: false, text: err.message }) }
  }

  return (
    <div className="page">
      <h2>Настройки</h2>

      <div className="tabs">
        <div className={`tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>Потребители</div>
        <div className={`tab ${tab === 'ai' ? 'active' : ''}`} onClick={() => setTab('ai')}>AI Настройки</div>
        <div className={`tab ${tab === 'db' ? 'active' : ''}`} onClick={() => setTab('db')}>База данни</div>
      </div>

      {tab === 'users' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3>Потребители ({personnel.length})</h3>
            <button className="btn btn-primary btn-sm" onClick={() => { setNewUser({ name: '', email: '', password: '', role: 'farm_worker', phone: '' }); setEditUser(null); setResetPw(null); setMsg(null) }}>
              + Нов потребител
            </button>
          </div>

          {msg && (
            <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, background: msg.ok ? '#e8f5e9' : '#ffebee', color: msg.ok ? '#2e7d32' : '#c62828', fontSize: 13 }}>
              {msg.text}
            </div>
          )}

          {newUser && (
            <form onSubmit={handleCreateUser} className="card" style={{ background: '#f5f5f5', marginBottom: 16, padding: 16 }}>
              <h4 style={{ marginBottom: 12 }}>Нов потребител</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div><label>Име *</label><input required value={newUser.name} onChange={e => setNewUser({ ...newUser, name: e.target.value })} /></div>
                <div><label>Email *</label><input required type="email" value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} /></div>
                <div><label>Парола *</label><input required type="password" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} /></div>
                <div><label>Роля</label>
                  <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}>
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                </div>
                <div><label>Телефон</label><input value={newUser.phone} onChange={e => setNewUser({ ...newUser, phone: e.target.value })} /></div>
              </div>
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary btn-sm">Създай</button>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setNewUser(null)}>Отказ</button>
              </div>
            </form>
          )}

          {editUser && (
            <form onSubmit={handleUpdateUser} className="card" style={{ background: '#e3f2fd', marginBottom: 16, padding: 16 }}>
              <h4 style={{ marginBottom: 12 }}>Редактиране: {editUser.name}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div><label>Име</label><input value={editUser.name} onChange={e => setEditUser({ ...editUser, name: e.target.value })} /></div>
                <div><label>Email</label><input type="email" value={editUser.email} onChange={e => setEditUser({ ...editUser, email: e.target.value })} /></div>
                <div><label>Роля</label>
                  <select value={editUser.role} onChange={e => setEditUser({ ...editUser, role: e.target.value })}>
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                </div>
                <div><label>Телефон</label><input value={editUser.phone || ''} onChange={e => setEditUser({ ...editUser, phone: e.target.value })} /></div>
              </div>
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary btn-sm">Запази</button>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditUser(null)}>Отказ</button>
              </div>
            </form>
          )}

          {resetPw && (
            <form onSubmit={handleResetPassword} className="card" style={{ background: '#fff3e0', marginBottom: 16, padding: 16 }}>
              <h4 style={{ marginBottom: 12 }}>Смяна на парола: {resetPw.name}</h4>
              <div style={{ maxWidth: 300 }}>
                <label>Нова парола *</label>
                <input required type="password" value={resetPw.new_password} onChange={e => setResetPw({ ...resetPw, new_password: e.target.value })} />
              </div>
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary btn-sm">Смени паролата</button>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setResetPw(null)}>Отказ</button>
              </div>
            </form>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Име</th><th>Email</th><th>Роля</th><th>Телефон</th><th>Статус</th><th>Действия</th></tr>
              </thead>
              <tbody>
                {personnel.map(p => (
                  <tr key={p.id} style={{ opacity: p.is_active ? 1 : 0.5 }}>
                    <td>{p.name}</td>
                    <td style={{ fontSize: 12 }}>{p.email}</td>
                    <td>{ROLE_LABELS[p.role] || p.role}</td>
                    <td style={{ fontSize: 12 }}>{p.phone || '—'}</td>
                    <td>
                      <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, background: p.is_active ? '#e8f5e9' : '#ffebee', color: p.is_active ? '#2e7d32' : '#c62828' }}>
                        {p.is_active ? 'Активен' : 'Неактивен'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-outline btn-sm" style={{ fontSize: 11, padding: '2px 8px' }}
                          onClick={() => { setEditUser({ id: p.id, name: p.name, email: p.email, role: p.role, phone: p.phone }); setNewUser(null); setResetPw(null); setMsg(null) }}>
                          Редактирай
                        </button>
                        <button className="btn btn-outline btn-sm" style={{ fontSize: 11, padding: '2px 8px' }}
                          onClick={() => { setResetPw({ id: p.id, name: p.name, new_password: '' }); setNewUser(null); setEditUser(null); setMsg(null) }}>
                          Парола
                        </button>
                        <button className="btn btn-outline btn-sm"
                          style={{ fontSize: 11, padding: '2px 8px', borderColor: p.is_active ? '#c62828' : '#2e7d32', color: p.is_active ? '#c62828' : '#2e7d32' }}
                          onClick={() => handleToggleActive(p)}>
                          {p.is_active ? 'Деактивирай' : 'Активирай'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'ai' && (
        <div className="card">
          <h3>AI Настройки</h3>
          <p style={{ color: '#666', fontSize: 13, margin: '8px 0 16px' }}>
            Настройки за AI агента — доставчик, модел, API ключове и гласово управление. Тези данни се пазят при нулиране на базата.
          </p>

          {aiMsg && (
            <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, background: aiMsg.ok ? '#e8f5e9' : '#ffebee', color: aiMsg.ok ? '#2e7d32' : '#c62828', fontSize: 13 }}>
              {aiMsg.text}
            </div>
          )}

          <div style={{ display: 'grid', gap: 16, maxWidth: 500 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 13 }}>Доставчик</label>
              <select value={aiProvider} onChange={e => { setAiProvider(e.target.value); setAiModel(AI_MODELS[e.target.value]?.find(m => m.default)?.value || AI_MODELS[e.target.value]?.[0]?.value || '') }}>
                {AI_PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 13 }}>Модел</label>
              <select value={aiModel} onChange={e => setAiModel(e.target.value)}>
                {(AI_MODELS[aiProvider] || []).map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 13 }}>Anthropic API Ключ</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type={showAnthropicKey ? 'text' : 'password'}
                  value={anthropicKey}
                  onChange={e => setAnthropicKey(e.target.value)}
                  placeholder="sk-ant-..."
                  style={{ flex: 1 }}
                />
                <button className="btn btn-outline btn-sm" onClick={() => setShowAnthropicKey(!showAnthropicKey)} style={{ whiteSpace: 'nowrap' }}>
                  {showAnthropicKey ? 'Скрий' : 'Покажи'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 13 }}>OpenAI API Ключ</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type={showOpenaiKey ? 'text' : 'password'}
                  value={openaiKey}
                  onChange={e => setOpenaiKey(e.target.value)}
                  placeholder="sk-..."
                  style={{ flex: 1 }}
                />
                <button className="btn btn-outline btn-sm" onClick={() => setShowOpenaiKey(!showOpenaiKey)} style={{ whiteSpace: 'nowrap' }}>
                  {showOpenaiKey ? 'Скрий' : 'Покажи'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com</a> — използва се и за гласово разпознаване
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 13 }}>Hostname на сайта</label>
              <input
                value={siteHostname}
                onChange={e => setSiteHostname(e.target.value)}
                placeholder="erp.example.com"
              />
              <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
                Използва се за генериране на медийни URL-и (напр. https://hostname/media/...).
              </div>
            </div>
          </div>

          <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" disabled={aiLoading} onClick={async () => {
              setAiLoading(true)
              setAiMsg(null)
              try {
                await api('settings.set', { key: 'ai_provider', value: aiProvider })
                await api('settings.set', { key: 'ai_model', value: aiModel })
                await api('settings.set', { key: 'anthropic_api_key', value: anthropicKey })
                await api('settings.set', { key: 'openai_api_key', value: openaiKey })
                await api('settings.set', { key: 'site_hostname', value: siteHostname })
                setAiMsg({ ok: true, text: 'AI настройките са запазени.' })
              } catch (e) {
                setAiMsg({ ok: false, text: e.message })
              } finally { setAiLoading(false) }
            }}>
              {aiLoading ? 'Запазване...' : 'Запази'}
            </button>
          </div>
        </div>
      )}

      {tab === 'db' && (
        <div className="card">
          <h3>База данни</h3>
          <p style={{ color: '#666', fontSize: 14, margin: '8px 0 16px' }}>
            Управление на базата данни — зареждане на начални данни или пълно изчистване.
          </p>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" disabled={!!loading} onClick={() => run('seed', 'seed')}>
              {loading === 'seed' ? 'Зареждане...' : 'Зареди начални данни (Seed)'}
            </button>

            {confirm !== 'reset' ? (
              <button className="btn btn-outline" style={{ borderColor: '#c62828', color: '#c62828' }} disabled={!!loading} onClick={() => setConfirm('reset')}>
                Изчисти базата (Reset)
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ color: '#c62828', fontSize: 13 }}>Сигурни ли сте? Всички данни ще бъдат изтрити!</span>
                <button className="btn btn-sm" style={{ background: '#c62828' }} disabled={!!loading} onClick={() => run('reset', 'reset')}>
                  {loading === 'reset' ? 'Изтриване...' : 'Да, изтрий'}
                </button>
                <button className="btn btn-outline btn-sm" onClick={() => setConfirm(null)}>Отказ</button>
              </div>
            )}
          </div>

          {result && (
            <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 6, background: result.ok ? '#e8f5e9' : '#ffebee', color: result.ok ? '#2e7d32' : '#c62828', fontSize: 14 }}>
              {result.message}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
