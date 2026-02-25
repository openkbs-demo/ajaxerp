# Cross-Fostering: Partial Piglet Transfer & Multi-Litter Weaning

## Context
Cross-fostering (кърмачка) allows transferring some or all piglets from one sow's litter to be nursed by a different sow. The backend has a basic `litters.crossFoster` API but it only supports **whole-litter** assignment. The user needs:

1. **Inline action per litter row** in the Репродуктивна история table — not a separate button
2. **Partial transfers** — move N of M piglets to a nurse sow, the rest stay with the mother
3. **Multi-litter weaning** — when weaning, select which litters to wean together (multi-select)
4. **Nursed litter visible on nurse sow's card** — already works via nursing tab

## What already exists

| Component | Status | Location |
|-----------|--------|----------|
| DB `litters.nurse_sow_id` | ✅ | `functions/api/db.mjs:117` |
| API `litters.crossFoster` | ⚠️ Whole-litter only | `functions/api/index.mjs:988-1007` |
| Nursing tab (display) | ✅ | `spa/src/pages/SowCard.jsx:247-266` |
| Repro table "Кърмачка" column | ✅ | `spa/src/pages/SowCard.jsx:195` |
| Weaning handler | ⚠️ Single-litter only | `functions/api/index.mjs:790-838` |

## Data model approach: Litter splitting

When transferring 70 of 100 piglets to a nurse sow:
- **Original litter**: `born_alive` reduced from 100 → 30 (stays with mother)
- **New litter record created**: `born_alive` = 70, `birth_sow_id` = original mother, `nurse_sow_id` = nurse sow, same `parity_number` and `birth_date`

This reuses the existing litter table without schema changes. The nurse sow's "Кърмене" tab will automatically show the new litter (queries `WHERE nurse_sow_id = ?`). The mother's repro table will show both the original litter (reduced) and the transferred portion with the nurse ear tag.

## Changes

### 1. Backend: Extend `litters.crossFoster` to support partial transfers
**File:** `functions/api/index.mjs`, lines 988-1007

Add `piglet_count` parameter. If provided, split the litter:

```javascript
async function littersCrossFoster(db, { litter_id, nurse_sow_id, piglet_count }) {
  // ... existing validation ...
  const litter = litterRes.rows[0]

  if (piglet_count && piglet_count < litter.born_alive) {
    // Partial transfer: reduce original, create new litter for nurse
    await db.query('UPDATE litters SET born_alive = born_alive - $1 WHERE id = $2',
      [piglet_count, litter_id])
    await db.query(
      `INSERT INTO litters (birth_sow_id, nurse_sow_id, parity_number, born_alive, stillborn, mummified, birth_date)
       VALUES ($1, $2, $3, $4, 0, 0, $5)`,
      [litter.birth_sow_id, nurse_sow_id, litter.parity_number, piglet_count, litter.birth_date])
  } else {
    // Full transfer: just set nurse_sow_id on existing litter (current behavior)
    await db.query('UPDATE litters SET nurse_sow_id = $1 WHERE id = $2', [nurse_sow_id, litter_id])
  }

  // Record event on nurse sow (existing)
  await db.query(...)
  // Also record event on birth sow
  await db.query(
    `INSERT INTO events (event_type, animal_id, event_date, details)
     VALUES ('cross_fostering', $1, NOW(), $2)`,
    [litter.birth_sow_id, JSON.stringify({ litter_id, nurse_sow_id, piglet_count: piglet_count || litter.born_alive })])
}
```

### 2. Backend: Extend weaning to support multi-litter selection
**File:** `functions/api/index.mjs`, lines 790-838

Add optional `litter_ids` array in weaning details. If provided, wean specific litters instead of auto-detecting:

```javascript
if (event_type === 'weaning') {
  const d = details || {}
  const weanDate = event_date || new Date().toISOString()
  let litterIds = []

  if (d.litter_ids && d.litter_ids.length > 0) {
    // Multi-litter weaning: update all selected litters
    for (const lid of d.litter_ids) {
      await db.query(
        `UPDATE litters SET weaning_date = $1 WHERE id = $2 AND weaning_date IS NULL`,
        [weanDate, lid])
    }
    // Set weaned_count/weight on the primary litter (or distribute proportionally)
    await db.query(
      `UPDATE litters SET weaned_count = $1, weaning_weight_kg = $2 WHERE id = $3`,
      [d.weaned_count || 0, d.weaning_weight_kg || null, d.litter_ids[0]])
    litterIds = d.litter_ids
  } else {
    // Existing behavior: auto-find latest unweaned litter
    const litterUpd = await db.query(...)
    if (litterUpd.rows.length > 0) litterIds = [litterUpd.rows[0].id]
  }

  // Create weaner group from all selected litters
  if (litterIds.length > 0 && d.weaned_count > 0) {
    // ... existing batch creation, but with source_litter_ids = litterIds
    await db.query(
      `INSERT INTO animal_groups (..., source_litter_ids) VALUES (..., $6)`,
      [..., JSON.stringify(litterIds)])
  }
}
```

