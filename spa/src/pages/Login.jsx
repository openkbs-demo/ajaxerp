import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext.jsx'
import { api } from '../api.js'

export default function Login() {
  const [isRegister, setIsRegister] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const action = isRegister ? 'auth.register' : 'auth.login'
      const data = isRegister ? { name, email, password } : { email, password }
      const res = await api(action, data)
      login(res.user)
      navigate('/dashboard')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Pig-Tech ERP</h1>
        <p className="subtitle">{isRegister ? 'Регистрация на нов потребител' : 'Влезте в системата'}</p>
        {error && <div className="login-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          {isRegister && (
            <div className="form-group">
              <label>Име</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Три имена" required />
            </div>
          )}
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@ajaxerp.com" required />
          </div>
          <div className="form-group">
            <label>Парола</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="********" required />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Зареждане...' : (isRegister ? 'Регистрация' : 'Вход')}
          </button>
        </form>
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button onClick={() => { setIsRegister(!isRegister); setError('') }}
            style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: 13 }}>
            {isRegister ? 'Вече имам акаунт' : 'Нямам акаунт - Регистрация'}
          </button>
        </div>
      </div>
    </div>
  )
}
