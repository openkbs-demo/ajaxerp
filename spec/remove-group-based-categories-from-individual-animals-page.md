# Remove group-based categories from individual Animals page

## Context

The Animals page (`/app/animals`) shows a category dropdown with 6 options: gilt, sow, boar, suckling_piglet, weaner, finisher. However, `weaner` and `finisher` are **group-based categories** — they are managed as batches in the Groups page (`/app/groups`), not as individual animals with ear tags.

Having them in the Animals dropdown is misleading: a user could register an individual "finisher" animal, but the entire production workflow (weight tracking, dispatch, slaughter, sales) is built around groups. No individual finisher/weaner logic exists anywhere in the system.

## Goals

- Remove `weaner` and `finisher` from individual animal registration categories
- Keep the Groups page unchanged — it already correctly handles weaner/finisher as batch categories
- Clean up backend validation to match

## Functional Requirements

1. **Remove `weaner` and `finisher` from Animals category dropdown** — only `gilt`, `sow`, `boar`, `suckling_piglet` remain as valid individual animal categories
2. **Update backend validation** — `animalsRegister()` should reject `weaner`/`finisher` as individual animal categories
3. **Update regulatory/reporting** — anywhere the system counts individual animals by category (e.g., animal_register document), remove weaner/finisher from individual counts (they're already counted separately via `animal_groups`)

## Files to modify

| File | Change |
|------|--------|
| `spa/src/pages/Animals.jsx:5` | Remove `weaner` and `finisher` from `CAT_BG` |
| `functions/api/index.mjs:556` | Remove from `validCategories` in `animalsRegister()` |
| `functions/api/index.mjs:5000` | Remove from regulatory `categories` array (animal_register initial/final counts) |
| `functions/api/index.mjs:5115` | Remove from regulatory CSV export categories |

## Out of Scope

- Groups page — already correct (only weaner/finisher)
- Sales page — uses sale_type not animal category, unaffected
- Feed recipes — reference target animal type, not individual animal categories
- Dashboard KPIs — count from `animal_groups` table, not `animals` table
- `suckling_piglet` — could also be debatable (they're born in litters) but may still need individual tracking for runts/special cases, so keeping for now
- Existing data — if any individual animals with category weaner/finisher exist in DB, they'll remain but no new ones can be created

## Verification

1. Build: `cd spa && npx vite build`
2. Deploy: `cd .. && openkbs site push && openkbs fn push api`
3. Check `/app/animals` — dropdown should show only: Ремонтна, Свиня майка, Нерез, Бозайник
4. Check `/app/groups` — unchanged, still shows weaner/finisher groups
