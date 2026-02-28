import { useState, useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext.jsx'
import { api } from '../api.js'
import { LayoutDashboard, Bell, PiggyBank, Package, CalendarDays, Leaf, DollarSign, TrendingUp, Wallet, FileText, Truck, Warehouse, ShieldCheck, Award, Settings, Menu } from 'lucide-react'
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
        <button className="hamburger" onClick={() => setSidebarOpen(!sidebarOpen)}><Menu size={22} /></button>
        <span style={{ fontWeight: 600 }}>Pig-Tech ERP</span>
      </div>
      {sidebarOpen && <div className="mobile-overlay" onClick={() => setSidebarOpen(false)} style={{display:'block'}} />}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2>Pig-Tech ERP</h2>
        </div>
        <nav className="sidebar-nav" onClick={() => setSidebarOpen(false)}>
          <NavLink to="/dashboard" end><LayoutDashboard size={18} /> Табло</NavLink>
          <NavLink to="/alerts"><Bell size={18} /> Аларми{newAlertCount > 0 && <span className="nav-badge">{newAlertCount > 99 ? '99+' : newAlertCount}</span>}</NavLink>
          <NavLink to="/animals"><PiggyBank size={18} /> Разплод</NavLink>
          <NavLink to="/groups"><Package size={18} /> Партиди</NavLink>
          <NavLink to="/events"><CalendarDays size={18} /> Събития</NavLink>
          <NavLink to="/feed"><Leaf size={18} /> Фуражи</NavLink>
          <NavLink to="/finance"><DollarSign size={18} /> Финанси</NavLink>
          <NavLink to="/sales"><TrendingUp size={18} /> Продажби</NavLink>
          <NavLink to="/expenses"><Wallet size={18} /> Разходи</NavLink>
          <NavLink to="/reports"><FileText size={18} /> Отчети</NavLink>
          <NavLink to="/logistics"><Truck size={18} /> Логистика</NavLink>
          <NavLink to="/halls"><Warehouse size={18} /> Халета</NavLink>
          <NavLink to="/biosecurity"><ShieldCheck size={18} /> Биосигурност</NavLink>
          <NavLink to="/bonuses"><Award size={18} /> Бонуси</NavLink>
          <NavLink to="/settings"><Settings size={18} /> Настройки</NavLink>
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