### 3. Frontend: Add "Кърмачка" action per litter row in repro table
**File:** `spa/src/pages/SowCard.jsx`, lines 177-202

Add an action column to the Репродуктивна история table. Each active (unweaned) litter row gets a "Кърмачка" link that opens a cross-fostering modal for that specific litter:

```jsx
<thead><tr>
  <th>Прасене</th><th>Дата раждане</th><th>Живородени</th><th>Мъртвородени</th>
  <th>Отбити</th><th>Тегло отбиване</th><th>Дата отбиване</th><th>Партида</th><th>Кърмачка</th>
  <th></th> {/* actions column */}
</tr></thead>
<tbody>
  {reproductionSummary.map((r, i) => (
    <tr key={i}>
      ...existing cells...
      <td>
        {!r.weaningDate && animal.status === 'lactating' && (
          <button className="btn btn-sm btn-outline"
            onClick={() => openCrossFoster(r.litterId, r.bornAlive)}>
            Кърмачка
          </button>
        )}
      </td>
    </tr>
  ))}
</tbody>
```

### 4. Frontend: Cross-fostering modal with piglet count
**File:** `spa/src/pages/SowCard.jsx`

New state:
```jsx
const [showCrossFoster, setShowCrossFoster] = useState(false)
const [cfForm, setCfForm] = useState({ litter_id: '', nurse_sow_id: '', piglet_count: '' })
const [sows, setSows] = useState([])
```

Modal shows:
- **Лitter info** (read-only label: "Прасене #N — X живородени")
- **Брой прасета** — number input: how many piglets to transfer (max = born_alive)
- **Кърмачка** — dropdown of other lactating sows

```jsx
const openCrossFoster = async (litterId, bornAlive) => {
  const res = await api('animals.list', { status: 'lactating', limit: 200 })
  setSows((res.animals || []).filter(a => a.id !== parseInt(id)))
  setCfForm({ litter_id: litterId, nurse_sow_id: '', piglet_count: bornAlive, max: bornAlive })
  setShowCrossFoster(true)
}

const submitCrossFoster = async (e) => {
  e.preventDefault()
  await api('litters.crossFoster', {
    litter_id: parseInt(cfForm.litter_id),
    nurse_sow_id: parseInt(cfForm.nurse_sow_id),
    piglet_count: parseInt(cfForm.piglet_count)
  })
  setShowCrossFoster(false)
  load()
}
```

### 5. Frontend: Multi-litter selection in weaning form
**File:** `spa/src/pages/SowCard.jsx`, weaning event form (currently lines 325-336)

When `event_type === 'weaning'`, show a multi-select list of unweaned litters (both biological + nursed by this sow):

```jsx
{eventForm.event_type === 'weaning' && (
  <>
    <div className="form-group">
      <label>Гнезда за отбиване</label>
      {unweaned.map(l => (
        <label key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <input type="checkbox" checked={selectedLitters.includes(l.id)}
            onChange={() => toggleLitter(l.id)} />
          Прасене #{l.parity_number} — {l.born_alive} живородени
          {l.nurse_sow_id ? ' (кърмачка)' : ''}
        </label>
      ))}
    </div>
    <div className="form-row">
      <div className="form-group">
        <label>Брой отбити (общо)</label>
        <input type="number" ... />
      </div>
      <div className="form-group">
        <label>Тегло на гнездото (кг)</label>
        <input type="number" ... />
      </div>
    </div>
  </>
)}
```

The `unweaned` list comes from `litters.filter(l => !l.weaning_date)` — includes both the sow's own litters and nursed litters (need to also load nursed litters that are active).

Selected litter IDs are passed in `details.litter_ids` to the backend.

### 6. Backend: Include nursed litters in animalsCard for weaning context
**File:** `functions/api/index.mjs`, animalsCard function

The `litters` array returned currently only includes litters where `birth_sow_id = animal.id`. For the weaning multi-select, we also need litters where `nurse_sow_id = animal.id` (litters this sow is nursing).

Already returned as `nursedLitters` — frontend just needs to merge them for the weaning form.

## Files to modify
| File | Changes |
|------|---------|
| `functions/api/index.mjs` | Extend `littersCrossFoster` with `piglet_count` param (partial split); extend weaning handler with `litter_ids` multi-litter support |
| `spa/src/pages/SowCard.jsx` | Add action column in repro table; cross-fostering modal with piglet count; multi-litter checkbox in weaning form; new state for sows/cfForm |

## Verification
- `cd spa && npm run build` — no errors
- `openkbs fn push api && openkbs site push`
- Visit lactating sow → repro table has "Кърмачка" button on unweaned litter row
- Click "Кърмачка" → modal: select nurse sow + enter piglet count (e.g., 7 of 12)
- Submit → original litter shows 5, new litter shows 7 with nurse ear tag
- Visit nurse sow → "Кърмене" tab shows the 7 piglets
- On weaning: litter checkboxes appear, select multiple → weaned together into one batch
- Check that events are recorded on both mother and nurse sow
