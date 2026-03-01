# Add feed purchase registration to inventory

## Context

The Feed page (`/app/feed`) has a "Складова наличност" tab that shows current stock levels, daily consumption, and days of supply. However, there is **no way to register feed purchases** — stock can only decrease (via production) or be corrected (via inventory audit). Users need a way to record when they buy/receive raw materials so that inventory is updated.

Currently the stock flow is one-way:
- Production (`feed.produce`) **deducts** stock from `feed_components.current_stock_kg`
- There is no "add stock" mechanism in the UI

## Goals

- Allow users to register feed component purchases that increase `current_stock_kg`
- Track purchase history (who bought what, when, how much, from whom, at what price)
- Keep it simple — a modal from the "Складова наличност" tab with a "+ Доставка" button

## Functional Requirements

1. **New DB table `feed_purchases`** — records each purchase/delivery:
   - `component_id` (which raw material)
   - `purchase_date`, `quantity_kg`, `price_per_ton` (or total price)
   - `supplier`, `invoice_number`, `notes`
   - `received_by` (personnel)

2. **New API endpoint `feed.purchase`** — registers a purchase:
   - Inserts into `feed_purchases`
   - Updates `feed_components.current_stock_kg` += `quantity_kg`
   - Optionally updates `feed_components.price_per_ton` if the new price differs (with confirmation)
   - Creates an `expense_entries` record (category: 'feed', subcategory: 'purchase')

3. **New API endpoint `feed.purchases.list`** — returns purchase history (last 50)

4. **UI: "+ Доставка" button** in the page header (next to "+ Производство"):
   - Opens a modal with fields: Суровина (dropdown), Количество (кг), Цена/тон (EUR), Доставчик, Фактура №, Бележки
   - On submit, calls `feed.purchase`, reloads inventory

5. **UI: Purchase history** — add a 5th tab "Доставки" or show recent purchases under the "Складова наличност" tab

## User Stories

- As a farm manager, I want to register incoming feed deliveries so that the warehouse stock is updated accurately
- As a farm manager, I want to see purchase history so I can track spending and supplier reliability

## Files to modify

| File | Change |
|------|--------|
| `functions/api/db.mjs` | Add `feed_purchases` table to schema |
| `functions/api/index.mjs` | Add `feed.purchase` and `feed.purchases.list` endpoints |
| `spa/src/pages/Feed.jsx` | Add "+ Доставка" button, purchase modal, purchases tab/section |

## Acceptance Criteria

- User clicks "+ Доставка", fills in component + kg + price, submits
- `current_stock_kg` increases by the entered amount
- Purchase appears in history
- Expense entry is created automatically
- "Складова наличност" tab reflects the updated stock

## Out of Scope

- Purchase orders / planned purchases
- Supplier management (CRUD for suppliers)
- Multi-component delivery (one purchase = one component; user can submit multiple)
- Automatic reorder alerts (already exist via low-stock threshold)

## Verification

1. Build: `cd spa && npx vite build`
2. Deploy: `cd .. && openkbs site push && openkbs fn push api`
3. Open `/app/feed` → click "+ Доставка" → register purchase for any component
4. Check "Складова наличност" — stock should increase
5. Check new "Доставки" tab — purchase should appear in history
