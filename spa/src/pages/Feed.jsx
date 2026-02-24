import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

export default function Feed() {
  const { user } = useAuth()
  const [tab, setTab] = useState('recipes')
  const [recipes, setRecipes] = useState([])
  const [components, setComponents] = useState([])
  const [inventory, setInventory] = useState([])
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [showProduce, setShowProduce] = useState(false)
  const [showPrice, setShowPrice] = useState(null)
  const [produceForm, setProduceForm] = useState({ recipe_id: '', quantity_tons: '' })
  const [newPrice, setNewPrice] = useState('')

  useEffect(() => {
    Promise.all([
      api('feed.recipes.list').then(r => setRecipes(r.recipes)),
      api('feed.components.list').then(r => setComponents(r.components)),
      api('feed.inventory').then(r => setInventory(r.inventory)),
      api('feed.batches.list', {}).then(r => setBatches(r.batches))
    ]).catch(console.error).finally(() => setLoading(false))
  }, [])

  const updatePrice = async () => {
    if (!showPrice || !newPrice) return
    try {
      const res = await api('feed.updatePrice', { component_id: showPrice.id, price_per_ton: parseFloat(newPrice) })
      setRecipes(res.recipes)
      setShowPrice(null)
      setNewPrice('')
      // Reload components
      api('feed.components.list').then(r => setComponents(r.components))
    } catch (e) { alert(e.message) }
  }

  const produce = async (e) => {
    e.preventDefault()
    try {
      await api('feed.produce', {
        recipe_id: parseInt(produceForm.recipe_id),
        quantity_tons: parseFloat(produceForm.quantity_tons),
        produced_by: user?.id
      })
      setShowProduce(false)
      setProduceForm({ recipe_id: '', quantity_tons: '' })
      // Reload
      api('feed.inventory').then(r => setInventory(r.inventory))
      api('feed.batches.list', {}).then(r => setBatches(r.batches))
      api('feed.components.list').then(r => setComponents(r.components))
    } catch (err) { alert(err.message) }
  }

  if (loading) return <div className="loading">Зареждане...</div>

  return (
    <>
      <div className="page-header">
        <h1>Управление на фуражи</h1>
        <button className="btn btn-primary" onClick={() => setShowProduce(true)}>+ Производство</button>
      </div>

      <div className="tabs">
        <div className={`tab ${tab === 'recipes' ? 'active' : ''}`} onClick={() => setTab('recipes')}>Рецепти</div>
        <div className={`tab ${tab === 'components' ? 'active' : ''}`} onClick={() => setTab('components')}>Суровини</div>
        <div className={`tab ${tab === 'inventory' ? 'active' : ''}`} onClick={() => setTab('inventory')}>Складова наличност</div>
        <div className={`tab ${tab === 'batches' ? 'active' : ''}`} onClick={() => setTab('batches')}>Производство</div>
      </div>

      {tab === 'recipes' && (
        <div className="grid grid-2">
          {recipes.map(r => (
            <div key={r.id} className="card">
              <h3>{r.name_bg || r.name}</h3>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--primary)', marginBottom: 12 }}>
                &euro;{parseFloat(r.cost_per_ton).toFixed(2)} / тон
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>Фира: {r.shrinkage_pct}%</div>
              {r.components && (
                <table>
                  <thead><tr><th>Компонент</th><th>%</th><th>Цена/тон</th></tr></thead>
                  <tbody>
                    {r.components.map((c, i) => (
                      <tr key={i}>
                        <td>{c.component_name_bg || c.component_name}</td>
                        <td>{c.percentage}%</td>
                        <td>&euro;{parseFloat(c.price_per_ton).toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'components' && (
        <div className="card">
          <h3>Суровини и цени</h3>
          <table>
            <thead><tr><th>Компонент</th><th>Цена/тон (EUR)</th><th>Наличност (кг)</th><th>Мин. праг (кг)</th><th>Действие</th></tr></thead>
            <tbody>
              {components.map(c => (
                <tr key={c.id}>
                  <td><strong>{c.name_bg || c.name}</strong></td>
                  <td>&euro;{parseFloat(c.price_per_ton).toFixed(2)}</td>
                  <td>{parseFloat(c.current_stock_kg).toLocaleString('bg-BG')}</td>
                  <td>{parseFloat(c.reorder_threshold_kg).toLocaleString('bg-BG')}</td>
                  <td><button className="btn btn-outline btn-sm" onClick={() => { setShowPrice(c); setNewPrice(c.price_per_ton) }}>Обнови цена</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'inventory' && (
        <div className="card">
          <h3>Складова наличност</h3>
          <table>
            <thead><tr><th>Компонент</th><th>Наличност (кг)</th><th>Дн. консумация</th><th>Дни запас</th><th>Статус</th></tr></thead>
            <tbody>
              {inventory.map(c => (
                <tr key={c.id}>
                  <td><strong>{c.name_bg || c.name}</strong></td>
                  <td>{parseFloat(c.current_stock_kg).toLocaleString('bg-BG')}</td>
                  <td>{c.daily_consumption_kg > 0 ? `${c.daily_consumption_kg.toLocaleString('bg-BG')} кг` : '-'}</td>
                  <td>{c.days_of_supply ?? '-'}</td>
                  <td>
                    {c.below_threshold
                      ? <span className="badge red">Под минимума</span>
                      : c.days_of_supply && c.days_of_supply < 14
                        ? <span className="badge yellow">Ниско</span>
                        : <span className="badge green">OK</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'batches' && (
        <div className="card">
          <h3>История на производството</h3>
          <table>
            <thead><tr><th>Дата</th><th>Рецепта</th><th>Количество</th><th>Произведено от</th></tr></thead>
            <tbody>
              {batches.map(b => (
                <tr key={b.id}>
                  <td>{new Date(b.batch_date).toLocaleDateString('bg-BG')}</td>
                  <td>{b.recipe_name_bg || b.recipe_name}</td>
                  <td><strong>{b.quantity_tons} тона</strong></td>
                  <td>{b.produced_by_name || '-'}</td>
                </tr>
              ))}
              {batches.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Няма производствени партиди</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Price update modal */}
      {showPrice && (
        <div className="modal-overlay" onClick={() => setShowPrice(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Обновяване на цена: {showPrice.name_bg || showPrice.name}</h2>
            <div className="form-group">
              <label>Нова цена за тон (EUR)</label>
              <input type="number" step="0.01" value={newPrice} onChange={e => setNewPrice(e.target.value)} />
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Всички рецепти, съдържащи тази суровина, ще бъдат автоматично преизчислени.</p>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setShowPrice(null)}>Отказ</button>
              <button className="btn btn-primary" onClick={updatePrice}>Запиши</button>
            </div>
          </div>
        </div>
      )}

      {/* Produce modal */}
      {showProduce && (
        <div className="modal-overlay" onClick={() => setShowProduce(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Производство на фураж</h2>
            <form onSubmit={produce}>
              <div className="form-group">
                <label>Рецепта</label>
                <select value={produceForm.recipe_id} onChange={e => setProduceForm(p => ({ ...p, recipe_id: e.target.value }))} required>
                  <option value="">-- Изберете рецепта --</option>
                  {recipes.map(r => <option key={r.id} value={r.id}>{r.name_bg || r.name} (&euro;{parseFloat(r.cost_per_ton).toFixed(0)}/тон)</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Количество (тонове)</label>
                <input type="number" step="0.1" min="0.1" value={produceForm.quantity_tons} onChange={e => setProduceForm(p => ({ ...p, quantity_tons: e.target.value }))} required />
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '12px 0' }}>
                Суровините ще бъдат автоматично приспаднати от склада (вкл. 0.5% фира).
              </p>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowProduce(false)}>Отказ</button>
                <button type="submit" className="btn btn-primary">Произведи</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
