# Add missing group actions to GroupCard

## Context
The GroupCard detail page (`/groups/:id`) currently only supports viewing info and recording hall transfers. Several key operational actions already have **backend support** but no UI in GroupCard:

| Action | Backend handler | UI in GroupCard |
|--------|----------------|-----------------|
| View info + genetics | `groups.list`, `litters.list` | Yes |
| Hall transfer | `groups.transfer` | Yes |
| Mortality recording | `eventsRecord(group_death)` → decrements `current_count` | **Missing** |
| Vaccination | `eventsRecord(vaccination, group_id)` → creates `active_withdrawals` | **Missing** |
| Treatment | `eventsRecord(treatment, group_id)` → creates `active_withdrawals` | **Missing** |
| Weighing | `groups.update(current_weight_avg_kg)` | **Missing** |
| Event history for group | `events.list({ group_id })` | **Missing** |
| Active withdrawals | `active_withdrawals` table with group_id | **Missing** |

## Changes — `spa/src/pages/GroupCard.jsx`

### 1. Single "Запиши събитие" button (following SowCard pattern)
Replace the separate "Трансфер" button with a single **"+ Запиши събитие"** button in the page header that opens a modal with an event type dropdown — exactly like `SowCard.jsx` (line 73, 235-342).

**Event type dropdown options** (for groups):
- `group_transfer` → Трансфер
- `weighing` → Претегляне
- `group_death` → Смъртност
- `vaccination` → Ваксинация
- `treatment` → Лечение

**Dynamic fields per event type:**

**Трансфер** (reuse existing transfer logic):
- Към хале (select from halls)
- Средно тегло (кг)
- Брой глави (pre-filled from current_count)
- Дата
- Бележки

**Претегляне:**
- Средно тегло (кг) — required
- Брой глави (pre-filled from current_count)
- Бележки

**Смъртност:**
- Брой (number, required)
- Причина (select: болест / травма / друго)
- Бележки

**Ваксинация:**
- Медикамент (select from `medicine_catalog` via `medicines.list`)
- Доза (мл)
- Бележки

**Лечение:**
- Медикамент (select from `medicine_catalog`)
- Доза (мл)
- Диагноза (text)
- Бележки

**Submit handler:**
- For `group_transfer`: call `api('groups.transfer', ...)` (existing logic)
- For all others: call `api('events.record', { event_type, group_id, details: {...} })`
- On success: close modal, reload data

### 2. Remove existing separate transfer modal
The transfer modal is now inside the unified event modal. Remove `showTransferModal`, `transferForm`, `submitTransfer` and the standalone transfer modal JSX.

### 3. Add "Дневник" (Journal) tab — group events history
New 3rd tab showing all events for this group, fetched via `api('events.list', { group_id })`.

Table columns: Дата, Тип, Детайли, Извършил

Event type labels map (Bulgarian):
- `group_transfer` → Трансфер
- `group_death` → Смъртност
- `vaccination` → Ваксинация
- `treatment` → Лечение
- `weighing` → Претегляне
- `group_sale` → Продажба

### 4. Show active withdrawals on Info tab
Below the genetics section, add a "Карентни срокове" card (only when withdrawals exist):
- Fetch via new `withdrawals.listByGroup` API
- Show: medicine name, start date, end date, days remaining
- Red badge for active, green for expired

### 5. Data loading changes in `load()`
Add to `Promise.all`:
- `api('events.list', { group_id: parseInt(id), limit: 50 })` → for journal tab
- `api('medicines.list')` → for vaccination/treatment dropdown
- `api('withdrawals.listByGroup', { group_id: parseInt(id) })` → for info tab

## Files to modify

| File | Changes |
|------|---------|
| `spa/src/pages/GroupCard.jsx` | Unified event modal (SowCard pattern), journal tab, withdrawal display, load medicines + events + withdrawals |
| `functions/api/index.mjs` | Add `weighing` event handler in group events block; add `withdrawals.listByGroup` route |

### Backend: weighing event handler
In `eventsRecord`, after the `group_death` block (~line 921), add:
```js
if (event_type === 'weighing' && details?.weight_avg_kg) {
  await db.query('UPDATE animal_groups SET current_weight_avg_kg = $1 WHERE id = $2',
    [details.weight_avg_kg, group_id]);
}
```

### Backend: `withdrawals.listByGroup` handler
New route registration + handler:
```js
if (action === 'withdrawals.listByGroup') return await withdrawalsListByGroup(db, body);

async function withdrawalsListByGroup(db, { group_id }) {
  const res = await db.query(
    `SELECT aw.*, mc.name as medicine_name
     FROM active_withdrawals aw
     JOIN medicine_catalog mc ON mc.id = aw.medicine_id
     WHERE aw.group_id = $1 ORDER BY aw.end_date`, [group_id]);
  return ok({ withdrawals: res.rows });
}
```

## Verification
1. `cd spa && npm run build` — no errors
2. `openkbs fn push api` — deploy backend
3. `openkbs site push` — deploy frontend
4. Visit `/groups/3`:
   - Header: single "+ Запиши събитие" button
   - Click → modal with event type dropdown (Трансфер, Претегляне, Смъртност, Ваксинация, Лечение)
   - Record weighing → verify weight updated on Info tab
   - Record mortality → verify count decremented
   - Record vaccination → verify withdrawal appears on Info tab
   - 3 tabs: Информация, Трансфери, Дневник
   - Journal tab shows all recorded events
