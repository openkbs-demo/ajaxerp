import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Animals from './pages/Animals.jsx'
import SowCard from './pages/SowCard.jsx'
import Events from './pages/Events.jsx'
import Feed from './pages/Feed.jsx'
import Alerts from './pages/Alerts.jsx'
import Halls from './pages/Halls.jsx'
import Finance from './pages/Finance.jsx'
import Sales from './pages/Sales.jsx'
import Expenses from './pages/Expenses.jsx'
import Reports from './pages/Reports.jsx'
import Logistics from './pages/Logistics.jsx'
import Dispatch from './pages/Dispatch.jsx'
import Biosecurity from './pages/Biosecurity.jsx'
import Bonuses from './pages/Bonuses.jsx'
import Traceability from './pages/Traceability.jsx'

function PrivateRoute({ children }) {
  const { user } = useAuth()
  return user ? children : <Navigate to="/login" />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="animals" element={<Animals />} />
        <Route path="animals/:id" element={<SowCard />} />
        <Route path="events" element={<Events />} />
        <Route path="feed" element={<Feed />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="halls" element={<Halls />} />
        <Route path="finance" element={<Finance />} />
        <Route path="sales" element={<Sales />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="reports" element={<Reports />} />
        <Route path="logistics" element={<Logistics />} />
        <Route path="dispatch" element={<Dispatch />} />
        <Route path="biosecurity" element={<Biosecurity />} />
        <Route path="bonuses" element={<Bonuses />} />
        <Route path="traceability" element={<Traceability />} />
      </Route>
    </Routes>
  )
}
