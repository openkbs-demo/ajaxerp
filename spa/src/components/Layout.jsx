import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext.jsx'
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
          <NavLink to="/animals">&#128055; Животни</NavLink>
          <NavLink to="/events">&#128221; Събития</NavLink>
          <NavLink to="/feed">&#127806; Фуражи</NavLink>
          <NavLink to="/finance">&#128176; Финанси</NavLink>
          <NavLink to="/sales">&#128181; Продажби</NavLink>
          <NavLink to="/expenses">&#128200; Разходи</NavLink>
          <NavLink to="/reports">&#128203; Отчети</NavLink>
          <NavLink to="/logistics">&#128666; Логистика</NavLink>
          <NavLink to="/dispatch">&#128230; Експедиция</NavLink>
          <NavLink to="/alerts">&#128276; Аларми</NavLink>
          <NavLink to="/halls">&#127970; Халета</NavLink>
          <NavLink to="/biosecurity">&#128737; Биосигурност</NavLink>
          <NavLink to="/bonuses">&#127942; Бонуси</NavLink>
          <NavLink to="/traceability">&#128269; Проследимост</NavLink>
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
        {chatOpen ? '\u2715' : '\uD83E\uDD16'}
      </button>
      <AgentChat isOpen={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  )
}
