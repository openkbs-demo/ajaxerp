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

  const loadPersonnel = useCallback(async () => {
    try {
      const res = await api('personnel.list')
      setPersonnel(res.personnel || [])
    } catch {}
  }, [])

  useEffect(() => { loadPersonnel() }, [loadPersonnel])

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

      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={tab === 'users' ? 'tab active' : 'tab'} onClick={() => setTab('users')}>Потребители</button>
        <button className={tab === 'db' ? 'tab active' : 'tab'} onClick={() => setTab('db')}>База данни</button>
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
