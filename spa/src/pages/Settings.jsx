import { useState } from 'react'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

export default function Settings() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(null)
  const [result, setResult] = useState(null)
  const [confirm, setConfirm] = useState(null)

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

  return (
    <div className="page">
      <h2>Настройки</h2>

      <div className="card" style={{ marginTop: 20 }}>
        <h3>База данни</h3>
        <p style={{ color: '#666', fontSize: 14, margin: '8px 0 16px' }}>
          Управление на базата данни — зареждане на начални данни или пълно изчистване.
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            disabled={!!loading}
            onClick={() => run('seed', 'seed')}
          >
            {loading === 'seed' ? 'Зареждане...' : 'Зареди начални данни (Seed)'}
          </button>

          {confirm !== 'reset' ? (
            <button
              className="btn btn-outline"
              style={{ borderColor: '#c62828', color: '#c62828' }}
              disabled={!!loading}
              onClick={() => setConfirm('reset')}
            >
              Изчисти базата (Reset)
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ color: '#c62828', fontSize: 13 }}>Сигурни ли сте? Всички данни ще бъдат изтрити!</span>
              <button
                className="btn btn-sm"
                style={{ background: '#c62828' }}
                disabled={!!loading}
                onClick={() => run('reset', 'reset')}
              >
                {loading === 'reset' ? 'Изтриване...' : 'Да, изтрий'}
              </button>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => setConfirm(null)}
              >
                Отказ
              </button>
            </div>
          )}
        </div>

        {result && (
          <div style={{
            marginTop: 16, padding: '10px 14px', borderRadius: 6,
            background: result.ok ? '#e8f5e9' : '#ffebee',
            color: result.ok ? '#2e7d32' : '#c62828',
            fontSize: 14
          }}>
            {result.message}
          </div>
        )}
      </div>
    </div>
  )
}
