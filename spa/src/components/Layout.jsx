import { useState, useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext.jsx'
import { api } from '../api.js'
import AgentChat from './AgentChat.jsx'

const ROLE_LABELS = {
  admin: 'Администратор',
  production_manager: 'Организатор производство',
  zooeng: 'Зооинженер / Лекар',
  farm_worker: 'Животновъд',
  driver: 'Шофьор / Тракторист',
  cleaner: 'Чистач / Общ работник'
}

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [newAlertCount, setNewAlertCount] = useState(0)

  useEffect(() => {
    const fetchCount = () => { api('alerts.countNew').then(r => setNewAlertCount(r.count || 0)).catch(() => {}) }
    fetchCount()
    const interval = setInterval(fetchCount, 60000)
    return () => clearInterval(interval)
  }, [])

  const handleLogout = () => { logout(); navigate('/login'); }

  return (
    <div className="layout">
      <div className="mobile-header">
        <button className="hamburger" onClick={() => setSidebarOpen(!sidebarOpen)}>&#9776;</button>
        <span style={{ fontWeight: 600 }}>Pig-Tech ERP</span>
      </div>
      {sidebarOpen && <div className="mobile-overlay" onClick={() => setSidebarOpen(false)} style={{display:'block'}} />}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2>Pig-Tech ERP</h2>
        </div>
        <nav className="sidebar-nav" onClick={() => setSidebarOpen(false)}>
          <NavLink to="/dashboard" end>&#128202; Табло</NavLink>
          <NavLink to="/alerts">&#128276; Аларми{newAlertCount > 0 && <span className="nav-badge">{newAlertCount > 99 ? '99+' : newAlertCount}</span>}</NavLink>
          <NavLink to="/animals">&#128055; Разплод</NavLink>
          <NavLink to="/groups">&#128230; Партиди</NavLink>
          <NavLink to="/events">&#128221; Събития</NavLink>
          <NavLink to="/feed">&#127806; Фуражи</NavLink>
          <NavLink to="/finance">&#128176; Финанси</NavLink>
          <NavLink to="/sales">&#128181; Продажби</NavLink>
          <NavLink to="/expenses">&#128200; Разходи</NavLink>
          <NavLink to="/reports">&#128203; Отчети</NavLink>
          <NavLink to="/logistics">&#128666; Логистика</NavLink>
          <NavLink to="/halls">&#127970; Халета</NavLink>
          <NavLink to="/biosecurity">&#128737; Биосигурност</NavLink>
          <NavLink to="/bonuses">&#127942; Бонуси</NavLink>
          <NavLink to="/settings">&#9881; Настройки</NavLink>
        </nav>
        <div className="sidebar-user">
          <div className="user-name">{user?.name}</div>
          <div className="user-role">{ROLE_LABELS[user?.role] || user?.role}</div>
          <button onClick={handleLogout}>Изход</button>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
      <button className={`agent-fab ${chatOpen ? 'open' : ''}`} onClick={() => setChatOpen(!chatOpen)}>
        {chatOpen
          ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        }
      </button>
      <AgentChat isOpen={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  )
}
