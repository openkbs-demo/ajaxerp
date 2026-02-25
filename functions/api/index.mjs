/**
 * AjaxERP (Pig-Tech ERP) API
 * Main Lambda handler — all actions routed via "action" field in POST body.
 */
import crypto from 'crypto';
import { getDB } from './db.mjs';
import { agentChat, agentHistory } from './agent/index.mjs';

// ─── Helpers ────────────────────────────────────────────────────────────────

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization'
};

function ok(data) {
  return { statusCode: 200, headers, body: JSON.stringify(data) };
}
function err(status, message) {
  return { statusCode: status, headers, body: JSON.stringify({ error: message }) };
}

// Password hashing using scrypt
function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (e, key) => e ? reject(e) : resolve(key.toString('hex')));
  });
}
function generateSalt() { return crypto.randomBytes(16).toString('hex'); }
function generateChannel() { return crypto.randomBytes(32).toString('hex'); }

// Pulse token (calls OpenKBS API)
async function getPulseToken(userId) {
  const kbId = process.env.OPENKBS_KB_ID;
  const apiKey = process.env.OPENKBS_API_KEY;
  if (!kbId || !apiKey) return null;
  try {
    const res = await fetch('https://kb.openkbs.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'createPulseToken', kbId, apiKey, userId: String(userId) })
    });
    const data = await res.json();
    return data.error ? null : data;
  } catch { return null; }
}

// Map recipe target_category to sector code for expense attribution
const CATEGORY_TO_SECTOR = {
  sow: 'FAR',        // Lactating/Pregnant → Родилно (or Бременни)
  weaner: 'NUR',     // Starter → Подрастващи
  finisher: 'FIN'    // Finisher → Угояване
};

// ─── Sow Status Machine ────────────────────────────────────────────────────

const VALID_TRANSITIONS = {
  awaiting_breeding: ['inseminated', 'culled'],
  inseminated: ['pregnant_confirmed', 'awaiting_breeding', 'culled'],
  pregnant_confirmed: ['in_farrowing', 'culled'],
  in_farrowing: ['lactating', 'culled'],
  lactating: ['weaned_resting', 'culled'],
  weaned_resting: ['awaiting_breeding', 'culled']
};

function canTransition(from, to) {
  if (to === 'culled') return true;
  return VALID_TRANSITIONS[from]?.includes(to) || false;
}

// Map event types to status transitions
const EVENT_STATUS_MAP = {
  insemination: 'inseminated',
  pregnancy_check_positive: 'pregnant_confirmed',
  pregnancy_check_negative: 'awaiting_breeding',
  transfer_to_farrowing: 'in_farrowing',
  farrowing: 'lactating',
  weaning: 'weaned_resting',
  rest_complete: 'awaiting_breeding',
  culling: 'culled'
};

// ─── Main Handler ───────────────────────────────────────────────────────────

export async function handler(event) {
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { action } = body;

    // Status check (no DB needed)
    if (action === 'status') {
      return ok({ postgres: !!process.env.DATABASE_URL, storage: !!process.env.STORAGE_BUCKET, kbId: process.env.OPENKBS_KB_ID });
    }

    const db = await getDB();

    // ─── AUTH ──────────────────────────────────────────────────────────
    if (action === 'auth.register') return await authRegister(db, body);
    if (action === 'auth.login') return await authLogin(db, body);

    // ─── SECTORS ──────────────────────────────────────────────────────
    if (action === 'sectors.list') return await sectorsList(db);

    // ─── HALLS ────────────────────────────────────────────────────────
    if (action === 'halls.list') return await hallsList(db, body);
    if (action === 'halls.create') return await hallsCreate(db, body);
    if (action === 'halls.update') return await hallsUpdate(db, body);

    // ─── ANIMALS ──────────────────────────────────────────────────────
    if (action === 'animals.register') return await animalsRegister(db, body);
    if (action === 'animals.list') return await animalsList(db, body);
    if (action === 'animals.get') return await animalsGet(db, body);
    if (action === 'animals.card') return await animalsCard(db, body);
    if (action === 'animals.update') return await animalsUpdate(db, body);

    // ─── EVENTS ───────────────────────────────────────────────────────
    if (action === 'events.record') return await eventsRecord(db, body);
    if (action === 'events.list') return await eventsList(db, body);

    // ─── GROUPS ───────────────────────────────────────────────────────
    if (action === 'groups.create') return await groupsCreate(db, body);
    if (action === 'groups.list') return await groupsList(db, body);
    if (action === 'groups.update') return await groupsUpdate(db, body);

    // ─── LITTERS ──────────────────────────────────────────────────────
    if (action === 'litters.crossFoster') return await littersCrossFoster(db, body);

    // ─── FEED ─────────────────────────────────────────────────────────
    if (action === 'feed.components.list') return await feedComponentsList(db);
    if (action === 'feed.components.upsert') return await feedComponentsUpsert(db, body);
    if (action === 'feed.recipes.list') return await feedRecipesList(db);
    if (action === 'feed.recipes.get') return await feedRecipesGet(db, body);
    if (action === 'feed.recipes.upsert') return await feedRecipesUpsert(db, body);
    if (action === 'feed.updatePrice') return await feedUpdatePrice(db, body);
    if (action === 'feed.produce') return await feedProduce(db, body);
    if (action === 'feed.inventory') return await feedInventory(db);
    if (action === 'feed.batches.list') return await feedBatchesList(db, body);

    // ─── KPI ──────────────────────────────────────────────────────────
    if (action === 'kpi.dashboard') return await kpiDashboard(db);
    if (action === 'kpi.recalculate') return await kpiRecalculate(db);

    // ─── ALERTS ───────────────────────────────────────────────────────
    if (action === 'alerts.list') return await alertsList(db, body);
    if (action === 'alerts.acknowledge') return await alertsAcknowledge(db, body);
    if (action === 'alerts.check') return await alertsCheck(db);

    // ─── SEED ─────────────────────────────────────────────────────────
    if (action === 'seed') return await seedData(db);
    if (action === 'reset') {
      const PROTECTED_TABLES = ['app_settings'];
      const tables = await db.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
      let dropped = 0;
      for (const t of tables.rows) {
        if (PROTECTED_TABLES.includes(t.tablename)) continue;
        await db.query(`DROP TABLE IF EXISTS "${t.tablename}" CASCADE`);
        dropped++;
      }
      const { resetDB } = await import('./db.mjs');
      resetDB();
      return ok({ message: `Dropped ${dropped} tables (${PROTECTED_TABLES.join(', ')} preserved). Call seed to recreate.` });
    }

    // ─── DASHBOARD BUNDLE ─────────────────────────────────────────────
    if (action === 'dashboard') return await dashboardBundle(db);

    // ─── PERSONNEL ────────────────────────────────────────────────────
    if (action === 'personnel.list') return await personnelList(db, body);
    if (action === 'personnel.create') return await personnelCreate(db, body);
    if (action === 'personnel.update') return await personnelUpdate(db, body);
    if (action === 'personnel.resetPassword') return await personnelResetPassword(db, body);

    // ═════════════════════════════════════════════════════════════════
    // PHASE 2: FINANCE & REPORTS
    // ═════════════════════════════════════════════════════════════════

    // ─── SALES ──────────────────────────────────────────────────────
    if (action === 'sales.record') return await salesRecord(db, body);
    if (action === 'sales.list') return await salesList(db, body);
    if (action === 'sales.get') return await salesGet(db, body);
    if (action === 'sales.summary') return await salesSummary(db, body);
    if (action === 'sales.delete') return await salesDelete(db, body);

    // ─── EXPENSES ───────────────────────────────────────────────────
    if (action === 'expenses.record') return await expensesRecord(db, body);
    if (action === 'expenses.list') return await expensesList(db, body);
    if (action === 'expenses.summary') return await expensesSummary(db, body);
    if (action === 'expenses.delete') return await expensesDelete(db, body);

    // ─── SALARY ─────────────────────────────────────────────────────
    if (action === 'salary.templates.list') return await salaryTemplatesList(db);
    if (action === 'salary.templates.upsert') return await salaryTemplatesUpsert(db, body);
    if (action === 'salary.generate') return await salaryGenerate(db, body);
    if (action === 'salary.summary') return await salarySummary(db, body);

    // ─── MEDICINE ───────────────────────────────────────────────────
    if (action === 'medicine.list') return await medicineList(db, body);
    if (action === 'medicine.upsert') return await medicineUpsert(db, body);
    if (action === 'medicine.use') return await medicineUse(db, body);
    if (action === 'medicine.restock') return await medicineRestock(db, body);

    // ─── INVENTORY COUNTS ───────────────────────────────────────────
    if (action === 'inventory.count') return await inventoryCount(db, body);
    if (action === 'inventory.counts.list') return await inventoryCountsList(db, body);

    // ─── REPORTS ────────────────────────────────────────────────────
    if (action === 'reports.pnl') return await reportsPnl(db, body);
    if (action === 'reports.pnl.bySector') return await reportsPnlBySector(db, body);
    if (action === 'reports.pnl.byBatch') return await reportsPnlByBatch(db, body);
    if (action === 'reports.pnl.snapshot') return await reportsPnlSnapshot(db, body);
    if (action === 'reports.npd') return await reportsNpd(db, body);
    if (action === 'reports.weightVariation') return await reportsWeightVariation(db, body);
    if (action === 'reports.feedEfficiency') return await reportsFeedEfficiency(db, body);
    if (action === 'reports.hallComparison') return await reportsHallComparison(db, body);
    if (action === 'reports.inventoryVariance') return await reportsInventoryVariance(db, body);
    if (action === 'reports.financialKpis') return await reportsFinancialKpis(db, body);

    // ─── EXCEL EXPORT ───────────────────────────────────────────────
    if (action === 'export.excel') return await exportExcel(db, body);

    // ═════════════════════════════════════════════════════════════════
    // PHASE 3: LOGISTICS
    // ═════════════════════════════════════════════════════════════════

    // ─── VEHICLES ─────────────────────────────────────────────────
    if (action === 'vehicles.list') return await vehiclesList(db, body);
    if (action === 'vehicles.upsert') return await vehiclesUpsert(db, body);
    if (action === 'vehicles.updateStatus') return await vehiclesUpdateStatus(db, body);
    if (action === 'vehicles.stats') return await vehiclesStats(db, body);

    // ─── SILOS ────────────────────────────────────────────────────
    if (action === 'silos.list') return await silosList(db, body);
    if (action === 'silos.upsert') return await silosUpsert(db, body);
    if (action === 'silos.fill') return await silosFill(db, body);
    if (action === 'silos.checkLevels') return await silosCheckLevels(db);

    // ─── DELIVERY ROUTES ──────────────────────────────────────────
    if (action === 'delivery.create') return await deliveryCreate(db, body);
    if (action === 'delivery.list') return await deliveryList(db, body);
    if (action === 'delivery.get') return await deliveryGet(db, body);
    if (action === 'delivery.complete') return await deliveryComplete(db, body);
    if (action === 'delivery.cancel') return await deliveryCancel(db, body);

    // ─── DISPATCH ORDERS ──────────────────────────────────────────
    if (action === 'dispatch.create') return await dispatchCreate(db, body);
    if (action === 'dispatch.list') return await dispatchList(db, body);
    if (action === 'dispatch.update') return await dispatchUpdate(db, body);
    if (action === 'dispatch.autoCheck') return await dispatchAutoCheck(db);

    // ─── DISINFECTION ─────────────────────────────────────────────
    if (action === 'disinfection.record') return await disinfectionRecord(db, body);
    if (action === 'disinfection.list') return await disinfectionList(db, body);

    // ─── LOGISTICS REPORTS ────────────────────────────────────────
    if (action === 'reports.truckEfficiency') return await reportsTruckEfficiency(db, body);
    if (action === 'reports.dispatchShrinkage') return await reportsDispatchShrinkage(db, body);

    // ═════════════════════════════════════════════════════════════════
    // PHASE 4: BIOSECURITY
    // ═════════════════════════════════════════════════════════════════

    // ─── ACCESS CONTROL ─────────────────────────────────────────────
    if (action === 'access.log') return await accessLog(db, body);
    if (action === 'access.history') return await accessHistory(db, body);
    if (action === 'access.check48h') return await accessCheck48h(db, body);
    if (action === 'access.currentLocations') return await accessCurrentLocations(db);

    // ─── BIOSECURITY VIOLATIONS ─────────────────────────────────────
    if (action === 'biosecurity.violations') return await biosecurityViolations(db, body);
    if (action === 'biosecurity.resolve') return await biosecurityResolve(db, body);
    if (action === 'biosecurity.heatmap') return await biosecurityHeatmap(db, body);
    if (action === 'biosecurity.summary') return await biosecuritySummary(db, body);

    // ─── MEDICINE WITHDRAWALS ───────────────────────────────────────
    if (action === 'medicine.setWithdrawal') return await medicineSetWithdrawal(db, body);
    if (action === 'medicine.withdrawals') return await medicineWithdrawals(db);
    if (action === 'withdrawal.active') return await withdrawalActive(db, body);
    if (action === 'withdrawal.clear') return await withdrawalClear(db, body);

    // ─── HALL HYGIENE ───────────────────────────────────────────────
    if (action === 'hall.startHygiene') return await hallStartHygiene(db, body);
    if (action === 'hall.confirmHygiene') return await hallConfirmHygiene(db, body);
    if (action === 'hall.hygieneStatus') return await hallHygieneStatus(db, body);
    if (action === 'hall.cancelHygiene') return await hallCancelHygiene(db, body);

    // ═════════════════════════════════════════════════════════════════
    // PHASE 5: KPI BONUSES
    // ═════════════════════════════════════════════════════════════════
    if (action === 'bonus.rules.list') return await bonusRulesList(db);
    if (action === 'bonus.rules.upsert') return await bonusRulesUpsert(db, body);
    if (action === 'bonus.calculate') return await bonusCalculate(db, body);
    if (action === 'bonus.results') return await bonusResults(db, body);
    if (action === 'bonus.approve') return await bonusApprove(db, body);
    if (action === 'bonus.history') return await bonusHistory(db, body);
    if (action === 'bonus.summary') return await bonusSummary(db, body);

    // ═════════════════════════════════════════════════════════════════
    // PHASE 6: TRACEABILITY
    // ═════════════════════════════════════════════════════════════════
    if (action === 'traceability.generate') return await traceabilityGenerate(db, body);
    if (action === 'traceability.get') return await traceabilityGet(db, body);
    if (action === 'traceability.list') return await traceabilityList(db, body);
    if (action === 'regulatory.generate') return await regulatoryGenerate(db, body);
    if (action === 'regulatory.list') return await regulatoryList(db, body);
    if (action === 'regulatory.get') return await regulatoryGet(db, body);
    if (action === 'regulatory.finalize') return await regulatoryFinalize(db, body);
    if (action === 'regulatory.submit') return await regulatorySubmit(db, body);
    if (action === 'regulatory.export') return await regulatoryExport(db, body);
    if (action === 'regulatory.stats') return await regulatoryStats(db);

    // ═════════════════════════════════════════════════════════════════
    // ADDITIONAL: Water monitoring, DanBred Index, Employee Profitability, Mortality Value, Daily I/O
    // ═════════════════════════════════════════════════════════════════
    if (action === 'water.record') return await waterRecord(db, body);
    if (action === 'water.history') return await waterHistory(db, body);
    if (action === 'water.checkAlerts') return await waterCheckAlerts(db);
    if (action === 'reports.danbredIndex') return await reportsDanbredIndex(db, body);
    if (action === 'reports.employeeProfitability') return await reportsEmployeeProfitability(db, body);
    if (action === 'reports.mortalityValue') return await reportsMortalityValue(db, body);
    if (action === 'reports.dailyIO') return await reportsDailyIO(db, body);

    // ─── App Settings ──────────────────────────────────────────────────────
    if (action === 'settings.get') return ok(await settingsGet(db, body));
    if (action === 'settings.set') return ok(await settingsSet(db, body));
    if (action === 'settings.getAll') return ok(await settingsGetAll(db));

    // ─── AI Agent ─────────────────────────────────────────────────────────
    if (action === 'agent.chat') return ok(await agentChat(db, body));
    if (action === 'agent.history') return ok(await agentHistory(db, body));

    return err(400, `Unknown action: ${action}`);
  } catch (error) {
    console.error('API Error:', error);
    return err(500, error.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════

const ALLOWED_EMAIL_DOMAINS = ['@ajaxgroup.bg', '@openkbs.com', '@ajaxerp.com'];
const WHITELISTED_EMAILS = ['khristov3@gmail.com'];

async function authRegister(db, { name, email, password, role, phone, hire_date }) {
  if (!name || !email || !password) return err(400, 'Име, email и парола са задължителни');
  const emailLower = email.toLowerCase().trim();
  const domainAllowed = ALLOWED_EMAIL_DOMAINS.some(d => emailLower.endsWith(d));
  if (!domainAllowed && !WHITELISTED_EMAILS.includes(emailLower)) {
    return err(400, 'Този email не е разрешен за регистрация');
  }
  const validRoles = ['admin', 'production_manager', 'zooeng', 'farm_worker', 'driver', 'cleaner'];
  const userRole = validRoles.includes(role) ? role : 'farm_worker';

  const existing = await db.query('SELECT id FROM personnel WHERE email = $1', [emailLower]);
  if (existing.rows.length > 0) return err(400, 'Този email вече е регистриран');

  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);
  const privateChannel = generateChannel();

  const result = await db.query(
    `INSERT INTO personnel (name, email, password_hash, salt, role, phone, hire_date, private_channel)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, name, email, role, phone, hire_date, private_channel, created_at`,
    [name, emailLower, passwordHash, salt, userRole, phone || null, hire_date || null, privateChannel]
  );
  const user = result.rows[0];
  const pulseData = await getPulseToken(user.id);

  return ok({
    user: {
      id: user.id, name: user.name, email: user.email, role: user.role,
      phone: user.phone, hireDate: user.hire_date,
      privateChannel: user.private_channel,
      pulseToken: pulseData?.token || null,
      pulseEndpoint: pulseData?.endpoint || null
    }
  });
}

async function authLogin(db, { email, password }) {
  if (!email || !password) return err(400, 'Email и парола са задължителни');
  const emailLower = email.toLowerCase().trim();

  const result = await db.query(
    'SELECT id, name, email, password_hash, salt, role, phone, hire_date, private_channel FROM personnel WHERE email = $1 AND is_active = true',
    [emailLower]
  );
  if (result.rows.length === 0) return err(401, 'Невалиден email или парола');

  const user = result.rows[0];
  const hash = await hashPassword(password, user.salt);
  if (hash !== user.password_hash) return err(401, 'Невалиден email или парола');

  let privateChannel = user.private_channel;
  if (!privateChannel) {
    privateChannel = generateChannel();
    await db.query('UPDATE personnel SET private_channel = $1 WHERE id = $2', [privateChannel, user.id]);
  }

  const pulseData = await getPulseToken(user.id);

  // Get assigned halls
  const hallsRes = await db.query(
    `SELECT h.id, h.name, s.name as sector_name FROM personnel_halls ph
     JOIN halls h ON h.id = ph.hall_id
     JOIN sectors s ON s.id = h.sector_id
     WHERE ph.personnel_id = $1`,
    [user.id]
  );

  return ok({
    user: {
      id: user.id, name: user.name, email: user.email, role: user.role,
      phone: user.phone, hireDate: user.hire_date,
      privateChannel, halls: hallsRes.rows,
      pulseToken: pulseData?.token || null,
      pulseEndpoint: pulseData?.endpoint || null
    }
  });
}

async function personnelList(db, { role }) {
  let q = 'SELECT id, name, email, role, phone, hire_date, is_active, created_at FROM personnel';
  const params = [];
  if (role) { q += ' WHERE role = $1'; params.push(role); }
  q += ' ORDER BY name';
  const result = await db.query(q, params);
  return ok({ personnel: result.rows });
}

async function personnelCreate(db, { name, email, password, role, phone, hire_date }) {
  if (!name || !email || !password) return err(400, 'Име, email и парола са задължителни');
  const validRoles = ['admin', 'production_manager', 'zooeng', 'farm_worker', 'driver', 'cleaner'];
  const userRole = validRoles.includes(role) ? role : 'farm_worker';
  const emailLower = email.toLowerCase().trim();
  const existing = await db.query('SELECT id FROM personnel WHERE email = $1', [emailLower]);
  if (existing.rows.length > 0) return err(400, 'Този email вече е регистриран');
  const salt = generateSalt();
  const hash = await hashPassword(password, salt);
  const result = await db.query(
    `INSERT INTO personnel (name, email, password_hash, salt, role, phone, hire_date, private_channel)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, name, email, role, phone, hire_date, is_active`,
    [name, emailLower, hash, salt, userRole, phone || null, hire_date || null, generateChannel()]
  );
  return ok({ user: result.rows[0] });
}

async function personnelUpdate(db, { id, name, email, role, phone, hire_date, is_active }) {
  if (!id) return err(400, 'ID е задължително');
  const existing = await db.query('SELECT * FROM personnel WHERE id = $1', [id]);
  if (existing.rows.length === 0) return err(404, 'Потребителят не е намерен');
  const validRoles = ['admin', 'production_manager', 'zooeng', 'farm_worker', 'driver', 'cleaner'];
  const fields = []; const params = []; let idx = 1;
  if (name !== undefined) { fields.push(`name = $${idx++}`); params.push(name); }
  if (email !== undefined) { fields.push(`email = $${idx++}`); params.push(email.toLowerCase().trim()); }
  if (role !== undefined && validRoles.includes(role)) { fields.push(`role = $${idx++}`); params.push(role); }
  if (phone !== undefined) { fields.push(`phone = $${idx++}`); params.push(phone); }
  if (hire_date !== undefined) { fields.push(`hire_date = $${idx++}`); params.push(hire_date); }
  if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); params.push(is_active); }
  if (fields.length === 0) return err(400, 'Няма полета за обновяване');
  params.push(id);
  const result = await db.query(
    `UPDATE personnel SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, name, email, role, phone, hire_date, is_active`,
    params
  );
  return ok({ user: result.rows[0] });
}

async function personnelResetPassword(db, { id, new_password }) {
  if (!id || !new_password) return err(400, 'ID и нова парола са задължителни');
  const existing = await db.query('SELECT id FROM personnel WHERE id = $1', [id]);
  if (existing.rows.length === 0) return err(404, 'Потребителят не е намерен');
  const salt = generateSalt();
  const hash = await hashPassword(new_password, salt);
  await db.query('UPDATE personnel SET password_hash = $1, salt = $2 WHERE id = $3', [hash, salt, id]);
  return ok({ message: 'Паролата е сменена успешно' });
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTORS
// ═══════════════════════════════════════════════════════════════════════════

async function sectorsList(db) {
  const result = await db.query('SELECT id, name, code FROM sectors ORDER BY id');
  return ok({ sectors: result.rows });
}

// ═══════════════════════════════════════════════════════════════════════════
// HALLS
// ═══════════════════════════════════════════════════════════════════════════

async function hallsList(db, { sector_id }) {
  let q = `SELECT h.*, s.name as sector_name, s.code as sector_code
           FROM halls h JOIN sectors s ON s.id = h.sector_id`;
  const params = [];
  if (sector_id) { q += ' WHERE h.sector_id = $1'; params.push(sector_id); }
  q += ' ORDER BY h.name';
  const result = await db.query(q, params);
  return ok({ halls: result.rows });
}

async function hallsCreate(db, { name, sector_id, biosecurity_zone, capacity, target_temp_min, target_temp_max }) {
  if (!name || !sector_id) return err(400, 'Име и сектор са задължителни');
  const zone = ['white', 'grey', 'black'].includes(biosecurity_zone) ? biosecurity_zone : 'grey';
  const result = await db.query(
    `INSERT INTO halls (name, sector_id, biosecurity_zone, capacity, target_temp_min, target_temp_max)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [name, sector_id, zone, capacity || 0, target_temp_min || null, target_temp_max || null]
  );
  return ok({ hall: result.rows[0] });
}

async function hallsUpdate(db, { id, name, biosecurity_zone, capacity, target_temp_min, target_temp_max, is_active }) {
  if (!id) return err(400, 'ID е задължително');
  const fields = [];
  const params = [];
  let idx = 1;
  if (name !== undefined) { fields.push(`name = $${idx++}`); params.push(name); }
  if (biosecurity_zone !== undefined) { fields.push(`biosecurity_zone = $${idx++}`); params.push(biosecurity_zone); }
  if (capacity !== undefined) { fields.push(`capacity = $${idx++}`); params.push(capacity); }
  if (target_temp_min !== undefined) { fields.push(`target_temp_min = $${idx++}`); params.push(target_temp_min); }
  if (target_temp_max !== undefined) { fields.push(`target_temp_max = $${idx++}`); params.push(target_temp_max); }
  if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); params.push(is_active); }
  if (fields.length === 0) return err(400, 'Няма полета за обновяване');
  params.push(id);
  const result = await db.query(`UPDATE halls SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
  if (result.rows.length === 0) return err(404, 'Халето не е намерено');
  return ok({ hall: result.rows[0] });
}

// ═══════════════════════════════════════════════════════════════════════════
// ANIMALS
// ═══════════════════════════════════════════════════════════════════════════

async function animalsRegister(db, { ear_tag, category, breed, date_of_birth, status, hall_id, notes }) {
  const validCategories = ['gilt', 'sow', 'boar', 'suckling_piglet', 'weaner', 'finisher'];
  if (!validCategories.includes(category)) return err(400, `Невалидна категория. Валидни: ${validCategories.join(', ')}`);

  // Default status by category
  let defaultStatus = 'active';
  if (category === 'gilt' || category === 'sow') defaultStatus = 'awaiting_breeding';
  if (category === 'boar') defaultStatus = 'active';
  const animalStatus = status || defaultStatus;

  const result = await db.query(
    `INSERT INTO animals (ear_tag, category, breed, date_of_birth, status, current_hall_id, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [ear_tag || null, category, breed || null, date_of_birth || null, animalStatus, hall_id || null, notes || null]
  );

  // Update hall occupancy
  if (hall_id) {
    await db.query('UPDATE halls SET current_occupancy = current_occupancy + 1 WHERE id = $1', [hall_id]);
  }

  return ok({ animal: result.rows[0] });
}

async function animalsList(db, { category, status, hall_id, limit, offset }) {
  let q = `SELECT a.*, h.name as hall_name, s.name as sector_name
           FROM animals a
           LEFT JOIN halls h ON h.id = a.current_hall_id
           LEFT JOIN sectors s ON s.id = h.sector_id
           WHERE 1=1`;
  const params = [];
  let idx = 1;
  if (category) { q += ` AND a.category = $${idx++}`; params.push(category); }
  if (status) { q += ` AND a.status = $${idx++}`; params.push(status); }
  if (hall_id) { q += ` AND a.current_hall_id = $${idx++}`; params.push(hall_id); }
  q += ' ORDER BY a.ear_tag, a.id';
  q += ` LIMIT $${idx++}`; params.push(limit || 100);
  q += ` OFFSET $${idx++}`; params.push(offset || 0);
  const result = await db.query(q, params);

  // Count total
  let countQ = 'SELECT COUNT(*) FROM animals WHERE 1=1';
  const countParams = [];
  let cIdx = 1;
  if (category) { countQ += ` AND category = $${cIdx++}`; countParams.push(category); }
  if (status) { countQ += ` AND status = $${cIdx++}`; countParams.push(status); }
  if (hall_id) { countQ += ` AND current_hall_id = $${cIdx++}`; countParams.push(hall_id); }
  const countRes = await db.query(countQ, countParams);

  return ok({ animals: result.rows, total: parseInt(countRes.rows[0].count) });
}

async function animalsGet(db, { id, ear_tag }) {
  let q = `SELECT a.*, h.name as hall_name, s.name as sector_name
           FROM animals a
           LEFT JOIN halls h ON h.id = a.current_hall_id
           LEFT JOIN sectors s ON s.id = h.sector_id`;
  const params = [];
  if (id) { q += ' WHERE a.id = $1'; params.push(id); }
  else if (ear_tag) { q += ' WHERE a.ear_tag = $1'; params.push(ear_tag); }
  else return err(400, 'ID или ушна марка е задължително');

  const result = await db.query(q, params);
  if (result.rows.length === 0) return err(404, 'Животното не е намерено');
  return ok({ animal: result.rows[0] });
}

async function animalsCard(db, { id, ear_tag }) {
  // Get animal
  const animalRes = await animalsGet(db, { id, ear_tag });
  const animalData = JSON.parse(animalRes.body);
  if (animalRes.statusCode !== 200) return animalRes;
  const animal = animalData.animal;

  // Get all events for this animal
  const eventsRes = await db.query(
    `SELECT e.*, p.name as performed_by_name FROM events e
     LEFT JOIN personnel p ON p.id = e.performed_by
     WHERE e.animal_id = $1 ORDER BY e.event_date DESC`,
    [animal.id]
  );

  // Get litters (as birth sow)
  const littersRes = await db.query(
    `SELECT l.*, ns.ear_tag as nurse_ear_tag FROM litters l
     LEFT JOIN animals ns ON ns.id = l.nurse_sow_id
     WHERE l.birth_sow_id = $1 ORDER BY l.parity_number DESC`,
    [animal.id]
  );

  // Get litters nursed (as nurse sow)
  const nursedRes = await db.query(
    `SELECT l.*, bs.ear_tag as birth_sow_ear_tag FROM litters l
     LEFT JOIN animals bs ON bs.id = l.birth_sow_id
     WHERE l.nurse_sow_id = $1 ORDER BY l.birth_date DESC`,
    [animal.id]
  );

  // Get health events (vaccinations, diseases, treatments)
  const healthEvents = eventsRes.rows.filter(e =>
    ['vaccination', 'disease', 'treatment'].includes(e.event_type)
  );

  // Calculate reproduction summary
  const reproSummary = littersRes.rows.map(l => ({
    parity: l.parity_number,
    birthDate: l.birth_date,
    bornAlive: l.born_alive,
    stillborn: l.stillborn,
    mummified: l.mummified,
    weanedCount: l.weaned_count,
    weaningWeight: l.weaning_weight_kg,
    weaningDate: l.weaning_date,
    nurseEarTag: l.nurse_ear_tag
  }));

  // Check culling criteria
  const cullingProposal = checkCullingCriteria(animal, littersRes.rows, eventsRes.rows);

  return ok({
    animal,
    events: eventsRes.rows,
    litters: littersRes.rows,
    nursedLitters: nursedRes.rows,
    healthCard: healthEvents,
    reproductionSummary: reproSummary,
    cullingProposal
  });
}

async function animalsUpdate(db, { id, notes, current_hall_id }) {
  if (!id) return err(400, 'ID е задължително');
  const fields = [];
  const params = [];
  let idx = 1;
  if (notes !== undefined) { fields.push(`notes = $${idx++}`); params.push(notes); }
  if (current_hall_id !== undefined) { fields.push(`current_hall_id = $${idx++}`); params.push(current_hall_id); }
  fields.push(`updated_at = NOW()`);
  if (fields.length <= 1) return err(400, 'Няма полета за обновяване');
  params.push(id);
  const result = await db.query(`UPDATE animals SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
  if (result.rows.length === 0) return err(404, 'Животното не е намерено');
  return ok({ animal: result.rows[0] });
}

// Culling criteria check
function checkCullingCriteria(animal, litters, events) {
  const reasons = [];

  // Parity > 7
  if (animal.parity_number > 7) {
    reasons.push('Номер на прасене > 7 (възраст)');
  }

  // Last litter weaned < 10
  if (litters.length > 0 && litters[0].weaned_count !== null && litters[0].weaned_count < 10) {
    reasons.push(`Последно гнездо: само ${litters[0].weaned_count} отбити (< 10)`);
  }

  // 3 consecutive failed inseminations
  const inseminationEvents = events
    .filter(e => e.event_type === 'insemination' || e.event_type === 'pregnancy_check_negative')
    .sort((a, b) => new Date(b.event_date) - new Date(a.event_date));

  let consecutiveFails = 0;
  for (const e of inseminationEvents) {
    if (e.event_type === 'pregnancy_check_negative') {
      consecutiveFails++;
    } else {
      break;
    }
  }
  if (consecutiveFails >= 3) {
    reasons.push(`${consecutiveFails} поредни неуспешни заплождания`);
  }

  return reasons.length > 0 ? { shouldCull: true, reasons } : { shouldCull: false, reasons: [] };
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════════════════

async function eventsRecord(db, { event_type, animal_id, group_id, hall_id, performed_by, event_date, details }) {
  if (!event_type) return err(400, 'Тип на събитието е задължителен');

  // If animal event, validate status transition
  if (animal_id) {
    const animalRes = await db.query('SELECT * FROM animals WHERE id = $1', [animal_id]);
    if (animalRes.rows.length === 0) return err(404, 'Животното не е намерено');
    const animal = animalRes.rows[0];

    // Determine new status from event type
    const newStatus = EVENT_STATUS_MAP[event_type];
    if (newStatus) {
      if (!canTransition(animal.status, newStatus)) {
        return err(400, `Невалиден преход: "${animal.status}" → "${newStatus}". Текущ статус: ${animal.status}`);
      }
    }

    // Record the event
    const eventRes = await db.query(
      `INSERT INTO events (event_type, animal_id, group_id, hall_id, performed_by, event_date, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [event_type, animal_id, group_id || null, hall_id || null, performed_by || null,
       event_date || new Date().toISOString(), details ? JSON.stringify(details) : '{}']
    );
    const evt = eventRes.rows[0];

    // Update animal status
    if (newStatus) {
      const updateFields = [`status = '${newStatus}'`, `updated_at = NOW()`];

      // Special logic per event type
      if (event_type === 'farrowing') {
        // Increment parity, create litter
        updateFields.push(`parity_number = parity_number + 1`);
        const d = details || {};
        await db.query(
          `INSERT INTO litters (birth_sow_id, farrowing_event_id, parity_number, born_alive, stillborn, mummified, birth_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [animal_id, evt.id, animal.parity_number + 1, d.born_alive || 0, d.stillborn || 0,
           d.mummified || 0, event_date || new Date().toISOString()]
        );

        // Check mortality alert (born_alive threshold)
        if ((d.born_alive || 0) < 16) {
          await createAlert(db, 'critical', 'reproduction',
            `Ниска раждаемост: ${d.born_alive} живородени (< 16) за свиня ${animal.ear_tag}`,
            'animal', animal_id, 'live_born', d.born_alive, 16);
        }
      }

      if (event_type === 'weaning') {
        const d = details || {};
        // Update the latest litter for this sow
        await db.query(
          `UPDATE litters SET weaned_count = $1, weaning_weight_kg = $2, weaning_date = $3
           WHERE id = (SELECT id FROM litters WHERE birth_sow_id = $4 AND weaning_date IS NULL ORDER BY birth_date DESC LIMIT 1)`,
          [d.weaned_count || 0, d.weaning_weight_kg || null, event_date || new Date().toISOString(), animal_id]
        );

        // Check weaning weight alert
        const avgWeight = d.weaned_count > 0 ? (d.weaning_weight_kg || 0) / d.weaned_count : 0;
        if (avgWeight > 0 && avgWeight < 5.2) {
          await createAlert(db, 'warning', 'reproduction',
            `Ниско тегло отбиване: ${avgWeight.toFixed(1)} кг (< 5.2 кг) за свиня ${animal.ear_tag}`,
            'animal', animal_id, 'weaning_weight', avgWeight, 5.2);
        }

        // Check culling criteria after weaning
        const littersRes = await db.query(
          'SELECT * FROM litters WHERE birth_sow_id = $1 ORDER BY parity_number DESC', [animal_id]);
        const eventsRes = await db.query(
          'SELECT * FROM events WHERE animal_id = $1 ORDER BY event_date DESC', [animal_id]);
        const updatedAnimal = { ...animal, parity_number: animal.parity_number };
        const culling = checkCullingCriteria(updatedAnimal, littersRes.rows, eventsRes.rows);
        if (culling.shouldCull) {
          await createAlert(db, 'warning', 'culling',
            `Предложение за брак: ${animal.ear_tag}. Причини: ${culling.reasons.join('; ')}`,
            'animal', animal_id, 'culling_proposal', 0, 0);
        }
      }

      if (event_type === 'culling') {
        const d = details || {};
        const cullDate = event_date || new Date().toISOString();
        updateFields.push(`cull_date = '${cullDate.replace(/'/g, "''")}'`);
        const validReasons = ['low_productivity', 'reproductive_failure', 'age', 'health', 'other'];
        if (d.reason && validReasons.includes(d.reason)) updateFields.push(`cull_reason = '${d.reason}'`);
        const validDest = ['slaughter', 'death', 'sold'];
        if (d.destination && validDest.includes(d.destination)) updateFields.push(`cull_destination = '${d.destination}'`);
        if (d.weight_kg && !isNaN(d.weight_kg)) updateFields.push(`cull_weight_kg = ${parseFloat(d.weight_kg)}`);
      }

      // Handle hall transfer
      if (event_type === 'transfer_to_farrowing' && hall_id) {
        if (animal.current_hall_id) {
          await db.query('UPDATE halls SET current_occupancy = GREATEST(current_occupancy - 1, 0) WHERE id = $1', [animal.current_hall_id]);
        }
        await db.query('UPDATE halls SET current_occupancy = current_occupancy + 1 WHERE id = $1', [hall_id]);
        updateFields.push(`current_hall_id = ${hall_id}`);
      }

      await db.query(`UPDATE animals SET ${updateFields.join(', ')} WHERE id = $1`, [animal_id]);
    }

    // Phase 4: Auto-create withdrawal for vaccination/treatment with medicine
    if (['vaccination', 'treatment'].includes(event_type) && details?.medicine_id) {
      try {
        const wd = await db.query('SELECT withdrawal_days FROM medicine_withdrawals WHERE medicine_id = $1 AND withdrawal_days > 0', [details.medicine_id]);
        if (wd.rows.length > 0) {
          const days = wd.rows[0].withdrawal_days;
          const startDate = event_date || new Date().toISOString().substring(0, 10);
          await db.query(
            `INSERT INTO active_withdrawals (animal_id, group_id, medicine_id, event_id, start_date, end_date, status)
             VALUES ($1, $2, $3, $4, $5, $5::date + $6 * INTERVAL '1 day', 'active')`,
            [animal_id, group_id || null, details.medicine_id, evt.id, startDate, days]
          );
        }
      } catch {}
    }

    // For non-status-changing events (vaccination, disease, treatment, death, transfer, etc.)
    // Event already inserted above (line ~503), just handle side effects
    if (!newStatus) {
      // Handle death event
      if (event_type === 'death') {
        await db.query(`UPDATE animals SET status = 'culled', cull_date = $1, cull_reason = 'death', updated_at = NOW() WHERE id = $2`,
          [event_date || new Date().toISOString(), animal_id]);
        if (animal.current_hall_id) {
          await db.query('UPDATE halls SET current_occupancy = GREATEST(current_occupancy - 1, 0) WHERE id = $1', [animal.current_hall_id]);
        }
      }

      // Handle general transfer
      if (event_type === 'transfer' && details?.to_hall_id) {
        if (animal.current_hall_id) {
          await db.query('UPDATE halls SET current_occupancy = GREATEST(current_occupancy - 1, 0) WHERE id = $1', [animal.current_hall_id]);
        }
        await db.query('UPDATE halls SET current_occupancy = current_occupancy + 1 WHERE id = $1', [details.to_hall_id]);
        await db.query('UPDATE animals SET current_hall_id = $1, updated_at = NOW() WHERE id = $2', [details.to_hall_id, animal_id]);
      }
    }

    return ok({ event: evt });
  }

  // Group-level event
  if (group_id) {
    const eventRes = await db.query(
      `INSERT INTO events (event_type, group_id, hall_id, performed_by, event_date, details)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [event_type, group_id, hall_id || null, performed_by || null,
       event_date || new Date().toISOString(), details ? JSON.stringify(details) : '{}']
    );

    // Phase 4: Auto-create withdrawal for group vaccination/treatment
    if (['vaccination', 'treatment'].includes(event_type) && details?.medicine_id) {
      try {
        const wd = await db.query('SELECT withdrawal_days FROM medicine_withdrawals WHERE medicine_id = $1 AND withdrawal_days > 0', [details.medicine_id]);
        if (wd.rows.length > 0) {
          const days = wd.rows[0].withdrawal_days;
          const startDate = event_date || new Date().toISOString().substring(0, 10);
          await db.query(
            `INSERT INTO active_withdrawals (group_id, medicine_id, event_id, start_date, end_date, status)
             VALUES ($1, $2, $3, $4, $4::date + $5 * INTERVAL '1 day', 'active')`,
            [group_id, details.medicine_id, eventRes.rows[0].id, startDate, days]
          );
        }
      } catch {}
    }

    // Handle group mortality
    if (event_type === 'group_death' && details?.count) {
      await db.query('UPDATE animal_groups SET current_count = GREATEST(current_count - $1, 0) WHERE id = $2',
        [details.count, group_id]);
    }

    // Handle group sale
    if (event_type === 'group_sale') {
      const d = details || {};
      await db.query(
        `UPDATE animal_groups SET exit_date = $1, exit_count = $2, exit_weight_avg_kg = $3 WHERE id = $4`,
        [event_date || new Date().toISOString(), d.count || 0, d.avg_weight_kg || null, group_id]
      );
    }

    return ok({ event: eventRes.rows[0] });
  }

  return err(400, 'animal_id или group_id е задължително');
}

async function eventsList(db, { animal_id, group_id, event_type, hall_id, limit }) {
  let q = `SELECT e.*, p.name as performed_by_name, a.ear_tag as animal_ear_tag
           FROM events e
           LEFT JOIN personnel p ON p.id = e.performed_by
           LEFT JOIN animals a ON a.id = e.animal_id
           WHERE 1=1`;
  const params = [];
  let idx = 1;
  if (animal_id) { q += ` AND e.animal_id = $${idx++}`; params.push(animal_id); }
  if (group_id) { q += ` AND e.group_id = $${idx++}`; params.push(group_id); }
  if (event_type) { q += ` AND e.event_type = $${idx++}`; params.push(event_type); }
  if (hall_id) { q += ` AND e.hall_id = $${idx++}`; params.push(hall_id); }
  q += ' ORDER BY e.event_date DESC';
  q += ` LIMIT $${idx++}`; params.push(limit || 50);
  const result = await db.query(q, params);
  return ok({ events: result.rows });
}

// ═══════════════════════════════════════════════════════════════════════════
// LITTERS
// ═══════════════════════════════════════════════════════════════════════════

async function littersCrossFoster(db, { litter_id, nurse_sow_id }) {
  if (!litter_id || !nurse_sow_id) return err(400, 'litter_id и nurse_sow_id са задължителни');

  const litterRes = await db.query('SELECT * FROM litters WHERE id = $1', [litter_id]);
  if (litterRes.rows.length === 0) return err(404, 'Гнездото не е намерено');

  const nurseRes = await db.query('SELECT * FROM animals WHERE id = $1', [nurse_sow_id]);
  if (nurseRes.rows.length === 0) return err(404, 'Кърмачката не е намерена');

  await db.query('UPDATE litters SET nurse_sow_id = $1 WHERE id = $2', [nurse_sow_id, litter_id]);

  // Record as event on nurse sow
  await db.query(
    `INSERT INTO events (event_type, animal_id, event_date, details)
     VALUES ('cross_fostering', $1, NOW(), $2)`,
    [nurse_sow_id, JSON.stringify({ litter_id, birth_sow_id: litterRes.rows[0].birth_sow_id })]
  );

  return ok({ message: 'Прехвърлянето е успешно', litter_id, nurse_sow_id });
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUPS
// ═══════════════════════════════════════════════════════════════════════════

async function groupsCreate(db, { group_name, category, hall_id, entry_count, entry_weight_avg_kg, target_slaughter_date, source_litter_ids }) {
  if (!group_name) return err(400, 'Име на групата е задължително');
  const cat = ['weaner', 'finisher'].includes(category) ? category : 'finisher';
  const result = await db.query(
    `INSERT INTO animal_groups (group_name, category, hall_id, entry_count, current_count, entry_weight_avg_kg, current_weight_avg_kg, target_slaughter_date, source_litter_ids)
     VALUES ($1, $2, $3, $4, $4, $5, $5, $6, $7) RETURNING *`,
    [group_name, cat, hall_id || null, entry_count || 0, entry_weight_avg_kg || null,
     target_slaughter_date || null, source_litter_ids ? JSON.stringify(source_litter_ids) : '[]']
  );
  return ok({ group: result.rows[0] });
}

async function groupsList(db, { category, hall_id, active_only }) {
  let q = `SELECT g.*, h.name as hall_name FROM animal_groups g LEFT JOIN halls h ON h.id = g.hall_id WHERE 1=1`;
  const params = [];
  let idx = 1;
  if (category) { q += ` AND g.category = $${idx++}`; params.push(category); }
  if (hall_id) { q += ` AND g.hall_id = $${idx++}`; params.push(hall_id); }
  if (active_only) { q += ` AND g.exit_date IS NULL`; }
  q += ' ORDER BY g.entry_date DESC';
  const result = await db.query(q, params);
  return ok({ groups: result.rows });
}

async function groupsUpdate(db, { id, current_count, current_weight_avg_kg, target_slaughter_date }) {
  if (!id) return err(400, 'ID е задължително');
  const fields = [];
  const params = [];
  let idx = 1;
  if (current_count !== undefined) { fields.push(`current_count = $${idx++}`); params.push(current_count); }
  if (current_weight_avg_kg !== undefined) { fields.push(`current_weight_avg_kg = $${idx++}`); params.push(current_weight_avg_kg); }
  if (target_slaughter_date !== undefined) { fields.push(`target_slaughter_date = $${idx++}`); params.push(target_slaughter_date); }
  if (fields.length === 0) return err(400, 'Няма полета за обновяване');
  params.push(id);
  const result = await db.query(`UPDATE animal_groups SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
  if (result.rows.length === 0) return err(404, 'Групата не е намерена');
  return ok({ group: result.rows[0] });
}

// ═══════════════════════════════════════════════════════════════════════════
// FEED
// ═══════════════════════════════════════════════════════════════════════════

async function feedComponentsList(db) {
  const result = await db.query('SELECT * FROM feed_components ORDER BY name');
  return ok({ components: result.rows });
}

async function feedComponentsUpsert(db, { id, name, name_bg, price_per_ton, current_stock_kg, reorder_threshold_kg, supplier }) {
  if (id) {
    // Update
    const fields = [];
    const params = [];
    let idx = 1;
    if (name !== undefined) { fields.push(`name = $${idx++}`); params.push(name); }
    if (name_bg !== undefined) { fields.push(`name_bg = $${idx++}`); params.push(name_bg); }
    if (price_per_ton !== undefined) { fields.push(`price_per_ton = $${idx++}`); params.push(price_per_ton); }
    if (current_stock_kg !== undefined) { fields.push(`current_stock_kg = $${idx++}`); params.push(current_stock_kg); }
    if (reorder_threshold_kg !== undefined) { fields.push(`reorder_threshold_kg = $${idx++}`); params.push(reorder_threshold_kg); }
    if (supplier !== undefined) { fields.push(`supplier = $${idx++}`); params.push(supplier); }
    fields.push(`updated_at = NOW()`);
    params.push(id);
    const result = await db.query(`UPDATE feed_components SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);

    // Recalculate all recipes containing this component
    if (price_per_ton !== undefined) {
      await recalculateRecipeCosts(db, id);
    }

    return ok({ component: result.rows[0] });
  }

  // Create
  if (!name) return err(400, 'Име е задължително');
  const result = await db.query(
    `INSERT INTO feed_components (name, name_bg, price_per_ton, current_stock_kg, reorder_threshold_kg, supplier)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [name, name_bg || null, price_per_ton || 0, current_stock_kg || 0, reorder_threshold_kg || 0, supplier || null]
  );
  return ok({ component: result.rows[0] });
}

async function recalculateRecipeCosts(db, componentId) {
  // Find all recipes using this component
  const recipes = await db.query(
    `SELECT DISTINCT recipe_id FROM feed_recipe_components WHERE component_id = $1`, [componentId]);

  for (const row of recipes.rows) {
    await recalculateSingleRecipeCost(db, row.recipe_id);
  }
}

async function recalculateSingleRecipeCost(db, recipeId) {
  const result = await db.query(
    `SELECT SUM(fc.price_per_ton * frc.percentage / 100) as total_cost
     FROM feed_recipe_components frc
     JOIN feed_components fc ON fc.id = frc.component_id
     WHERE frc.recipe_id = $1`,
    [recipeId]
  );
  const cost = result.rows[0]?.total_cost || 0;
  await db.query('UPDATE feed_recipes SET cost_per_ton = $1, updated_at = NOW() WHERE id = $2', [cost, recipeId]);
  return cost;
}

async function feedRecipesList(db) {
  const result = await db.query(
    `SELECT r.*, (SELECT json_agg(json_build_object(
        'component_id', frc.component_id,
        'component_name', fc.name,
        'component_name_bg', fc.name_bg,
        'percentage', frc.percentage,
        'price_per_ton', fc.price_per_ton
      )) FROM feed_recipe_components frc
      JOIN feed_components fc ON fc.id = frc.component_id
      WHERE frc.recipe_id = r.id
     ) as components
     FROM feed_recipes r WHERE r.is_active = true ORDER BY r.name`
  );
  return ok({ recipes: result.rows });
}

async function feedRecipesGet(db, { id }) {
  if (!id) return err(400, 'ID е задължително');
  const result = await db.query('SELECT * FROM feed_recipes WHERE id = $1', [id]);
  if (result.rows.length === 0) return err(404, 'Рецептата не е намерена');
  const comps = await db.query(
    `SELECT frc.*, fc.name, fc.name_bg, fc.price_per_ton, fc.current_stock_kg
     FROM feed_recipe_components frc
     JOIN feed_components fc ON fc.id = frc.component_id
     WHERE frc.recipe_id = $1 ORDER BY frc.percentage DESC`,
    [id]
  );
  return ok({ recipe: result.rows[0], components: comps.rows });
}

async function feedRecipesUpsert(db, { id, name, name_bg, target_category, shrinkage_pct, components }) {
  if (!name) return err(400, 'Име на рецептата е задължително');
  if (!components || !Array.isArray(components) || components.length === 0) return err(400, 'Компоненти са задължителни');

  // Validate total percentage
  const totalPct = components.reduce((s, c) => s + parseFloat(c.percentage || 0), 0);
  if (Math.abs(totalPct - 100) > 0.5) return err(400, `Общият процент е ${totalPct.toFixed(1)}% — трябва да е 100%`);

  let recipeId;
  if (id) {
    await db.query(
      `UPDATE feed_recipes SET name = $1, name_bg = $2, target_category = $3, shrinkage_pct = $4, updated_at = NOW() WHERE id = $5`,
      [name, name_bg || null, target_category || null, shrinkage_pct ?? 0.5, id]
    );
    recipeId = id;
    await db.query('DELETE FROM feed_recipe_components WHERE recipe_id = $1', [recipeId]);
  } else {
    const res = await db.query(
      `INSERT INTO feed_recipes (name, name_bg, target_category, shrinkage_pct) VALUES ($1, $2, $3, $4) RETURNING id`,
      [name, name_bg || null, target_category || null, shrinkage_pct ?? 0.5]
    );
    recipeId = res.rows[0].id;
  }

  for (const c of components) {
    if (c.component_id && c.percentage > 0) {
      await db.query(
        `INSERT INTO feed_recipe_components (recipe_id, component_id, percentage) VALUES ($1, $2, $3)
         ON CONFLICT (recipe_id, component_id) DO UPDATE SET percentage = $3`,
        [recipeId, c.component_id, c.percentage]
      );
    }
  }

  await recalculateSingleRecipeCost(db, recipeId);
  return ok({ message: id ? 'Рецептата е обновена' : 'Рецептата е създадена', recipe_id: recipeId });
}

async function feedUpdatePrice(db, { component_id, price_per_ton }) {
  if (!component_id || price_per_ton === undefined) return err(400, 'component_id и price_per_ton са задължителни');
  await db.query('UPDATE feed_components SET price_per_ton = $1, updated_at = NOW() WHERE id = $2', [price_per_ton, component_id]);
  await recalculateRecipeCosts(db, component_id);

  // Return updated recipes
  const recipesRes = await feedRecipesList(db);
  const recipesData = JSON.parse(recipesRes.body);
  return ok({ message: 'Цената е обновена, рецептите са преизчислени', recipes: recipesData.recipes });
}

async function feedProduce(db, { recipe_id, quantity_tons, produced_by, notes }) {
  if (!recipe_id || !quantity_tons) return err(400, 'recipe_id и quantity_tons са задължителни');

  // Get recipe with components
  const recipe = await db.query('SELECT * FROM feed_recipes WHERE id = $1', [recipe_id]);
  if (recipe.rows.length === 0) return err(404, 'Рецептата не е намерена');

  const shrinkage = recipe.rows[0].shrinkage_pct / 100;
  const comps = await db.query(
    `SELECT frc.*, fc.name, fc.current_stock_kg FROM feed_recipe_components frc
     JOIN feed_components fc ON fc.id = frc.component_id
     WHERE frc.recipe_id = $1`,
    [recipe_id]
  );

  // Calculate required amounts with shrinkage
  const requirements = comps.rows.map(c => {
    const baseKg = quantity_tons * 1000 * (c.percentage / 100);
    const withShrinkage = baseKg / (1 - shrinkage);
    return {
      component_id: c.component_id,
      name: c.name,
      required_kg: Math.round(withShrinkage * 100) / 100,
      available_kg: parseFloat(c.current_stock_kg)
    };
  });

  // Check stock availability
  const shortages = requirements.filter(r => r.required_kg > r.available_kg);
  if (shortages.length > 0) {
    return err(400, `Недостатъчна наличност: ${shortages.map(s =>
      `${s.name}: необходими ${s.required_kg.toFixed(1)} кг, налични ${s.available_kg.toFixed(1)} кг`
    ).join('; ')}`);
  }

  // Deduct from stock
  for (const req of requirements) {
    await db.query(
      'UPDATE feed_components SET current_stock_kg = current_stock_kg - $1, updated_at = NOW() WHERE id = $2',
      [req.required_kg, req.component_id]
    );
  }

  // Record batch
  const batchRes = await db.query(
    `INSERT INTO feed_production_batches (recipe_id, quantity_tons, produced_by, deduction_confirmed, notes, batch_date)
     VALUES ($1, $2, $3, true, $4, CURRENT_DATE) RETURNING *`,
    [recipe_id, quantity_tons, produced_by || null, notes || null]
  );

  // Auto-create expense entry for feed production (Phase 2)
  const costEur = parseFloat(quantity_tons) * parseFloat(recipe.rows[0].cost_per_ton);
  const sectorCode = CATEGORY_TO_SECTOR[recipe.rows[0].target_category];
  let sectorId = null;
  if (sectorCode) {
    const sectorRes = await db.query('SELECT id FROM sectors WHERE code = $1', [sectorCode]);
    sectorId = sectorRes.rows[0]?.id || null;
  }
  const batchDate = new Date().toISOString().split('T')[0];
  const monthKey = batchDate.substring(0, 7);
  await db.query(
    `INSERT INTO expense_entries (entry_date, month_key, category, subcategory, description, amount_eur, sector_id, related_entity_type, related_entity_id, created_by)
     VALUES ($1, $2, 'feed', 'production', $3, $4, $5, 'feed_batch', $6, $7)`,
    [batchDate, monthKey, `${quantity_tons}т ${recipe.rows[0].name_bg || recipe.rows[0].name}`,
     Math.round(costEur * 100) / 100, sectorId, batchRes.rows[0].id, produced_by || null]
  );

  // Check for low stock alerts
  for (const req of requirements) {
    const comp = await db.query('SELECT * FROM feed_components WHERE id = $1', [req.component_id]);
    if (comp.rows.length > 0 && comp.rows[0].current_stock_kg < comp.rows[0].reorder_threshold_kg) {
      await createAlert(db, 'warning', 'feed',
        `Ниска наличност: ${comp.rows[0].name_bg || comp.rows[0].name} — ${parseFloat(comp.rows[0].current_stock_kg).toFixed(0)} кг (под прага от ${parseFloat(comp.rows[0].reorder_threshold_kg).toFixed(0)} кг)`,
        'feed_component', req.component_id, 'stock_level',
        parseFloat(comp.rows[0].current_stock_kg), parseFloat(comp.rows[0].reorder_threshold_kg));
    }
  }

  return ok({ batch: batchRes.rows[0], deductions: requirements });
}

async function feedInventory(db) {
  const comps = await db.query('SELECT * FROM feed_components ORDER BY name');

  // Calculate days-of-supply based on average daily consumption (last 30 days)
  const consumption = await db.query(`
    SELECT fc.id, fc.name, fc.name_bg, fc.current_stock_kg, fc.reorder_threshold_kg,
      COALESCE(SUM(fpb.quantity_tons * 1000 * frc.percentage / 100), 0) as consumed_30d
    FROM feed_components fc
    LEFT JOIN feed_recipe_components frc ON frc.component_id = fc.id
    LEFT JOIN feed_production_batches fpb ON fpb.recipe_id = frc.recipe_id
      AND fpb.batch_date >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY fc.id, fc.name, fc.name_bg, fc.current_stock_kg, fc.reorder_threshold_kg
    ORDER BY fc.name
  `);

  const inventory = consumption.rows.map(c => {
    const dailyConsumption = parseFloat(c.consumed_30d) / 30;
    const daysOfSupply = dailyConsumption > 0 ? parseFloat(c.current_stock_kg) / dailyConsumption : null;
    return {
      ...c,
      daily_consumption_kg: Math.round(dailyConsumption * 100) / 100,
      days_of_supply: daysOfSupply ? Math.round(daysOfSupply) : null,
      below_threshold: parseFloat(c.current_stock_kg) < parseFloat(c.reorder_threshold_kg)
    };
  });

  return ok({ inventory });
}

async function feedBatchesList(db, { recipe_id, limit }) {
  let q = `SELECT fpb.*, fr.name as recipe_name, fr.name_bg as recipe_name_bg, p.name as produced_by_name
           FROM feed_production_batches fpb
           JOIN feed_recipes fr ON fr.id = fpb.recipe_id
           LEFT JOIN personnel p ON p.id = fpb.produced_by
           WHERE 1=1`;
  const params = [];
  let idx = 1;
  if (recipe_id) { q += ` AND fpb.recipe_id = $${idx++}`; params.push(recipe_id); }
  q += ' ORDER BY fpb.batch_date DESC';
  q += ` LIMIT $${idx++}`; params.push(limit || 50);
  const result = await db.query(q, params);
  return ok({ batches: result.rows });
}

// ═══════════════════════════════════════════════════════════════════════════
// KPI
// ═══════════════════════════════════════════════════════════════════════════

async function kpiDashboard(db) {
  // Get latest KPI snapshot
  const latest = await db.query(
    `SELECT DISTINCT ON (kpi_name) kpi_name, kpi_value, snapshot_date, scope_type
     FROM kpi_snapshots WHERE scope_type = 'farm'
     ORDER BY kpi_name, snapshot_date DESC`
  );

  const targets = {
    farrowing_rate: { target: 2.4, label: 'Цикъл опрасване', unit: '/свиня/год' },
    live_born_per_litter: { target: 18.5, label: 'Живородени/гнездо', unit: 'бр.' },
    weaned_per_sow_year: { target: 37, label: 'Отбити/свиня/год', unit: 'бр.' },
    sold_per_sow_year: { target: 34, label: 'Продадени/свиня/год', unit: 'бр.' },
    pre_weaning_mortality: { target: 12, label: 'Смъртност раждане-отбиване', unit: '%', lowerIsBetter: true },
    finishing_mortality: { target: 1.5, label: 'Смъртност угояване', unit: '%', lowerIsBetter: true },
    avg_daily_gain: { target: 1000, label: 'Среден дневен прираст', unit: 'г/ден' },
    avg_slaughter_weight: { target: 110, label: 'Тегло при клане', unit: 'кг' }
  };

  const kpis = Object.entries(targets).map(([name, meta]) => {
    const snapshot = latest.rows.find(r => r.kpi_name === name);
    const value = snapshot ? parseFloat(snapshot.kpi_value) : null;
    let color = 'grey';
    if (value !== null) {
      const pct = meta.lowerIsBetter
        ? (meta.target - value) / meta.target
        : (value - meta.target) / meta.target;
      color = pct >= 0 ? 'green' : pct >= -0.1 ? 'yellow' : 'red';
    }
    return { name, ...meta, value, date: snapshot?.snapshot_date, color };
  });

  return ok({ kpis });
}

async function kpiRecalculate(db) {
  const today = new Date().toISOString().split('T')[0];
  const kpis = [];

  // Active sow count
  const sowCount = await db.query(
    "SELECT COUNT(*) FROM animals WHERE category IN ('sow', 'gilt') AND status != 'culled'"
  );
  const activeSows = parseInt(sowCount.rows[0].count) || 1;

  // Farrowings in last 365 days
  const farrowings = await db.query(
    "SELECT COUNT(*) FROM events WHERE event_type = 'farrowing' AND event_date >= CURRENT_DATE - INTERVAL '365 days'"
  );
  const farrowingRate = parseInt(farrowings.rows[0].count) / activeSows;
  kpis.push({ name: 'farrowing_rate', value: Math.round(farrowingRate * 100) / 100 });

  // Avg live born per litter (last 90 days)
  const liveBorn = await db.query(
    "SELECT AVG(born_alive) as avg_born FROM litters WHERE birth_date >= CURRENT_DATE - INTERVAL '90 days'"
  );
  kpis.push({ name: 'live_born_per_litter', value: parseFloat(liveBorn.rows[0]?.avg_born || 0).toFixed(1) });

  // Weaned per sow per year (last 365 days)
  const weaned = await db.query(
    "SELECT COALESCE(SUM(weaned_count), 0) as total FROM litters WHERE weaning_date >= CURRENT_DATE - INTERVAL '365 days'"
  );
  const weanedPerSow = parseInt(weaned.rows[0].total) / activeSows;
  kpis.push({ name: 'weaned_per_sow_year', value: Math.round(weanedPerSow * 10) / 10 });

  // Pre-weaning mortality (last 90 days)
  const mortalityData = await db.query(
    `SELECT COALESCE(SUM(born_alive), 0) as total_born, COALESCE(SUM(weaned_count), 0) as total_weaned
     FROM litters WHERE weaning_date >= CURRENT_DATE - INTERVAL '90 days' AND weaned_count IS NOT NULL`
  );
  const totalBorn = parseInt(mortalityData.rows[0].total_born) || 0;
  const totalWeaned = parseInt(mortalityData.rows[0].total_weaned) || 0;
  const preWeanMort = totalBorn > 0 ? ((totalBorn - totalWeaned) / totalBorn * 100) : 0;
  kpis.push({ name: 'pre_weaning_mortality', value: Math.round(preWeanMort * 10) / 10 });

  // Finishing mortality (placeholder - requires group tracking)
  kpis.push({ name: 'finishing_mortality', value: 0 });

  // Avg daily gain (from groups with entry/exit weights)
  kpis.push({ name: 'avg_daily_gain', value: 0 });

  // Avg slaughter weight (from group exits)
  const slaughterWeight = await db.query(
    "SELECT AVG(exit_weight_avg_kg) as avg_weight FROM animal_groups WHERE exit_date >= CURRENT_DATE - INTERVAL '90 days' AND exit_weight_avg_kg IS NOT NULL"
  );
  kpis.push({ name: 'avg_slaughter_weight', value: parseFloat(slaughterWeight.rows[0]?.avg_weight || 0).toFixed(1) });

  // Sold per sow per year (from group exits in last 365 days)
  const sold = await db.query(
    "SELECT COALESCE(SUM(exit_count), 0) as total FROM animal_groups WHERE exit_date >= CURRENT_DATE - INTERVAL '365 days'"
  );
  const soldPerSow = parseInt(sold.rows[0].total) / activeSows;
  kpis.push({ name: 'sold_per_sow_year', value: Math.round(soldPerSow * 10) / 10 });

  // Save snapshots
  for (const kpi of kpis) {
    await db.query(
      `INSERT INTO kpi_snapshots (snapshot_date, kpi_name, kpi_value, scope_type)
       VALUES ($1, $2, $3, 'farm')
       ON CONFLICT DO NOTHING`,
      [today, kpi.name, kpi.value]
    );
  }

  // Check alert thresholds
  const avgBorn = parseFloat(liveBorn.rows[0]?.avg_born || 0);
  if (avgBorn > 0 && avgBorn < 16) {
    await createAlert(db, 'critical', 'reproduction',
      `Средна раждаемост за последните 90 дни: ${avgBorn.toFixed(1)} живородени (< 16.0)`,
      null, null, 'avg_live_born_90d', avgBorn, 16);
  }

  if (preWeanMort > 12) {
    await createAlert(db, 'critical', 'mortality',
      `Смъртност раждане-отбиване: ${preWeanMort.toFixed(1)}% (> 12%)`,
      null, null, 'pre_weaning_mortality', preWeanMort, 12);
  }

  return ok({ message: 'KPI преизчислени', kpis, date: today });
}

// ═══════════════════════════════════════════════════════════════════════════
// ALERTS
// ═══════════════════════════════════════════════════════════════════════════

async function createAlert(db, severity, category, message, entityType, entityId, thresholdName, thresholdValue, targetValue) {
  await db.query(
    `INSERT INTO alerts (severity, category, message, related_entity_type, related_entity_id, threshold_name, threshold_value, target_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [severity, category, message, entityType || null, entityId || null, thresholdName || null, thresholdValue || null, targetValue || null]
  );

  // Publish via Pulse
  try {
    const pulse = await import('openkbs-pulse/server');
    const kbId = process.env.OPENKBS_KB_ID;
    const apiKey = process.env.OPENKBS_API_KEY;
    if (kbId && apiKey) {
      await pulse.default.publish('alerts', 'new_alert', { severity, category, message }, { kbId, apiKey });
    }
  } catch (e) {
    console.log('Pulse publish skipped:', e.message);
  }
}

async function alertsList(db, { severity, category, acknowledged, limit }) {
  let q = 'SELECT a.*, p.name as acknowledged_by_name FROM alerts a LEFT JOIN personnel p ON p.id = a.acknowledged_by WHERE 1=1';
  const params = [];
  let idx = 1;
  if (severity) { q += ` AND a.severity = $${idx++}`; params.push(severity); }
  if (category) { q += ` AND a.category = $${idx++}`; params.push(category); }
  if (acknowledged === false || acknowledged === 'false') { q += ' AND a.is_acknowledged = false'; }
  if (acknowledged === true || acknowledged === 'true') { q += ' AND a.is_acknowledged = true'; }
  q += ' ORDER BY a.created_at DESC';
  q += ` LIMIT $${idx++}`; params.push(limit || 50);
  const result = await db.query(q, params);
  return ok({ alerts: result.rows });
}

async function alertsAcknowledge(db, { id, acknowledged_by, notes }) {
  if (!id) return err(400, 'ID е задължително');
  const result = await db.query(
    `UPDATE alerts SET is_acknowledged = true, acknowledged_by = $1, acknowledged_at = NOW(), acknowledge_notes = $2
     WHERE id = $3 RETURNING *`,
    [acknowledged_by || null, notes || null, id]
  );
  if (result.rows.length === 0) return err(404, 'Алармата не е намерена');
  return ok({ alert: result.rows[0] });
}

async function alertsCheck(db) {
  // Run threshold checks and generate alerts if needed
  // FCR check for finisher groups
  const fcrGroups = await db.query(`
    SELECT g.id, g.group_name, g.entry_weight_avg_kg, g.current_weight_avg_kg, g.current_count
    FROM animal_groups g
    WHERE g.category = 'finisher' AND g.exit_date IS NULL AND g.current_weight_avg_kg IS NOT NULL
  `);

  let alertsGenerated = 0;

  // Phase 4: Auto-expire active withdrawals
  await db.query(`UPDATE active_withdrawals SET status = 'expired' WHERE status = 'active' AND end_date <= CURRENT_DATE`);

  // Phase 4: Check groups with active withdrawal that have pending dispatches
  try {
    const conflicts = await db.query(`
      SELECT d.id as dispatch_id, g.group_name, mc.name_bg as medicine_name, aw.end_date
      FROM dispatch_orders d
      JOIN animal_groups g ON g.id = d.group_id
      JOIN active_withdrawals aw ON aw.group_id = d.group_id AND aw.status = 'active' AND aw.end_date > CURRENT_DATE
      JOIN medicine_catalog mc ON mc.id = aw.medicine_id
      WHERE d.status IN ('proposed', 'confirmed')
    `);
    for (const c of conflicts.rows) {
      await createAlert(db, 'critical', 'biosecurity',
        `Dispatch #${c.dispatch_id} за ${c.group_name} — активен карентен срок: ${c.medicine_name} до ${c.end_date}`,
        'dispatch', c.dispatch_id, 'withdrawal_conflict', 1, 0);
      alertsGenerated++;
    }
  } catch {}

  return ok({ message: `Проверка завършена. ${alertsGenerated} нови аларми.` });
}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD BUNDLE
// ═══════════════════════════════════════════════════════════════════════════

async function dashboardBundle(db) {
  // Animal counts by category
  const animalCounts = await db.query(`
    SELECT category, status, COUNT(*) as count
    FROM animals WHERE status != 'culled'
    GROUP BY category, status ORDER BY category, status
  `);

  // Total by category
  const totalByCategory = await db.query(`
    SELECT category, COUNT(*) as count
    FROM animals WHERE status != 'culled'
    GROUP BY category ORDER BY category
  `);

  // Animals by hall
  const animalsByHall = await db.query(`
    SELECT h.id, h.name as hall_name, s.name as sector_name, h.capacity, h.current_occupancy,
      COUNT(a.id) as animal_count
    FROM halls h
    JOIN sectors s ON s.id = h.sector_id
    LEFT JOIN animals a ON a.current_hall_id = h.id AND a.status != 'culled'
    WHERE h.is_active = true
    GROUP BY h.id, h.name, s.name, h.capacity, h.current_occupancy
    ORDER BY s.name, h.name
  `);

  // Active alerts count
  const alertCounts = await db.query(`
    SELECT severity, COUNT(*) as count
    FROM alerts WHERE is_acknowledged = false
    GROUP BY severity
  `);

  // Recent alerts (top 10)
  const recentAlerts = await db.query(`
    SELECT * FROM alerts WHERE is_acknowledged = false
    ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC
    LIMIT 10
  `);

  // KPIs
  const kpiRes = await kpiDashboard(db);
  const kpiData = JSON.parse(kpiRes.body);

  // Feed inventory summary
  const feedSummary = await db.query(`
    SELECT COUNT(*) FILTER (WHERE current_stock_kg < reorder_threshold_kg) as below_threshold,
           COUNT(*) as total_components
    FROM feed_components
  `);

  // Phase 2: Financial summary for dashboard
  const currentMonth = new Date().toISOString().substring(0, 7);
  const monthStart = `${currentMonth}-01`;
  const monthRevenue = await db.query(
    `SELECT COALESCE(SUM(total_amount_eur), 0) as total FROM sales WHERE sale_date >= $1`, [monthStart]);
  const monthExpenses = await db.query(
    `SELECT COALESCE(SUM(amount_eur), 0) as total FROM expense_entries WHERE month_key = $1`, [currentMonth]);
  const revenueVal = parseFloat(monthRevenue.rows[0].total);
  const expenseVal = parseFloat(monthExpenses.rows[0].total);

  let financialKpis = [];
  try {
    const fkRes = await reportsFinancialKpis(db);
    financialKpis = JSON.parse(fkRes.body).financialKpis || [];
  } catch {}

  // Phase 3: Logistics summary for dashboard
  let logistics = { vehicles: { clean: 0, dirty: 0, maintenance: 0, total: 0 }, lowSilos: 0, activeRoutes: 0, pendingDispatches: 0 };
  try {
    const vStatus = await db.query(`SELECT status, COUNT(*) as count FROM vehicles WHERE is_active = true GROUP BY status`);
    for (const v of vStatus.rows) { logistics.vehicles[v.status] = parseInt(v.count); logistics.vehicles.total += parseInt(v.count); }
    const lowSilos = await db.query(`SELECT COUNT(*) FROM silos WHERE is_active = true AND capacity_tons > 0 AND (current_level_tons / capacity_tons * 100) < low_level_threshold_pct`);
    logistics.lowSilos = parseInt(lowSilos.rows[0].count);
    const activeRoutes = await db.query(`SELECT COUNT(*) FROM delivery_routes WHERE status IN ('planned', 'in_progress') AND route_date = CURRENT_DATE`);
    logistics.activeRoutes = parseInt(activeRoutes.rows[0].count);
    const pendingDisp = await db.query(`SELECT COUNT(*) FROM dispatch_orders WHERE status IN ('proposed', 'confirmed')`);
    logistics.pendingDispatches = parseInt(pendingDisp.rows[0].count);
  } catch {}

  // Phase 4: Biosecurity summary
  let biosecurity = { violationsToday: 0, activeWithdrawals: 0, hallsInHygiene: 0 };
  try {
    const violToday = await db.query(`SELECT COUNT(*) FROM biosecurity_violations WHERE created_at >= CURRENT_DATE AND is_resolved = false`);
    biosecurity.violationsToday = parseInt(violToday.rows[0].count);
    const actWd = await db.query(`SELECT COUNT(*) FROM active_withdrawals WHERE status = 'active' AND end_date >= CURRENT_DATE`);
    biosecurity.activeWithdrawals = parseInt(actWd.rows[0].count);
    const hyg = await db.query(`SELECT COUNT(*) FROM hall_hygiene_pauses WHERE status NOT IN ('ready', 'cancelled')`);
    biosecurity.hallsInHygiene = parseInt(hyg.rows[0].count);
  } catch {}

  // Phase 5: Bonus summary
  let bonuses = { currentMonth: currentMonth, calculated: 0, approved: 0, totalBonusEur: 0 };
  try {
    const bCalc = await db.query(`SELECT status, COUNT(*) as cnt, COALESCE(SUM(bonus_amount_eur), 0) as total FROM bonus_calculations WHERE month_key = $1 GROUP BY status`, [currentMonth]);
    for (const r of bCalc.rows) {
      if (r.status === 'calculated') bonuses.calculated = parseInt(r.cnt);
      if (r.status === 'approved') { bonuses.approved = parseInt(r.cnt); bonuses.totalBonusEur = parseFloat(r.total); }
    }
  } catch {}

  // Water consumption summary
  let water = { todayReadings: 0, alertsToday: 0, avgConsumption: 0 };
  try {
    const wToday = await db.query(`SELECT COUNT(*) FROM water_consumption WHERE reading_date = CURRENT_DATE`);
    water.todayReadings = parseInt(wToday.rows[0].count);
    const wAlerts = await db.query(`SELECT COUNT(*) FROM alerts WHERE category = 'water' AND is_acknowledged = false`);
    water.alertsToday = parseInt(wAlerts.rows[0].count);
    const wAvg = await db.query(`SELECT AVG(consumption_m3) as avg FROM water_consumption WHERE reading_date >= CURRENT_DATE - INTERVAL '7 days'`);
    water.avgConsumption = parseFloat(wAvg.rows[0]?.avg || 0).toFixed(1);
  } catch {}

  // Employee profitability summary
  let employeeProfit = { profitPerEmployee: 0, revenuePerEmployee: 0, labourCostPerKg: 0, totalStaff: 125 };
  try {
    const epRes = await reportsEmployeeProfitability(db, { month_key: currentMonth });
    const epData = JSON.parse(epRes.body).employeeProfitability;
    employeeProfit = { profitPerEmployee: epData.profitPerEmployee, revenuePerEmployee: epData.revenuePerEmployee, labourCostPerKg: epData.labourCostPerKg, totalStaff: epData.totalStaff };
  } catch {}

  // Phase 6: Traceability summary
  let traceability = { totalRecords: 0, totalDocuments: 0, recentDocuments: [] };
  try {
    const trTotal = await db.query(`SELECT COUNT(*) FROM traceability_records`);
    traceability.totalRecords = parseInt(trTotal.rows[0].count);
    const docTotal = await db.query(`SELECT COUNT(*) FROM regulatory_documents`);
    traceability.totalDocuments = parseInt(docTotal.rows[0].count);
    const recentDocs = await db.query(`SELECT id, document_type, reference_number, title, status, created_at FROM regulatory_documents ORDER BY created_at DESC LIMIT 5`);
    traceability.recentDocuments = recentDocs.rows;
  } catch {}

  return ok({
    animalCounts: animalCounts.rows,
    totalByCategory: totalByCategory.rows,
    animalsByHall: animalsByHall.rows,
    alertCounts: alertCounts.rows,
    recentAlerts: recentAlerts.rows,
    kpis: kpiData.kpis,
    feedSummary: feedSummary.rows[0],
    finance: {
      month: currentMonth,
      revenue: Math.round(revenueVal * 100) / 100,
      expenses: Math.round(expenseVal * 100) / 100,
      profit: Math.round((revenueVal - expenseVal) * 100) / 100,
      margin: revenueVal > 0 ? Math.round((revenueVal - expenseVal) / revenueVal * 10000) / 100 : 0,
      kpis: financialKpis
    },
    logistics,
    biosecurity,
    bonuses,
    traceability,
    water,
    employeeProfit
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SEED DATA
// ═══════════════════════════════════════════════════════════════════════════

async function seedData(db) {
  // Seed sectors
  const sectorData = [
    { name: 'Осеменяване', code: 'INS' },
    { name: 'Бременни', code: 'PREG' },
    { name: 'Родилно', code: 'FAR' },
    { name: 'Подрастващи', code: 'NUR' },
    { name: 'Угояване', code: 'FIN' }
  ];
  for (const s of sectorData) {
    await db.query(
      'INSERT INTO sectors (name, code) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING',
      [s.name, s.code]
    );
  }
  const sectors = await db.query('SELECT * FROM sectors ORDER BY id');

  // Seed halls (25 halls across 5 sectors)
  const hallConfigs = [
    { sector: 'INS', count: 3, prefix: 'ОСМ', zone: 'black', capacity: 300 },
    { sector: 'PREG', count: 5, prefix: 'БРЕМ', zone: 'black', capacity: 400 },
    { sector: 'FAR', count: 7, prefix: 'РОД', zone: 'black', capacity: 80 },
    { sector: 'NUR', count: 4, prefix: 'ПОДР', zone: 'black', capacity: 500 },
    { sector: 'FIN', count: 6, prefix: 'УГОЯ', zone: 'black', capacity: 600 }
  ];

  for (const cfg of hallConfigs) {
    const sector = sectors.rows.find(s => s.code === cfg.sector);
    if (!sector) continue;
    for (let i = 1; i <= cfg.count; i++) {
      await db.query(
        `INSERT INTO halls (name, sector_id, biosecurity_zone, capacity)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [`${cfg.prefix}-${i}`, sector.id, cfg.zone, cfg.capacity]
      );
    }
  }

  // Seed feed components
  const components = [
    { name: 'Corn', name_bg: 'Царевица', price: 210, stock: 50000, threshold: 10000 },
    { name: 'Barley', name_bg: 'Ечемик', price: 190, stock: 30000, threshold: 5000 },
    { name: 'Soy Meal', name_bg: 'Соев шрот (46%)', price: 480, stock: 20000, threshold: 5000 },
    { name: 'Wheat Bran', name_bg: 'Пшенични трици', price: 150, stock: 15000, threshold: 3000 },
    { name: 'Vegetable Oil', name_bg: 'Растително масло', price: 900, stock: 5000, threshold: 1000 },
    { name: 'Premix Lactation', name_bg: 'Премикс Лактация', price: 1200, stock: 5000, threshold: 1000 },
    { name: 'Wheat', name_bg: 'Пшеница', price: 200, stock: 25000, threshold: 5000 },
    { name: 'Sunflower Meal', name_bg: 'Слънчогледов шрот', price: 170, stock: 15000, threshold: 3000 },
    { name: 'Premix Gestation', name_bg: 'Премикс Бременни', price: 800, stock: 3000, threshold: 500 },
    { name: 'Extruded Corn', name_bg: 'Екструдирана царевица', price: 350, stock: 8000, threshold: 2000 },
    { name: 'Hi-Pro Soy Meal', name_bg: 'Обелен соев шрот', price: 520, stock: 5000, threshold: 1000 },
    { name: 'Whey Powder', name_bg: 'Суроватка на прах', price: 1100, stock: 3000, threshold: 500 },
    { name: 'Fish Meal', name_bg: 'Рибно брашно', price: 1800, stock: 1000, threshold: 200 },
    { name: 'Prestarter Premix', name_bg: 'Престартер премикс', price: 2500, stock: 1500, threshold: 300 },
    { name: 'Premix Finisher', name_bg: 'Премикс Угояване', price: 750, stock: 4000, threshold: 800 }
  ];

  for (const c of components) {
    await db.query(
      `INSERT INTO feed_components (name, name_bg, price_per_ton, current_stock_kg, reorder_threshold_kg)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [c.name, c.name_bg, c.price, c.stock, c.threshold]
    );
  }
  const allComps = await db.query('SELECT * FROM feed_components ORDER BY id');

  // Helper to find component id
  const cid = (name) => allComps.rows.find(c => c.name === name)?.id;

  // Seed 4 recipes
  const recipes = [
    { name: 'Lactating Sows', name_bg: 'Лактиращи майки', target: 'sow', components: [
      { comp: 'Corn', pct: 40 }, { comp: 'Barley', pct: 25 }, { comp: 'Soy Meal', pct: 22 },
      { comp: 'Wheat Bran', pct: 8 }, { comp: 'Vegetable Oil', pct: 2 }, { comp: 'Premix Lactation', pct: 3 }
    ]},
    { name: 'Pregnant Sows', name_bg: 'Бременни майки', target: 'sow', components: [
      { comp: 'Barley', pct: 45 }, { comp: 'Wheat', pct: 20 }, { comp: 'Sunflower Meal', pct: 25 },
      { comp: 'Soy Meal', pct: 6 }, { comp: 'Premix Gestation', pct: 4 }
    ]},
    { name: 'Starter', name_bg: 'Стартер (7-12 кг)', target: 'weaner', components: [
      { comp: 'Extruded Corn', pct: 45 }, { comp: 'Hi-Pro Soy Meal', pct: 25 },
      { comp: 'Whey Powder', pct: 15 }, { comp: 'Fish Meal', pct: 5 }, { comp: 'Prestarter Premix', pct: 10 }
    ]},
    { name: 'Finisher', name_bg: 'Финишер (Угояване)', target: 'finisher', components: [
      { comp: 'Corn', pct: 50 }, { comp: 'Wheat', pct: 30 }, { comp: 'Sunflower Meal', pct: 12 },
      { comp: 'Soy Meal', pct: 5 }, { comp: 'Premix Finisher', pct: 3 }
    ]}
  ];

  for (const r of recipes) {
    const res = await db.query(
      `INSERT INTO feed_recipes (name, name_bg, target_category)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id`,
      [r.name, r.name_bg, r.target]
    );
    let recipeId = res.rows[0]?.id;
    if (!recipeId) {
      const existing = await db.query('SELECT id FROM feed_recipes WHERE name = $1', [r.name]);
      recipeId = existing.rows[0]?.id;
    }
    if (recipeId) {
      for (const comp of r.components) {
        const compId = cid(comp.comp);
        if (compId) {
          await db.query(
            `INSERT INTO feed_recipe_components (recipe_id, component_id, percentage)
             VALUES ($1, $2, $3) ON CONFLICT (recipe_id, component_id) DO UPDATE SET percentage = $3`,
            [recipeId, compId, comp.pct]
          );
        }
      }
      await recalculateSingleRecipeCost(db, recipeId);
    }
  }

  // Seed admin user
  const salt = generateSalt();
  const hash = await hashPassword('admin123', salt);
  await db.query(
    `INSERT INTO personnel (name, email, password_hash, salt, role, private_channel)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (email) DO NOTHING`,
    ['Администратор', 'admin@ajaxerp.com', hash, salt, 'admin', generateChannel()]
  );

  // Seed salary templates (per spec: Организатор, Зооинженер, Животновъд, Шофьор, Чистач)
  const salarySeeds = [
    { role: 'admin', salary: 2800 },
    { role: 'production_manager', salary: 1810 },
    { role: 'zooeng', salary: 2429 },
    { role: 'farm_worker', salary: 1458 },
    { role: 'driver', salary: 1662 },
    { role: 'cleaner', salary: 1202 }
  ];
  for (const s of salarySeeds) {
    await db.query(
      `INSERT INTO salary_templates (role, base_salary_eur) VALUES ($1, $2) ON CONFLICT (role) DO NOTHING`,
      [s.role, s.salary]
    );
  }

  // Seed medicine catalog
  const medicines = [
    { name: 'Amoxicillin', name_bg: 'Амоксицилин', unit: 'ml', price: 0.85, stock: 5000 },
    { name: 'Ivermectin', name_bg: 'Ивермектин', unit: 'ml', price: 1.20, stock: 2000 },
    { name: 'Iron Dextran', name_bg: 'Железен декстран', unit: 'ml', price: 0.35, stock: 10000 },
    { name: 'Oxytocin', name_bg: 'Окситоцин', unit: 'ml', price: 2.50, stock: 500 },
    { name: 'PCV2 Vaccine', name_bg: 'PCV2 Ваксина', unit: 'dose', price: 1.80, stock: 8000 },
    { name: 'PRRS Vaccine', name_bg: 'PRRS Ваксина', unit: 'dose', price: 2.10, stock: 6000 },
    { name: 'Mycoplasma Vaccine', name_bg: 'Микоплазма Ваксина', unit: 'dose', price: 1.50, stock: 8000 },
    { name: 'Enrofloxacin', name_bg: 'Енрофлоксацин', unit: 'ml', price: 1.10, stock: 3000 },
    { name: 'Meloxicam', name_bg: 'Мелоксикам', unit: 'ml', price: 1.45, stock: 2000 },
    { name: 'Toltrazuril', name_bg: 'Толтразурил', unit: 'ml', price: 0.95, stock: 4000 }
  ];
  for (const m of medicines) {
    await db.query(
      `INSERT INTO medicine_catalog (name, name_bg, unit, price_per_unit_eur, current_stock, reorder_threshold)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [m.name, m.name_bg, m.unit, m.price, m.stock, Math.round(m.stock * 0.15)]
    );
  }

  // ─── Phase 3: Seed logistics data ───────────────────────────────────

  // Seed driver personnel (7 drivers)
  const driverNames = [
    'Иван Петров', 'Георги Димитров', 'Стоян Стоянов', 'Димитър Иванов',
    'Петър Георгиев', 'Николай Тодоров', 'Христо Николов'
  ];
  const driverIds = [];
  for (let i = 0; i < driverNames.length; i++) {
    const dSalt = generateSalt();
    const dHash = await hashPassword('driver123', dSalt);
    const dEmail = `driver${i + 1}@ajaxerp.com`;
    const dRes = await db.query(
      `INSERT INTO personnel (name, email, password_hash, salt, role, private_channel)
       VALUES ($1, $2, $3, $4, 'driver', $5) ON CONFLICT (email) DO NOTHING RETURNING id`,
      [driverNames[i], dEmail, dHash, dSalt, generateChannel()]
    );
    if (dRes.rows[0]) {
      driverIds.push(dRes.rows[0].id);
    } else {
      const existing = await db.query('SELECT id FROM personnel WHERE email = $1', [dEmail]);
      if (existing.rows[0]) driverIds.push(existing.rows[0].id);
    }
  }

  // Driver salary already seeded above

  // Seed vehicles (7 feed trucks + 1 livestock transport)
  const vehicleData = [
    { plate: 'CB1234AB', type: 'feed_truck', capacity: 12.0 },
    { plate: 'CB5678CD', type: 'feed_truck', capacity: 12.0 },
    { plate: 'CB9012EF', type: 'feed_truck', capacity: 10.0 },
    { plate: 'CB3456GH', type: 'feed_truck', capacity: 10.0 },
    { plate: 'CB7890IJ', type: 'feed_truck', capacity: 8.0 },
    { plate: 'CB2345KL', type: 'feed_truck', capacity: 8.0 },
    { plate: 'CB6789MN', type: 'feed_truck', capacity: 15.0 },
    { plate: 'CB0001OP', type: 'livestock_transport', capacity: 0 }
  ];
  for (let i = 0; i < vehicleData.length; i++) {
    const v = vehicleData[i];
    await db.query(
      `INSERT INTO vehicles (plate_number, vehicle_type, capacity_tons, assigned_driver_id, current_km)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (plate_number) DO NOTHING`,
      [v.plate, v.type, v.capacity, driverIds[i] || null, Math.floor(Math.random() * 50000) + 10000]
    );
  }

  // Seed silos (1 per hall)
  const allHalls = await db.query(
    `SELECT h.id, h.name, s.code as sector_code FROM halls h JOIN sectors s ON s.id = h.sector_id ORDER BY h.id`
  );
  const allRecipes = await db.query('SELECT id, name, target_category FROM feed_recipes ORDER BY id');
  const sectorRecipeMap = {
    FAR: 'sow', PREG: 'sow', INS: 'sow',
    NUR: 'weaner', FIN: 'finisher'
  };
  const siloCapacityMap = { INS: 2, PREG: 2, FAR: 2, NUR: 3, FIN: 5 };

  for (const hall of allHalls.rows) {
    const targetCat = sectorRecipeMap[hall.sector_code];
    const recipe = allRecipes.rows.find(r => r.target_category === targetCat);
    const capacity = siloCapacityMap[hall.sector_code] || 3;
    const level = Math.round((Math.random() * 0.6 + 0.2) * capacity * 100) / 100; // 20-80% full
    await db.query(
      `INSERT INTO silos (hall_id, silo_name, capacity_tons, current_level_tons, feed_type, recipe_id, last_filled_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW() - INTERVAL '${Math.floor(Math.random() * 7)} days')
       ON CONFLICT (hall_id, silo_name) DO NOTHING`,
      [`${hall.id}`, `Силоз ${hall.name}`, capacity, level, recipe?.name || 'Общ', recipe?.id || null]
    );
  }

  // ─── Phase 4: Seed medicine withdrawal rules ───────────────────────
  const allMeds = await db.query('SELECT id, name FROM medicine_catalog ORDER BY id');
  const mid = (name) => allMeds.rows.find(m => m.name === name)?.id;

  const withdrawalRules = [
    { medicine: 'Amoxicillin', days: 14, applies_to: 'all', notes: 'Антибиотик — 14 дни карентен срок' },
    { medicine: 'Enrofloxacin', days: 10, applies_to: 'all', notes: 'Флуорохинолон — 10 дни' },
    { medicine: 'Ivermectin', days: 21, applies_to: 'all', notes: 'Антипаразитен — 21 дни' },
    { medicine: 'Meloxicam', days: 7, applies_to: 'all', notes: 'НСПВС — 7 дни' },
    { medicine: 'Toltrazuril', days: 77, applies_to: 'weaner', notes: 'Кокцидиостатик — 77 дни' },
    { medicine: 'Iron Dextran', days: 0, applies_to: 'all', notes: 'Без карентен срок' },
    { medicine: 'PCV2 Vaccine', days: 0, applies_to: 'all', notes: 'Ваксина — без карентен срок' },
    { medicine: 'PRRS Vaccine', days: 0, applies_to: 'all', notes: 'Ваксина — без карентен срок' },
    { medicine: 'Mycoplasma Vaccine', days: 0, applies_to: 'all', notes: 'Ваксина — без карентен срок' },
    { medicine: 'Oxytocin', days: 0, applies_to: 'sow', notes: 'Хормон — без карентен срок' }
  ];
  for (const wr of withdrawalRules) {
    const mId = mid(wr.medicine);
    if (mId) {
      await db.query(
        `INSERT INTO medicine_withdrawals (medicine_id, withdrawal_days, applies_to, notes)
         VALUES ($1, $2, $3, $4) ON CONFLICT (medicine_id) DO NOTHING`,
        [mId, wr.days, wr.applies_to, wr.notes]
      );
    }
  }

  // Seed sample access logs (admin accessing different halls)
  const adminRes = await db.query("SELECT id FROM personnel WHERE email = 'admin@ajaxerp.com'");
  const adminId = adminRes.rows[0]?.id;
  if (adminId && allHalls.rows.length > 0) {
    for (let i = 0; i < Math.min(5, allHalls.rows.length); i++) {
      const h = allHalls.rows[i];
      await db.query(
        `INSERT INTO access_logs (personnel_id, hall_id, action, zone, sector_code, method, shower_confirmed)
         VALUES ($1, $2, 'entry', 'black', $3, 'manual', true)
         ON CONFLICT DO NOTHING`,
        [adminId, h.id, h.sector_code]
      );
    }
  }

  // ─── Phase 5: Seed bonus rules (3 KPI rules) ──────────────────────
  const bonusRulesData = [
    { kpi: 'survival_farrowing', label: 'Преживяемост раждане (< 12% смъртност)', target: 12, op: 'lt', pct: 10, sector: 'FAR', desc: 'Бонус 10% при смъртност < 12% в родилно' },
    { kpi: 'weaning_weight', label: 'Тегло отбиване (> 6.0 кг)', target: 6.0, op: 'gt', pct: 5, sector: 'NUR', desc: 'Бонус 5% при средно тегло отбиване > 6.0 кг' },
    { kpi: 'fcr_finishing', label: 'FCR Угояване (< 2.40)', target: 2.40, op: 'lt', pct: 5, sector: 'FIN', desc: 'Бонус 5% при FCR < 2.40 в угояване' }
  ];
  for (const br of bonusRulesData) {
    await db.query(
      `INSERT INTO bonus_rules (kpi_name, kpi_label, target_value, operator, bonus_pct, applies_to_sector_code, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (kpi_name) DO NOTHING`,
      [br.kpi, br.label, br.target, br.op, br.pct, br.sector, br.desc]
    );
  }

  // ─── Rich seed data: Personnel across all roles ─────────────────────
  const personnelSeed = [
    // Production Managers (Организатори производство)
    { name: 'Мария Иванова', email: 'maria@ajaxerp.com', role: 'production_manager' },
    { name: 'Васил Колев', email: 'vasil.k@ajaxerp.com', role: 'production_manager' },
    { name: 'Елена Георгиева', email: 'elena@ajaxerp.com', role: 'production_manager' },
    // Zoo-engineers / Vets (Зооинженери / Лекари)
    { name: 'Д-р Калина Петрова', email: 'kalina@ajaxerp.com', role: 'zooeng' },
    { name: 'Д-р Пламен Стефанов', email: 'plamen@ajaxerp.com', role: 'zooeng' },
    { name: 'Д-р Росица Вълчева', email: 'rosica@ajaxerp.com', role: 'zooeng' },
    // Farm workers (Животновъди)
    { name: 'Тодор Михайлов', email: 'todor@ajaxerp.com', role: 'farm_worker' },
    { name: 'Ангел Христов', email: 'angel@ajaxerp.com', role: 'farm_worker' },
    { name: 'Красимир Янков', email: 'krasimir@ajaxerp.com', role: 'farm_worker' },
    { name: 'Йордан Димов', email: 'yordan@ajaxerp.com', role: 'farm_worker' },
    { name: 'Борис Славов', email: 'boris@ajaxerp.com', role: 'farm_worker' },
    { name: 'Светла Маринова', email: 'svetla@ajaxerp.com', role: 'farm_worker' },
    { name: 'Деница Радева', email: 'denica@ajaxerp.com', role: 'farm_worker' },
    { name: 'Румен Кирилов', email: 'rumen@ajaxerp.com', role: 'farm_worker' },
    { name: 'Мирослав Тончев', email: 'miroslav@ajaxerp.com', role: 'farm_worker' },
    { name: 'Стефан Илиев', email: 'stefan@ajaxerp.com', role: 'farm_worker' },
    { name: 'Галина Добрева', email: 'galina@ajaxerp.com', role: 'farm_worker' },
    { name: 'Валентин Стоянов', email: 'valentin@ajaxerp.com', role: 'farm_worker' },
    // Cleaners (Чистачи / Общи работници)
    { name: 'Пенка Атанасова', email: 'penka@ajaxerp.com', role: 'cleaner' },
    { name: 'Цветана Бойчева', email: 'cvetana@ajaxerp.com', role: 'cleaner' },
    { name: 'Радка Николова', email: 'radka@ajaxerp.com', role: 'cleaner' },
    { name: 'Милка Василева', email: 'milka@ajaxerp.com', role: 'cleaner' }
  ];
  const personnelIds = {};
  for (const p of personnelSeed) {
    const pSalt = generateSalt();
    const pHash = await hashPassword('pass123', pSalt);
    const pRes = await db.query(
      `INSERT INTO personnel (name, email, password_hash, salt, role, phone, hire_date, private_channel)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (email) DO NOTHING RETURNING id`,
      [p.name, p.email, pHash, pSalt, p.role, '+359 88 ' + Math.floor(1000000 + Math.random() * 9000000), '2024-' + String(Math.floor(Math.random() * 12) + 1).padStart(2, '0') + '-01', generateChannel()]
    );
    if (pRes.rows[0]) {
      if (!personnelIds[p.role]) personnelIds[p.role] = [];
      personnelIds[p.role].push(pRes.rows[0].id);
    }
  }

  // ─── Personnel-Hall assignments ────────────────────────────────────
  const hallRows = await db.query(`SELECT h.id, s.code as sector_code FROM halls h JOIN sectors s ON s.id = h.sector_id ORDER BY h.id`);
  const farmWorkerIds = personnelIds['farm_worker'] || [];
  let fwIdx = 0;
  for (const h of hallRows.rows) {
    // Assign 1-2 farm workers per hall
    if (farmWorkerIds[fwIdx]) {
      await db.query('INSERT INTO personnel_halls (personnel_id, hall_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [farmWorkerIds[fwIdx], h.id]);
    }
    fwIdx = (fwIdx + 1) % farmWorkerIds.length;
  }
  // Assign cleaners to first halls of each sector
  const cleanerIds = personnelIds['cleaner'] || [];
  const sectorCodes = ['INS', 'PREG', 'FAR', 'NUR', 'FIN'];
  for (let i = 0; i < cleanerIds.length && i < sectorCodes.length; i++) {
    const sectorHalls = hallRows.rows.filter(h => h.sector_code === sectorCodes[i]);
    for (const sh of sectorHalls.slice(0, 2)) {
      await db.query('INSERT INTO personnel_halls (personnel_id, hall_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [cleanerIds[i], sh.id]);
    }
  }

  // ─── Animals: Sows in various lifecycle stages ─────────────────────
  const insHalls = hallRows.rows.filter(h => h.sector_code === 'INS');
  const pregHalls = hallRows.rows.filter(h => h.sector_code === 'PREG');
  const farHalls = hallRows.rows.filter(h => h.sector_code === 'FAR');
  const nurHalls = hallRows.rows.filter(h => h.sector_code === 'NUR');
  const finHalls = hallRows.rows.filter(h => h.sector_code === 'FIN');

  const sowStatuses = [
    { status: 'awaiting_breeding', halls: insHalls, count: 15 },
    { status: 'inseminated', halls: insHalls, count: 20 },
    { status: 'pregnant_confirmed', halls: pregHalls, count: 30 },
    { status: 'in_farrowing', halls: farHalls, count: 10 },
    { status: 'lactating', halls: farHalls, count: 25 },
    { status: 'weaned_resting', halls: insHalls, count: 10 }
  ];

  const allSowIds = [];
  let sowTag = 1001;
  const vetIds = personnelIds['zooeng'] || [adminId];
  for (const grp of sowStatuses) {
    for (let i = 0; i < grp.count; i++) {
      const hall = grp.halls[i % grp.halls.length];
      const parity = Math.floor(Math.random() * 6) + 1;
      const dob = new Date(Date.now() - (365 * (1.5 + Math.random() * 4)) * 86400000).toISOString().split('T')[0];
      const res = await db.query(
        `INSERT INTO animals (ear_tag, category, breed, date_of_birth, status, parity_number, current_hall_id, entry_date, notes)
         VALUES ($1, 'sow', 'DanBred', $2, $3, $4, $5, $6, $7) ON CONFLICT (ear_tag) DO NOTHING RETURNING id`,
        [`BG-${String(sowTag++).padStart(5, '0')}`, dob, grp.status, parity, hall.id, dob, `Parity ${parity}`]
      );
      if (res.rows[0]) allSowIds.push({ id: res.rows[0].id, status: grp.status, hall_id: hall.id, parity });
    }
  }

  // Seed 5 boars
  const boarIds = [];
  for (let i = 0; i < 5; i++) {
    const hall = insHalls[i % insHalls.length];
    const dob = new Date(Date.now() - (365 * (2 + Math.random() * 3)) * 86400000).toISOString().split('T')[0];
    const res = await db.query(
      `INSERT INTO animals (ear_tag, category, breed, date_of_birth, status, current_hall_id, entry_date, notes)
       VALUES ($1, 'boar', 'DanBred Duroc', $2, 'active', $3, $4, 'Breeding boar') ON CONFLICT (ear_tag) DO NOTHING RETURNING id`,
      [`BOAR-${String(i + 1).padStart(3, '0')}`, dob, hall.id, dob]
    );
    if (res.rows[0]) boarIds.push(res.rows[0].id);
  }

  // ─── Events: inseminations, pregnancy checks, farrowings ──────────
  const now = Date.now();
  const day = 86400000;
  const eventIds = [];

  // Insemination events for inseminated + pregnant + farrowing + lactating sows
  const inseminatedSows = allSowIds.filter(s => ['inseminated', 'pregnant_confirmed', 'in_farrowing', 'lactating'].includes(s.status));
  for (const sow of inseminatedSows) {
    const daysAgo = sow.status === 'inseminated' ? Math.floor(Math.random() * 20) + 5
      : sow.status === 'pregnant_confirmed' ? Math.floor(Math.random() * 40) + 25
      : sow.status === 'in_farrowing' ? Math.floor(Math.random() * 10) + 105
      : Math.floor(Math.random() * 20) + 115; // lactating
    const eventDate = new Date(now - daysAgo * day).toISOString().split('T')[0];
    const vet = vetIds[Math.floor(Math.random() * vetIds.length)];
    const res = await db.query(
      `INSERT INTO events (event_type, animal_id, hall_id, performed_by, event_date, details)
       VALUES ('insemination', $1, $2, $3, $4, $5) RETURNING id`,
      [sow.id, sow.hall_id, vet, eventDate, JSON.stringify({ boar_id: boarIds[Math.floor(Math.random() * boarIds.length)], method: 'AI', dose: '80ml' })]
    );
    if (res.rows[0]) eventIds.push(res.rows[0].id);
  }

  // Pregnancy check positive events for pregnant_confirmed + farrowing + lactating sows
  const pregSows = allSowIds.filter(s => ['pregnant_confirmed', 'in_farrowing', 'lactating'].includes(s.status));
  for (const sow of pregSows) {
    const daysAgo = sow.status === 'pregnant_confirmed' ? Math.floor(Math.random() * 10) + 5
      : sow.status === 'in_farrowing' ? Math.floor(Math.random() * 10) + 80
      : Math.floor(Math.random() * 10) + 90;
    const eventDate = new Date(now - daysAgo * day).toISOString().split('T')[0];
    const vet = vetIds[Math.floor(Math.random() * vetIds.length)];
    await db.query(
      `INSERT INTO events (event_type, animal_id, hall_id, performed_by, event_date, details)
       VALUES ('pregnancy_check_positive', $1, $2, $3, $4, '{"method":"ultrasound","day":28}')`,
      [sow.id, sow.hall_id, vet, eventDate]
    );
  }

  // Farrowing events + litters for lactating sows
  const lactatingSows = allSowIds.filter(s => s.status === 'lactating');
  const litterIds = [];
  for (const sow of lactatingSows) {
    const daysAgo = Math.floor(Math.random() * 18) + 2; // 2-20 days ago
    const eventDate = new Date(now - daysAgo * day).toISOString().split('T')[0];
    const vet = vetIds[Math.floor(Math.random() * vetIds.length)];
    const bornAlive = Math.floor(Math.random() * 6) + 10; // 10-15
    const stillborn = Math.floor(Math.random() * 3);
    const mummified = Math.floor(Math.random() * 2);
    const fRes = await db.query(
      `INSERT INTO events (event_type, animal_id, hall_id, performed_by, event_date, details)
       VALUES ('farrowing', $1, $2, $3, $4, $5) RETURNING id`,
      [sow.id, sow.hall_id, vet, eventDate, JSON.stringify({ born_alive: bornAlive, stillborn, mummified, duration_hours: (Math.random() * 4 + 2).toFixed(1) })]
    );
    if (fRes.rows[0]) {
      // Simulate weaning for litters older than 10 days (piglets weaned at ~21-28 days)
      const weanedCount = daysAgo >= 10 ? bornAlive - Math.floor(Math.random() * 2) : null;
      const weaningDate = daysAgo >= 10 ? new Date(now - (daysAgo - 10) * day).toISOString().split('T')[0] : null;
      const weaningWeightKg = weanedCount ? Math.round(weanedCount * (5.5 + Math.random() * 1.5) * 100) / 100 : null;
      const lRes = await db.query(
        `INSERT INTO litters (birth_sow_id, farrowing_event_id, parity_number, born_alive, stillborn, mummified, birth_date, weaned_count, weaning_date, weaning_weight_kg)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [sow.id, fRes.rows[0].id, sow.parity, bornAlive, stillborn, mummified, eventDate, weanedCount, weaningDate, weaningWeightKg]
      );
      if (lRes.rows[0]) litterIds.push(lRes.rows[0].id);
    }
  }

  // ─── Historical litters for prior months (Nov 2025 - Jan 2026) for bonus calc ─
  const historicalMonths = [
    { month: '2025-11', daysAgoBase: 100 },
    { month: '2025-12', daysAgoBase: 70 },
    { month: '2026-01', daysAgoBase: 40 }
  ];
  const weanedRestSows = allSowIds.filter(s => s.status === 'weaned_resting');
  const pregConfSows = allSowIds.filter(s => s.status === 'pregnant_confirmed');
  const historicalSows = [...weanedRestSows, ...pregConfSows.slice(0, 15)];
  for (const hm of historicalMonths) {
    const sowsForMonth = historicalSows.slice(0, 8);
    for (let si = 0; si < sowsForMonth.length; si++) {
      const sow = sowsForMonth[si];
      const daysAgo = hm.daysAgoBase + si;
      const birthDate = new Date(now - daysAgo * day).toISOString().split('T')[0];
      const weanDate = new Date(now - (daysAgo - 25) * day).toISOString().split('T')[0];
      const vet = vetIds[si % vetIds.length];
      const bornAlive = Math.floor(Math.random() * 5) + 11;
      const weanedCount = bornAlive - Math.floor(Math.random() * 2);
      const weaningWeightKg = Math.round(weanedCount * (5.8 + Math.random() * 1.2) * 100) / 100;
      await db.query(
        `INSERT INTO litters (birth_sow_id, parity_number, born_alive, stillborn, mummified, birth_date, weaned_count, weaning_date, weaning_weight_kg)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [sow.id, sow.parity, bornAlive, Math.floor(Math.random() * 2), Math.floor(Math.random() * 2), birthDate, weanedCount, weanDate, weaningWeightKg]
      );
    }
  }

  // ─── Animal Groups: weaner + finisher batches ──────────────────────
  const groupData = [
    { name: 'Партида W-2026-01', cat: 'weaner', hall: nurHalls[0]?.id, entry: 180, current: 175, entryW: 7.2, currentW: 18.5, daysAgo: 35, slaughterDays: 0 },
    { name: 'Партида W-2026-02', cat: 'weaner', hall: nurHalls[1]?.id, entry: 200, current: 196, entryW: 6.8, currentW: 12.3, daysAgo: 18, slaughterDays: 0 },
    { name: 'Партида W-2026-03', cat: 'weaner', hall: nurHalls[2]?.id, entry: 160, current: 158, entryW: 7.5, currentW: 8.1, daysAgo: 5, slaughterDays: 0 },
    { name: 'Партида F-2025-08', cat: 'finisher', hall: finHalls[0]?.id, entry: 250, current: 245, entryW: 25, currentW: 85.0, daysAgo: 90, slaughterDays: 30 },
    { name: 'Партида F-2025-09', cat: 'finisher', hall: finHalls[1]?.id, entry: 230, current: 228, entryW: 24, currentW: 72.5, daysAgo: 70, slaughterDays: 50 },
    { name: 'Партида F-2025-10', cat: 'finisher', hall: finHalls[2]?.id, entry: 280, current: 276, entryW: 26, currentW: 58.0, daysAgo: 50, slaughterDays: 70 },
    { name: 'Партида F-2025-11', cat: 'finisher', hall: finHalls[3]?.id, entry: 260, current: 255, entryW: 25, currentW: 42.0, daysAgo: 30, slaughterDays: 90 },
    { name: 'Партида F-2026-01', cat: 'finisher', hall: finHalls[4]?.id, entry: 220, current: 218, entryW: 23, currentW: 30.5, daysAgo: 14, slaughterDays: 106 }
  ];
  const groupIds = [];
  for (const g of groupData) {
    if (!g.hall) continue;
    const entryDate = new Date(now - g.daysAgo * day).toISOString().split('T')[0];
    const slaughterDate = g.slaughterDays > 0 ? new Date(now + g.slaughterDays * day).toISOString().split('T')[0] : null;
    const res = await db.query(
      `INSERT INTO animal_groups (group_name, category, hall_id, entry_date, entry_count, current_count, entry_weight_avg_kg, current_weight_avg_kg, target_slaughter_date, source_litter_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING RETURNING id`,
      [g.name, g.cat, g.hall, entryDate, g.entry, g.current, g.entryW, g.currentW, slaughterDate, JSON.stringify(litterIds.slice(0, 3))]
    );
    if (res.rows[0]) groupIds.push({ id: res.rows[0].id, ...g });
    // Update hall occupancy
    await db.query('UPDATE halls SET current_occupancy = $1 WHERE id = $2', [g.current, g.hall]);
  }

  // Update hall occupancy for sows
  const sowHallCounts = {};
  for (const s of allSowIds) {
    sowHallCounts[s.hall_id] = (sowHallCounts[s.hall_id] || 0) + 1;
  }
  for (const [hid, cnt] of Object.entries(sowHallCounts)) {
    await db.query('UPDATE halls SET current_occupancy = GREATEST(current_occupancy, $1) WHERE id = $2', [cnt, hid]);
  }

  // ─── Sales: recent completed sales ────────────────────────────────
  const buyers = ['Градус АД', 'Тандем ООД', 'Меском ЕООД', 'Родопа Булгарикум', 'Кен ООД'];
  const salesData = [
    { type: 'finisher', buyer: buyers[0], heads: 120, weight: 13200, ppk: 1.85, daysAgo: 5 },
    { type: 'finisher', buyer: buyers[1], heads: 95, weight: 10450, ppk: 1.82, daysAgo: 12 },
    { type: 'finisher', buyer: buyers[2], heads: 150, weight: 16500, ppk: 1.88, daysAgo: 20 },
    { type: 'weaner', buyer: buyers[3], heads: 200, weight: 4800, ppk: 0, daysAgo: 8, pricePerHead: 42 },
    { type: 'culled', buyer: buyers[4], heads: 8, weight: 1520, ppk: 0.95, daysAgo: 15 },
    { type: 'finisher', buyer: buyers[0], heads: 110, weight: 12100, ppk: 1.86, daysAgo: 30 },
    { type: 'finisher', buyer: buyers[1], heads: 200, weight: 22000, ppk: 1.84, daysAgo: 45 },
    { type: 'weaner', buyer: buyers[3], heads: 180, weight: 4320, ppk: 0, daysAgo: 38, pricePerHead: 40 }
  ];
  for (const s of salesData) {
    const saleDate = new Date(now - s.daysAgo * day).toISOString().split('T')[0];
    const monthKey = saleDate.substring(0, 7);
    const total = s.pricePerHead ? s.pricePerHead * s.heads : s.ppk * s.weight;
    const gid = s.type === 'finisher' ? (groupIds.find(g => g.cat === 'finisher')?.id || null) : null;
    await db.query(
      `INSERT INTO sales (sale_date, sale_type, group_id, buyer_name, head_count, total_weight_kg, price_per_kg, price_per_head, total_amount_eur, invoice_number, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [saleDate, s.type, gid, s.buyer, s.heads, s.weight, s.ppk || null, s.pricePerHead || null, Math.round(total * 100) / 100, `INV-${saleDate.replace(/-/g, '')}-${Math.floor(Math.random() * 900) + 100}`, null, adminId]
    );
  }

  // ─── Expense entries: monthly operational expenses ─────────────────
  const months = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02'];
  for (const mk of months) {
    const d = mk + '-15';
    const allSectors = await db.query('SELECT id, code FROM sectors ORDER BY id');
    const expenseItems = [
      { cat: 'utilities', sub: 'electricity', desc: 'Ел. енергия', amount: 4200 + Math.random() * 800, sector: 'FAR' },
      { cat: 'utilities', sub: 'water', desc: 'Водоснабдяване', amount: 1800 + Math.random() * 400, sector: 'FAR' },
      { cat: 'utilities', sub: 'heating', desc: 'Отопление', amount: 2500 + Math.random() * 1500, sector: 'NUR' },
      { cat: 'maintenance', sub: 'equipment', desc: 'Поддръжка оборудване', amount: 800 + Math.random() * 600, sector: 'FIN' },
      { cat: 'maintenance', sub: 'buildings', desc: 'Ремонт сгради', amount: 500 + Math.random() * 1000, sector: 'PREG' },
      { cat: 'transport', sub: 'fuel', desc: 'Гориво транспорт', amount: 3200 + Math.random() * 800, sector: null },
      { cat: 'admin', sub: 'insurance', desc: 'Застраховки', amount: 1500, sector: null },
      { cat: 'admin', sub: 'consulting', desc: 'Ветеринарни консултации', amount: 600 + Math.random() * 400, sector: null }
    ];
    for (const exp of expenseItems) {
      const sId = exp.sector ? allSectors.rows.find(s => s.code === exp.sector)?.id || null : null;
      await db.query(
        `INSERT INTO expense_entries (entry_date, month_key, category, subcategory, description, amount_eur, sector_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [d, mk, exp.cat, exp.sub, exp.desc, Math.round(exp.amount * 100) / 100, sId, adminId]
      );
    }
  }

  // ─── Water consumption readings (last 30 days) ────────────────────
  for (let daysBack = 0; daysBack < 30; daysBack++) {
    const readingDate = new Date(now - daysBack * day).toISOString().split('T')[0];
    // Pick 5 random halls for daily readings
    const sampleHalls = hallRows.rows.sort(() => Math.random() - 0.5).slice(0, 8);
    for (const h of sampleHalls) {
      const animalCount = Math.floor(Math.random() * 200) + 50;
      const litersPerAnimal = 8 + Math.random() * 12; // 8-20 L/animal/day
      const consumption = (animalCount * litersPerAnimal) / 1000; // m³
      await db.query(
        `INSERT INTO water_consumption (hall_id, reading_date, consumption_m3, animal_count, liters_per_animal, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [h.id, readingDate, Math.round(consumption * 100) / 100, animalCount, Math.round(litersPerAnimal * 10) / 10, adminId]
      );
    }
  }

  // ─── KPI snapshots (last 4 months) ────────────────────────────────
  const kpiMonths = ['2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01'];
  const kpiData = [
    { name: 'farrowing_rate', values: [88.5, 87.2, 89.1, 90.3] },
    { name: 'born_alive_avg', values: [13.2, 13.5, 13.1, 13.8] },
    { name: 'weaned_per_sow_year', values: [28.5, 29.0, 28.8, 29.2] },
    { name: 'mortality_pct_nursery', values: [3.2, 2.8, 3.1, 2.5] },
    { name: 'mortality_pct_finishing', values: [1.8, 2.1, 1.5, 1.3] },
    { name: 'fcr_finishing', values: [2.45, 2.38, 2.42, 2.35] },
    { name: 'adg_finishing', values: [820, 835, 828, 845] },
    { name: 'avg_slaughter_weight', values: [110.5, 111.2, 109.8, 112.0] },
    { name: 'feed_cost_per_kg', values: [0.92, 0.89, 0.91, 0.88] },
    { name: 'labour_cost_per_kg', values: [0.15, 0.14, 0.15, 0.14] }
  ];
  for (const kpi of kpiData) {
    for (let i = 0; i < kpiMonths.length; i++) {
      await db.query(
        `INSERT INTO kpi_snapshots (snapshot_date, kpi_name, kpi_value, scope_type)
         VALUES ($1, $2, $3, 'farm') ON CONFLICT DO NOTHING`,
        [kpiMonths[i], kpi.name, kpi.values[i]]
      );
    }
  }

  // ─── Disinfection logs (recent vehicle washes) ────────────────────
  const vehicles = await db.query('SELECT id FROM vehicles LIMIT 5');
  for (const v of vehicles.rows) {
    for (let d = 0; d < 3; d++) {
      const logDate = new Date(now - d * 3 * day).toISOString();
      await db.query(
        `INSERT INTO disinfection_logs (vehicle_id, wash_confirmed, disinfect_confirmed, performed_by, created_at)
         VALUES ($1, true, true, $2, $3)`,
        [v.id, driverIds[d % driverIds.length] || adminId, logDate]
      );
    }
  }

  // ─── Monthly P&L snapshots ────────────────────────────────────────
  for (const mk of months) {
    const rev = 85000 + Math.random() * 30000;
    const feed = 35000 + Math.random() * 8000;
    const salary = 22000 + Math.random() * 3000;
    const vet = 3500 + Math.random() * 1500;
    const other = 8000 + Math.random() * 4000;
    const totalCost = feed + salary + vet + other;
    const profit = rev - totalCost;
    await db.query(
      `INSERT INTO monthly_pnl_snapshots (month_key, revenue_eur, feed_cost_eur, salary_cost_eur, vet_cost_eur, other_cost_eur, total_cost_eur, operating_profit_eur, gross_margin_pct, operating_margin_pct, total_kg_sold, total_heads_sold, cost_per_kg)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (month_key) DO NOTHING`,
      [mk, Math.round(rev), Math.round(feed), Math.round(salary), Math.round(vet), Math.round(other), Math.round(totalCost), Math.round(profit),
       Math.round((rev - feed) / rev * 10000) / 100, Math.round(profit / rev * 10000) / 100,
       Math.floor(rev / 1.85), Math.floor(rev / 1.85 / 110), Math.round(totalCost / (rev / 1.85) * 100) / 100]
    );
  }

  // ─── Alerts: sample alerts for demo ──────────────────────────────
  const alertsData = [
    { severity: 'critical', category: 'water', message: 'Спад на водна консумация >15% в РОД-3 за последните 24ч — възможен PRRS/грип', entity_type: 'hall', entity_id: farHalls[2]?.id, threshold: 'water_drop_pct', thresholdVal: 18.5, targetVal: 15 },
    { severity: 'critical', category: 'mortality', message: 'Смъртност >12% в първите 48ч в РОД-1 — проверете микроклимат и колострум', entity_type: 'hall', entity_id: farHalls[0]?.id, threshold: 'mortality_48h_pct', thresholdVal: 14.2, targetVal: 12 },
    { severity: 'warning', category: 'reproduction', message: 'Средно живородени < 10 за последните 5 раждания в РОД-5', entity_type: 'hall', entity_id: farHalls[4]?.id, threshold: 'born_alive_avg', thresholdVal: 9.4, targetVal: 10 },
    { severity: 'warning', category: 'feed', message: 'FCR > 2.80 в УГОЯ-2 — проверете качеството на фуража', entity_type: 'hall', entity_id: finHalls[1]?.id, threshold: 'fcr_finishing', thresholdVal: 2.92, targetVal: 2.80 },
    { severity: 'warning', category: 'inventory', message: 'Рибно брашно под минимален запас (200 кг) — текущо: 180 кг', entity_type: 'feed_component', entity_id: cid('Fish Meal'), threshold: 'stock_kg', thresholdVal: 180, targetVal: 200 },
    { severity: 'info', category: 'reproduction', message: 'Тегло при отбиване < 5.2 кг за партида W-2026-03 — проверете млечност на майки', entity_type: 'animal_group', entity_id: groupIds[2]?.id, threshold: 'weaning_weight_kg', thresholdVal: 4.8, targetVal: 5.2 },
    { severity: 'info', category: 'logistics', message: 'Силоз УГОЯ-4 под 20% — планирайте зареждане', entity_type: 'silo', entity_id: null, threshold: 'silo_level_pct', thresholdVal: 15, targetVal: 20 },
    { severity: 'critical', category: 'biosecurity', message: '48ч правило нарушено: Тодор Михайлов опита достъп до РОД-2 след посещение на УГОЯ-1', entity_type: 'personnel', entity_id: farmWorkerIds[0], threshold: '48h_rule', thresholdVal: 1, targetVal: 0 }
  ];
  for (let i = 0; i < alertsData.length; i++) {
    const a = alertsData[i];
    const hoursAgo = i < 3 ? Math.floor(Math.random() * 6) + 1 : Math.floor(Math.random() * 48) + 6;
    const isAck = i >= 5; // last 3 are acknowledged
    await db.query(
      `INSERT INTO alerts (severity, category, message, related_entity_type, related_entity_id, threshold_name, threshold_value, target_value, is_acknowledged, acknowledged_by, acknowledged_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW() - INTERVAL '${hoursAgo} hours')`,
      [a.severity, a.category, a.message, a.entity_type, a.entity_id || null, a.threshold, a.thresholdVal, a.targetVal,
       isAck, isAck ? adminId : null, isAck ? new Date(now - hoursAgo * 3600000 + 1800000).toISOString() : null]
    );
  }

  // ─── Dispatch orders: sample expeditions ────────────────────────
  const allVehicles = await db.query('SELECT id, vehicle_type FROM vehicles ORDER BY id');
  const livestockVehicle = allVehicles.rows.find(v => v.vehicle_type === 'livestock_transport');
  const feedTrucks = allVehicles.rows.filter(v => v.vehicle_type === 'feed_truck');

  const dispatchData = [
    { group: groupIds.find(g => g.cat === 'finisher' && g.name.includes('F-2025-08')), status: 'proposed', daysFromNow: 30, heads: 120, buyer: 'Градус АД', dest: 'Кланица Градус, Стара Загора', auto: true },
    { group: groupIds.find(g => g.cat === 'finisher' && g.name.includes('F-2025-08')), status: 'confirmed', daysFromNow: 32, heads: 125, buyer: 'Тандем ООД', dest: 'Кланица Тандем, Пловдив', auto: false },
    { group: groupIds.find(g => g.cat === 'finisher' && g.name.includes('F-2025-09')), status: 'proposed', daysFromNow: 50, heads: 228, buyer: 'Меском ЕООД', dest: 'Кланица Меском, Бургас', auto: true },
    { group: groupIds.find(g => g.cat === 'finisher' && g.name.includes('F-2025-09')), status: 'delivered', daysFromNow: -10, heads: 100, buyer: 'Градус АД', dest: 'Кланица Градус, Стара Загора', auto: false, weightLoad: 11000, weightDest: 10780 }
  ];
  for (const d of dispatchData) {
    if (!d.group) continue;
    const dispDate = new Date(now + d.daysFromNow * day).toISOString().split('T')[0];
    await db.query(
      `INSERT INTO dispatch_orders (group_id, dispatch_date, buyer_name, destination, vehicle_id, driver_id, head_count, weight_at_loading_kg, weight_at_destination_kg, shrinkage_pct, status, auto_generated, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [d.group.id, dispDate, d.buyer, d.dest,
       livestockVehicle?.id || null, driverIds[0] || null, d.heads,
       d.weightLoad || null, d.weightDest || null,
       d.weightLoad && d.weightDest ? Math.round((d.weightLoad - d.weightDest) / d.weightLoad * 10000) / 100 : null,
       d.status, d.auto, adminId]
    );
  }

  // ─── Active withdrawals: medicines with active carency ──────────
  const withdrawalSeedData = [
    { groupIdx: 0, medicine: 'Amoxicillin', daysAgo: 5 },   // 14 day rule → 9 days left
    { groupIdx: 3, medicine: 'Ivermectin', daysAgo: 10 },    // 21 day rule → 11 days left
    { groupIdx: 1, medicine: 'Enrofloxacin', daysAgo: 3 }    // 10 day rule → 7 days left
  ];
  for (const ws of withdrawalSeedData) {
    const grp = groupIds[ws.groupIdx];
    const medId = mid(ws.medicine);
    const rule = withdrawalRules.find(r => r.medicine === ws.medicine);
    if (!grp || !medId || !rule) continue;
    const startDate = new Date(now - ws.daysAgo * day).toISOString().split('T')[0];
    const endDate = new Date(now + (rule.days - ws.daysAgo) * day).toISOString().split('T')[0];
    await db.query(
      `INSERT INTO active_withdrawals (group_id, medicine_id, start_date, end_date, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [grp.id, medId, startDate, endDate]
    );
  }

  // ─── Delivery routes + stops ────────────────────────────────────
  const allSilos = await db.query('SELECT s.id, s.hall_id, s.silo_name, h.name as hall_name FROM silos s JOIN halls h ON h.id = s.hall_id ORDER BY s.id');
  const routesData = [
    { status: 'completed', daysAgo: 2, vehicleIdx: 0, driverIdx: 0, tons: 8.5, kmStart: 15200, kmEnd: 15280, stops: [
      { siloIdx: 18, tons: 2.5, delivered: 2.5, status: 'delivered' },
      { siloIdx: 19, tons: 3.0, delivered: 3.0, status: 'delivered' },
      { siloIdx: 20, tons: 3.0, delivered: 3.0, status: 'delivered' }
    ]},
    { status: 'in_progress', daysAgo: 0, vehicleIdx: 1, driverIdx: 1, tons: 10.0, kmStart: 22100, kmEnd: null, stops: [
      { siloIdx: 21, tons: 3.5, delivered: 3.5, status: 'delivered' },
      { siloIdx: 22, tons: 3.5, delivered: null, status: 'pending' },
      { siloIdx: 23, tons: 3.0, delivered: null, status: 'pending' }
    ]},
    { status: 'planned', daysAgo: -1, vehicleIdx: 2, driverIdx: 2, tons: 7.0, kmStart: null, kmEnd: null, stops: [
      { siloIdx: 0, tons: 2.0, delivered: null, status: 'pending' },
      { siloIdx: 1, tons: 2.5, delivered: null, status: 'pending' },
      { siloIdx: 2, tons: 2.5, delivered: null, status: 'pending' }
    ]}
  ];
  for (const route of routesData) {
    const routeDate = new Date(now - route.daysAgo * day).toISOString().split('T')[0];
    const vId = feedTrucks[route.vehicleIdx]?.id;
    const drId = driverIds[route.driverIdx];
    if (!vId || !drId) continue;
    const rRes = await db.query(
      `INSERT INTO delivery_routes (route_date, vehicle_id, driver_id, status, total_tons, started_at, completed_at, km_start, km_end, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [routeDate, vId, drId, route.status, route.tons,
       route.status !== 'planned' ? new Date(now - route.daysAgo * day + 6 * 3600000).toISOString() : null,
       route.status === 'completed' ? new Date(now - route.daysAgo * day + 10 * 3600000).toISOString() : null,
       route.kmStart, route.kmEnd, adminId]
    );
    if (rRes.rows[0]) {
      for (let si = 0; si < route.stops.length; si++) {
        const stop = route.stops[si];
        const silo = allSilos.rows[stop.siloIdx];
        if (!silo) continue;
        await db.query(
          `INSERT INTO delivery_stops (route_id, stop_order, silo_id, planned_tons, delivered_tons, status, delivered_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [rRes.rows[0].id, si + 1, silo.id, stop.tons, stop.delivered,
           stop.status, stop.status === 'delivered' ? new Date(now - route.daysAgo * day + (7 + si) * 3600000).toISOString() : null]
        );
      }
    }
  }

  // ─── Access logs: rich data for heatmap ─────────────────────────
  const allPersonnelRes = await db.query("SELECT id, role FROM personnel WHERE role IN ('farm_worker', 'zooeng', 'production_manager', 'cleaner') ORDER BY id");
  const accessPersonnel = allPersonnelRes.rows;
  for (let dBack = 0; dBack < 7; dBack++) {
    for (const person of accessPersonnel) {
      // Each person enters 2-4 halls per day
      const numEntries = Math.floor(Math.random() * 3) + 2;
      const shuffledHalls = [...hallRows.rows].sort(() => Math.random() - 0.5);
      for (let e = 0; e < numEntries && e < shuffledHalls.length; e++) {
        const h = shuffledHalls[e];
        const hour = 6 + Math.floor(Math.random() * 10); // 6:00-16:00
        const entryTime = new Date(now - dBack * day + hour * 3600000);
        await db.query(
          `INSERT INTO access_logs (personnel_id, hall_id, action, zone, sector_code, method, shower_confirmed, created_at)
           VALUES ($1, $2, 'entry', $3, $4, 'manual', $5, $6) ON CONFLICT DO NOTHING`,
          [person.id, h.id, 'black', h.sector_code, h.sector_code === 'FAR', entryTime.toISOString()]
        );
      }
    }
  }

  // ─── Biosecurity violations ─────────────────────────────────────
  const violationsData = [
    { personIdx: 0, sourceHall: finHalls[0], targetHall: farHalls[1], type: '48h_rule', severity: 'critical', desc: 'Влизане в РОД-2 по-малко от 48ч след посещение на УГОЯ-1. Необходима дезинфекция.', resolved: false, daysAgo: 0 },
    { personIdx: 2, sourceHall: finHalls[2], targetHall: farHalls[3], type: '48h_rule', severity: 'critical', desc: 'Влизане в РОД-4 по-малко от 48ч след посещение на УГОЯ-3. Override разрешен от управител.', resolved: false, overridden: true, daysAgo: 1 },
    { personIdx: 4, sourceHall: finHalls[1], targetHall: farHalls[0], type: '48h_rule', severity: 'critical', desc: 'Влизане в РОД-1 по-малко от 48ч след посещение на УГОЯ-2.', resolved: true, daysAgo: 3 },
    { personIdx: 1, sourceHall: finHalls[3], targetHall: farHalls[5], type: '48h_rule', severity: 'critical', desc: 'Влизане в РОД-6 по-малко от 48ч след посещение на УГОЯ-4.', resolved: true, daysAgo: 5 }
  ];
  for (const v of violationsData) {
    const pId = farmWorkerIds[v.personIdx];
    if (!pId || !v.sourceHall || !v.targetHall) continue;
    await db.query(
      `INSERT INTO biosecurity_violations (personnel_id, violation_type, source_hall_id, target_hall_id, severity, description, is_overridden, is_resolved, resolved_by, resolved_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW() - INTERVAL '${v.daysAgo} days')`,
      [pId, v.type, v.sourceHall.id, v.targetHall.id, v.severity, v.desc,
       v.overridden || false, v.resolved, v.resolved ? adminId : null,
       v.resolved ? new Date(now - (v.daysAgo - 1) * day).toISOString() : null]
    );
  }

  // ─── Bonus calculations: pre-calculated for recent months ───────
  const bonusRulesRes = await db.query('SELECT * FROM bonus_rules ORDER BY id');
  const salaryRes = await db.query('SELECT * FROM salary_templates ORDER BY id');
  const bonusMonths = ['2025-12', '2026-01', '2026-02'];
  const bonusKPIValues = {
    'survival_farrowing': [11.5, 10.8, 9.5],  // mortality % — lower is better, target < 12
    'weaning_weight': [6.2, 6.4, 6.5],         // kg — higher is better, target > 6.0
    'fcr_finishing': [2.38, 2.42, 2.35]         // ratio — lower is better, target < 2.40
  };
  for (let mi = 0; mi < bonusMonths.length; mi++) {
    const mk = bonusMonths[mi];
    for (const rule of bonusRulesRes.rows) {
      const kpiVal = bonusKPIValues[rule.kpi_name]?.[mi];
      if (kpiVal === undefined) continue;
      const targetMet = rule.operator === 'lt' ? kpiVal < parseFloat(rule.target_value) : kpiVal > parseFloat(rule.target_value);
      // Find eligible personnel for this sector
      const sectorHalls = hallRows.rows.filter(h => h.sector_code === rule.applies_to_sector_code);
      const eligibleRes = await db.query(
        `SELECT DISTINCT ph.personnel_id FROM personnel_halls ph
         JOIN personnel p ON p.id = ph.personnel_id
         WHERE ph.hall_id = ANY($1) AND p.is_active = true`,
        [sectorHalls.map(h => h.id)]
      );
      for (const ep of eligibleRes.rows) {
        const salary = salaryRes.rows.find(s => s.role === 'farm_worker') || salaryRes.rows[0];
        const bonusAmt = targetMet ? Math.round(parseFloat(salary.base_salary_eur) * parseFloat(rule.bonus_pct) / 100 * 100) / 100 : 0;
        const status = mi < 2 ? 'approved' : 'calculated'; // older months approved, current month calculated
        await db.query(
          `INSERT INTO bonus_calculations (month_key, personnel_id, bonus_rule_id, kpi_actual_value, target_value, target_met, base_salary_eur, bonus_pct, bonus_amount_eur, status, approved_by, approved_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [mk, ep.personnel_id, rule.id, kpiVal, rule.target_value, targetMet,
           salary.base_salary_eur, rule.bonus_pct, bonusAmt, status,
           status === 'approved' ? adminId : null,
           status === 'approved' ? new Date(now - (2 - mi) * 30 * day).toISOString() : null]
        );
      }
    }
  }

  // ─── Hall hygiene pauses ────────────────────────────────────────
  // 1 completed pause, 1 active pause
  if (farHalls[5]) {
    await db.query(
      `INSERT INTO hall_hygiene_pauses (hall_id, required_days, cleaning_confirmed, cleaning_confirmed_at, cleaning_confirmed_by, disinfection_confirmed, disinfection_confirmed_at, disinfection_confirmed_by, status, ready_date, completed_at, completed_by, start_date)
       VALUES ($1, 5, true, NOW() - INTERVAL '8 days', $2, true, NOW() - INTERVAL '7 days', $2, 'ready', (CURRENT_DATE - INTERVAL '6 days')::date, NOW() - INTERVAL '6 days', $2, (CURRENT_DATE - INTERVAL '12 days')::date)`,
      [farHalls[5].id, adminId]
    );
  }
  if (nurHalls[3]) {
    await db.query(
      `INSERT INTO hall_hygiene_pauses (hall_id, required_days, cleaning_confirmed, cleaning_confirmed_at, cleaning_confirmed_by, disinfection_confirmed, status, ready_date, start_date)
       VALUES ($1, 5, true, NOW() - INTERVAL '1 day', $2, false, 'cleaning_done', (CURRENT_DATE + INTERVAL '3 days')::date, (CURRENT_DATE - INTERVAL '2 days')::date)`,
      [nurHalls[3].id, adminId]
    );
  }

  // ─── Traceability records ───────────────────────────────────────
  for (let ti = 0; ti < Math.min(3, groupIds.length); ti++) {
    const grp = groupIds[ti];
    if (!grp) continue;
    const traceData = {
      batch: { group_name: grp.name, hall: 'N/A', sector: grp.cat === 'finisher' ? 'FIN' : 'NUR', entry_date: new Date(now - grp.daysAgo * day).toISOString().split('T')[0], entry_count: grp.entry, entry_weight: grp.entryW, current_count: grp.current, current_weight: grp.currentW },
      genetics: litterIds.slice(0, 2).map((lid, i) => ({ litter_id: lid, sow_ear_tag: `BG-${String(1001 + i).padStart(5, '0')}`, breed: 'DanBred', parity: 3, born_alive: 13, birth_date: new Date(now - 90 * day).toISOString().split('T')[0] })),
      feed: { recipe: grp.cat === 'finisher' ? 'Финишер (Угояване)' : 'Стартер (7-12 кг)', cost_per_ton: grp.cat === 'finisher' ? 315 : 950 },
      vetEvents: [{ type: 'vaccination', date: new Date(now - (grp.daysAgo - 3) * day).toISOString().split('T')[0], performed_by: 'Д-р Калина Петрова', details: { vaccine: 'PCV2', dose: '2ml' } }],
      withdrawals: [],
      generated_at: new Date().toISOString()
    };
    await db.query(
      `INSERT INTO traceability_records (group_id, data, generated_by) VALUES ($1, $2, $3) ON CONFLICT (group_id) DO NOTHING`,
      [grp.id, JSON.stringify(traceData), adminId]
    );
  }

  // ─── Regulatory documents ───────────────────────────────────────
  const regDocs = [
    { type: 'diary_no1', ref: 'DNV-2026-0001', title: 'Дневник №1 — Януари 2026', from: '2026-01-01', to: '2026-01-31', status: 'finalized',
      data: { vaccinations: [{ event_date: '2026-01-10', hall_name: 'РОД-1', details: { vaccine: 'PCV2' }, performed_by: 'Д-р Калина Петрова' }], disinfections: [{ disinfection_date: '2026-01-05', plate_number: 'CB1234AB', wash_confirmed: true, disinfect_confirmed: true }], mortality: [], treatments: [{ event_date: '2026-01-15', hall_name: 'ПОДР-2', details: { medicine: 'Amoxicillin', dose: '5ml' }, performed_by: 'Д-р Пламен Стефанов' }], transfers: [], totals: { vaccinations: 1, disinfections: 1, mortality: 0, treatments: 1, transfers: 0 } } },
    { type: 'animal_register', ref: 'REG-2026-0001', title: 'ИАСРЖ Регистър — Януари 2026', from: '2026-01-01', to: '2026-01-31', status: 'submitted',
      data: { initial: { gilt: 0, sow: 108, boar: 5, weaner: 540, finisher: 1240 }, final: { gilt: 0, sow: 110, boar: 5, weaner: 534, finisher: 1222 }, movements: { born: 325, sold: 475, died: 12, culled: 8 }, balance: { initial_total: 1893, final_total: 1871 } } },
    { type: 'diary_no1', ref: 'DNV-2026-0002', title: 'Дневник №1 — Февруари 2026', from: '2026-02-01', to: '2026-02-28', status: 'draft',
      data: { vaccinations: [{ event_date: '2026-02-05', hall_name: 'ПОДР-1', details: { vaccine: 'Mycoplasma' }, performed_by: 'Д-р Росица Вълчева' }], disinfections: [{ disinfection_date: '2026-02-10', plate_number: 'CB5678CD', wash_confirmed: true, disinfect_confirmed: true }], mortality: [{ event_date: '2026-02-12', hall_name: 'ПОДР-3', category: 'weaner', details: { cause: 'respiratory', count: 2 } }], treatments: [], transfers: [], totals: { vaccinations: 1, disinfections: 1, mortality: 1, treatments: 0, transfers: 0 } } }
  ];
  for (const doc of regDocs) {
    await db.query(
      `INSERT INTO regulatory_documents (document_type, reference_number, title, period_from, period_to, data, status, generated_by, generated_at, finalized_by, finalized_at, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10, $11) ON CONFLICT (reference_number) DO NOTHING`,
      [doc.type, doc.ref, doc.title, doc.from, doc.to, JSON.stringify(doc.data), doc.status, adminId,
       doc.status !== 'draft' ? adminId : null,
       doc.status !== 'draft' ? new Date(now - 10 * day).toISOString() : null,
       doc.status === 'submitted' ? new Date(now - 5 * day).toISOString() : null]
    );
  }

  // ─── Feed production batches ────────────────────────────────────
  const allRecipesForBatch = await db.query('SELECT id, name FROM feed_recipes ORDER BY id');
  const batchData = [
    { recipeIdx: 0, daysAgo: 3, tons: 5.0 },   // Lactating Sows
    { recipeIdx: 1, daysAgo: 5, tons: 8.0 },   // Pregnant Sows
    { recipeIdx: 2, daysAgo: 2, tons: 3.0 },   // Starter
    { recipeIdx: 3, daysAgo: 1, tons: 12.0 },  // Finisher
    { recipeIdx: 3, daysAgo: 7, tons: 10.0 },  // Finisher
    { recipeIdx: 0, daysAgo: 10, tons: 5.5 },  // Lactating Sows
    { recipeIdx: 1, daysAgo: 12, tons: 7.0 },  // Pregnant Sows
    { recipeIdx: 3, daysAgo: 14, tons: 11.0 }  // Finisher
  ];
  for (const b of batchData) {
    const recipe = allRecipesForBatch.rows[b.recipeIdx];
    if (!recipe) continue;
    const batchDate = new Date(now - b.daysAgo * day).toISOString().split('T')[0];
    await db.query(
      `INSERT INTO feed_production_batches (recipe_id, batch_date, quantity_tons, produced_by, deduction_confirmed, notes)
       VALUES ($1, $2, $3, $4, true, $5)`,
      [recipe.id, batchDate, b.tons, adminId, `Производство ${recipe.name} — ${b.tons}т`]
    );
  }

  // ─── Inventory counts (2 full counts) ───────────────────────────
  const invDates = [new Date(now - 15 * day).toISOString().split('T')[0], new Date(now - 45 * day).toISOString().split('T')[0]];
  for (const invDate of invDates) {
    for (const comp of allComps.rows) {
      const theoretical = parseFloat(comp.current_stock_kg);
      const variancePct = (Math.random() * 6 - 3); // -3% to +3%
      const counted = Math.round(theoretical * (1 + variancePct / 100));
      const variance = counted - theoretical;
      await db.query(
        `INSERT INTO inventory_counts (count_date, component_id, counted_kg, theoretical_kg, variance_kg, variance_pct, counted_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
        [invDate, comp.id, counted, theoretical, Math.round(variance), Math.round(variancePct * 100) / 100, adminId]
      );
    }
  }

  return ok({ message: 'Seed data заредени: 5 сектора, 25 халета, 15 суровини, 4 рецепти, 6 шаблона заплати, 10 медикамента, 10 карентни правила, 3 бонус правила, 7 шофьори + 22 персонал (всички роли), 8 МПС, 25 силоза, 110 свине майки + 5 нерези, 8 партиди животни, 8 продажби, 40 разходи, 240 водни отчети, 40 KPI, 5 P&L, 8 аларми, 4 експедиции, 3 карентни срока, 3 маршрута, ~100 access logs, 4 нарушения биосигурност, бонус изчисления (3 мес.), 2 хигиенни паузи, 3 проследимости, 3 рег. документа, 8 партиди фураж, 30 инвентаризации, 1 admin (admin@ajaxerp.com / admin123)' });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: SALES
// ═══════════════════════════════════════════════════════════════════════════

async function salesRecord(db, { sale_date, sale_type, group_id, animal_id, buyer_name, head_count, total_weight_kg, price_per_kg, price_per_head, total_amount_eur, invoice_number, notes, created_by }) {
  const validTypes = ['finisher', 'weaner', 'culled'];
  if (!validTypes.includes(sale_type)) return err(400, `Невалиден тип продажба. Валидни: ${validTypes.join(', ')}`);

  // Calculate total if not provided
  let total = total_amount_eur;
  if (!total) {
    if (sale_type === 'weaner' && price_per_head && head_count) {
      total = price_per_head * head_count;
    } else if (price_per_kg && total_weight_kg) {
      total = price_per_kg * total_weight_kg;
    } else {
      return err(400, 'Необходима е обща сума или цена и количество за изчисляване');
    }
  }
  total = Math.round(total * 100) / 100;

  // Validate culled animal
  if (sale_type === 'culled' && animal_id) {
    const animalRes = await db.query('SELECT status, ear_tag FROM animals WHERE id = $1', [animal_id]);
    if (animalRes.rows.length === 0) return err(404, 'Животното не е намерено');
    if (animalRes.rows[0].status !== 'culled') return err(400, `Животното ${animalRes.rows[0].ear_tag} не е бракувано (статус: ${animalRes.rows[0].status})`);
  }

  const saleDate = sale_date || new Date().toISOString().split('T')[0];
  const result = await db.query(
    `INSERT INTO sales (sale_date, sale_type, group_id, animal_id, buyer_name, head_count, total_weight_kg, price_per_kg, price_per_head, total_amount_eur, invoice_number, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    [saleDate, sale_type, group_id || null, animal_id || null, buyer_name || null,
     head_count || 0, total_weight_kg || null, price_per_kg || null, price_per_head || null,
     total, invoice_number || null, notes || null, created_by || null]
  );

  // Update animal group if finisher sale
  if (sale_type === 'finisher' && group_id && head_count) {
    await db.query(
      `UPDATE animal_groups SET exit_date = $1, exit_count = $2, exit_weight_avg_kg = $3 WHERE id = $4`,
      [saleDate, head_count, total_weight_kg && head_count ? Math.round(total_weight_kg / head_count * 100) / 100 : null, group_id]
    );
  }

  return ok({ sale: result.rows[0] });
}

async function salesList(db, { sale_type, from_date, to_date, limit, offset }) {
  let q = `SELECT s.*, g.group_name, a.ear_tag, p.name as created_by_name
           FROM sales s
           LEFT JOIN animal_groups g ON g.id = s.group_id
           LEFT JOIN animals a ON a.id = s.animal_id
           LEFT JOIN personnel p ON p.id = s.created_by
           WHERE 1=1`;
  const params = [];
  let idx = 1;
  if (sale_type) { q += ` AND s.sale_type = $${idx++}`; params.push(sale_type); }
  if (from_date) { q += ` AND s.sale_date >= $${idx++}`; params.push(from_date); }
  if (to_date) { q += ` AND s.sale_date <= $${idx++}`; params.push(to_date); }
  q += ' ORDER BY s.sale_date DESC, s.id DESC';
  q += ` LIMIT $${idx++}`; params.push(limit || 100);
  q += ` OFFSET $${idx++}`; params.push(offset || 0);
  const result = await db.query(q, params);
  return ok({ sales: result.rows });
}

async function salesGet(db, { id }) {
  if (!id) return err(400, 'ID е задължително');
  const result = await db.query(
    `SELECT s.*, g.group_name, a.ear_tag, p.name as created_by_name
     FROM sales s LEFT JOIN animal_groups g ON g.id = s.group_id
     LEFT JOIN animals a ON a.id = s.animal_id LEFT JOIN personnel p ON p.id = s.created_by
     WHERE s.id = $1`, [id]);
  if (result.rows.length === 0) return err(404, 'Продажбата не е намерена');
  return ok({ sale: result.rows[0] });
}

async function salesSummary(db, { from_date, to_date, group_by }) {
  const fd = from_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const td = to_date || new Date().toISOString().split('T')[0];

  // Overall summary
  const overall = await db.query(
    `SELECT sale_type, COUNT(*) as sale_count, SUM(head_count) as total_heads,
            SUM(total_weight_kg) as total_kg, SUM(total_amount_eur) as total_eur,
            AVG(price_per_kg) as avg_price_per_kg
     FROM sales WHERE sale_date >= $1 AND sale_date <= $2
     GROUP BY sale_type ORDER BY sale_type`, [fd, td]);

  // Total
  const total = await db.query(
    `SELECT COUNT(*) as sale_count, SUM(head_count) as total_heads,
            SUM(total_weight_kg) as total_kg, SUM(total_amount_eur) as total_eur
     FROM sales WHERE sale_date >= $1 AND sale_date <= $2`, [fd, td]);

  // Monthly trend
  const monthly = await db.query(
    `SELECT TO_CHAR(sale_date, 'YYYY-MM') as month, SUM(total_amount_eur) as revenue,
            SUM(head_count) as heads, SUM(total_weight_kg) as kg
     FROM sales WHERE sale_date >= $1 AND sale_date <= $2
     GROUP BY TO_CHAR(sale_date, 'YYYY-MM') ORDER BY month`, [fd, td]);

  return ok({ summary: { from: fd, to: td, byType: overall.rows, total: total.rows[0], monthly: monthly.rows } });
}

async function salesDelete(db, { id }) {
  if (!id) return err(400, 'ID е задължително');
  const result = await db.query('DELETE FROM sales WHERE id = $1 RETURNING *', [id]);
  if (result.rows.length === 0) return err(404, 'Продажбата не е намерена');
  return ok({ deleted: result.rows[0] });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: EXPENSES
// ═══════════════════════════════════════════════════════════════════════════

async function expensesRecord(db, { entry_date, category, subcategory, description, amount_eur, sector_id, hall_id, related_entity_type, related_entity_id, notes, created_by }) {
  const validCats = ['feed', 'salary', 'veterinary', 'other'];
  if (!validCats.includes(category)) return err(400, `Невалидна категория. Валидни: ${validCats.join(', ')}`);
  if (!amount_eur || amount_eur <= 0) return err(400, 'Сумата трябва да е положително число');

  const eDate = entry_date || new Date().toISOString().split('T')[0];
  const monthKey = eDate.substring(0, 7);

  const result = await db.query(
    `INSERT INTO expense_entries (entry_date, month_key, category, subcategory, description, amount_eur, sector_id, hall_id, related_entity_type, related_entity_id, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [eDate, monthKey, category, subcategory || null, description || null,
     Math.round(amount_eur * 100) / 100, sector_id || null, hall_id || null,
     related_entity_type || null, related_entity_id || null, notes || null, created_by || null]
  );
  return ok({ expense: result.rows[0] });
}

async function expensesList(db, { category, from_date, to_date, sector_id, month_key, limit, offset }) {
  let q = `SELECT e.*, s.name as sector_name, h.name as hall_name, p.name as created_by_name
           FROM expense_entries e
           LEFT JOIN sectors s ON s.id = e.sector_id
           LEFT JOIN halls h ON h.id = e.hall_id
           LEFT JOIN personnel p ON p.id = e.created_by
           WHERE 1=1`;
  const params = [];
  let idx = 1;
  if (category) { q += ` AND e.category = $${idx++}`; params.push(category); }
  if (from_date) { q += ` AND e.entry_date >= $${idx++}`; params.push(from_date); }
  if (to_date) { q += ` AND e.entry_date <= $${idx++}`; params.push(to_date); }
  if (sector_id) { q += ` AND e.sector_id = $${idx++}`; params.push(sector_id); }
  if (month_key) { q += ` AND e.month_key = $${idx++}`; params.push(month_key); }
  q += ' ORDER BY e.entry_date DESC, e.id DESC';
  q += ` LIMIT $${idx++}`; params.push(limit || 100);
  q += ` OFFSET $${idx++}`; params.push(offset || 0);
  const result = await db.query(q, params);
  return ok({ expenses: result.rows });
}

async function expensesSummary(db, { from_date, to_date, group_by }) {
  const fd = from_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const td = to_date || new Date().toISOString().split('T')[0];

  const byCategory = await db.query(
    `SELECT category, COUNT(*) as entry_count, SUM(amount_eur) as total_eur
     FROM expense_entries WHERE entry_date >= $1 AND entry_date <= $2
     GROUP BY category ORDER BY category`, [fd, td]);

  const bySector = await db.query(
    `SELECT s.name as sector_name, e.category, SUM(e.amount_eur) as total_eur
     FROM expense_entries e LEFT JOIN sectors s ON s.id = e.sector_id
     WHERE e.entry_date >= $1 AND e.entry_date <= $2
     GROUP BY s.name, e.category ORDER BY s.name, e.category`, [fd, td]);

  const monthly = await db.query(
    `SELECT month_key, category, SUM(amount_eur) as total_eur
     FROM expense_entries WHERE entry_date >= $1 AND entry_date <= $2
     GROUP BY month_key, category ORDER BY month_key, category`, [fd, td]);

  const total = await db.query(
    `SELECT SUM(amount_eur) as total_eur FROM expense_entries WHERE entry_date >= $1 AND entry_date <= $2`, [fd, td]);

  return ok({ summary: { from: fd, to: td, byCategory: byCategory.rows, bySector: bySector.rows, monthly: monthly.rows, total: parseFloat(total.rows[0]?.total_eur || 0) } });
}

async function expensesDelete(db, { id }) {
  if (!id) return err(400, 'ID е задължително');
  const result = await db.query('DELETE FROM expense_entries WHERE id = $1 RETURNING *', [id]);
  if (result.rows.length === 0) return err(404, 'Разходът не е намерен');
  return ok({ deleted: result.rows[0] });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: SALARY
// ═══════════════════════════════════════════════════════════════════════════

async function salaryTemplatesList(db) {
  const result = await db.query('SELECT * FROM salary_templates ORDER BY base_salary_eur DESC');
  return ok({ templates: result.rows });
}

async function salaryTemplatesUpsert(db, { role, base_salary_eur }) {
  if (!role || !base_salary_eur) return err(400, 'Роля и базова заплата са задължителни');
  const result = await db.query(
    `INSERT INTO salary_templates (role, base_salary_eur) VALUES ($1, $2)
     ON CONFLICT (role) DO UPDATE SET base_salary_eur = $2, updated_at = NOW() RETURNING *`,
    [role, base_salary_eur]
  );
  return ok({ template: result.rows[0] });
}

async function salaryGenerate(db, { month_key, override }) {
  if (!month_key || !/^\d{4}-\d{2}$/.test(month_key)) return err(400, 'month_key трябва да е във формат YYYY-MM');

  // Check for existing salary entries this month
  const existing = await db.query(
    `SELECT COUNT(*) FROM expense_entries WHERE month_key = $1 AND category = 'salary' AND subcategory = 'base'`, [month_key]);
  if (parseInt(existing.rows[0].count) > 0 && !override) {
    return err(400, `Заплатите за ${month_key} вече са генерирани (${existing.rows[0].count} записа). Използвайте override=true за повторно генериране.`);
  }

  // If override, delete existing
  if (override) {
    await db.query(`DELETE FROM expense_entries WHERE month_key = $1 AND category = 'salary' AND subcategory = 'base'`, [month_key]);
  }

  // Get active personnel with salary templates
  const personnel = await db.query(
    `SELECT p.id, p.name, p.role, COALESCE(st.base_salary_eur, 0) as salary
     FROM personnel p
     LEFT JOIN salary_templates st ON st.role = p.role AND st.is_active = true
     WHERE p.is_active = true`
  );

  const entryDate = `${month_key}-01`;
  let totalGenerated = 0;
  let totalAmount = 0;

  for (const p of personnel.rows) {
    if (p.salary <= 0) continue;

    // Get halls assigned to this person for sector attribution
    const hallsRes = await db.query(
      `SELECT h.sector_id FROM personnel_halls ph JOIN halls h ON h.id = ph.hall_id WHERE ph.personnel_id = $1`, [p.id]);
    const sectorId = hallsRes.rows.length > 0 ? hallsRes.rows[0].sector_id : null;

    // If multiple halls in different sectors, split equally
    if (hallsRes.rows.length > 1) {
      const sectors = [...new Set(hallsRes.rows.map(h => h.sector_id))];
      const splitAmount = Math.round(p.salary / sectors.length * 100) / 100;
      for (const sid of sectors) {
        await db.query(
          `INSERT INTO expense_entries (entry_date, month_key, category, subcategory, description, amount_eur, sector_id, related_entity_type, related_entity_id)
           VALUES ($1, $2, 'salary', 'base', $3, $4, $5, 'personnel', $6)`,
          [entryDate, month_key, `${p.name} (${p.role})`, splitAmount, sid, p.id]
        );
      }
    } else {
      await db.query(
        `INSERT INTO expense_entries (entry_date, month_key, category, subcategory, description, amount_eur, sector_id, related_entity_type, related_entity_id)
         VALUES ($1, $2, 'salary', 'base', $3, $4, $5, 'personnel', $6)`,
        [entryDate, month_key, `${p.name} (${p.role})`, p.salary, sectorId, p.id]
      );
    }
    totalGenerated++;
    totalAmount += parseFloat(p.salary);
  }

  return ok({ message: `Генерирани ${totalGenerated} записа за ${month_key}`, count: totalGenerated, total_eur: Math.round(totalAmount * 100) / 100 });
}

async function salarySummary(db, { month_key }) {
  if (!month_key) return err(400, 'month_key е задължително');
  const byRole = await db.query(
    `SELECT p.role, COUNT(*) as count, SUM(e.amount_eur) as total_eur
     FROM expense_entries e
     JOIN personnel p ON p.id = e.related_entity_id AND e.related_entity_type = 'personnel'
     WHERE e.month_key = $1 AND e.category = 'salary'
     GROUP BY p.role ORDER BY total_eur DESC`, [month_key]);
  const total = await db.query(
    `SELECT SUM(amount_eur) as total_eur, COUNT(*) as count FROM expense_entries WHERE month_key = $1 AND category = 'salary'`, [month_key]);
  return ok({ summary: { month: month_key, byRole: byRole.rows, total: parseFloat(total.rows[0]?.total_eur || 0), count: parseInt(total.rows[0]?.count || 0) } });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: MEDICINE
// ═══════════════════════════════════════════════════════════════════════════

async function medicineList(db, { is_active }) {
  let q = 'SELECT * FROM medicine_catalog';
  const params = [];
  if (is_active !== undefined) { q += ' WHERE is_active = $1'; params.push(is_active); }
  q += ' ORDER BY name';
  const result = await db.query(q, params);
  return ok({ medicines: result.rows });
}

async function medicineUpsert(db, { id, name, name_bg, unit, price_per_unit_eur, current_stock, reorder_threshold, supplier, is_active }) {
  if (id) {
    const fields = []; const params = []; let idx = 1;
    if (name !== undefined) { fields.push(`name = $${idx++}`); params.push(name); }
    if (name_bg !== undefined) { fields.push(`name_bg = $${idx++}`); params.push(name_bg); }
    if (unit !== undefined) { fields.push(`unit = $${idx++}`); params.push(unit); }
    if (price_per_unit_eur !== undefined) { fields.push(`price_per_unit_eur = $${idx++}`); params.push(price_per_unit_eur); }
    if (current_stock !== undefined) { fields.push(`current_stock = $${idx++}`); params.push(current_stock); }
    if (reorder_threshold !== undefined) { fields.push(`reorder_threshold = $${idx++}`); params.push(reorder_threshold); }
    if (supplier !== undefined) { fields.push(`supplier = $${idx++}`); params.push(supplier); }
    if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); params.push(is_active); }
    fields.push(`updated_at = NOW()`);
    if (fields.length <= 1) return err(400, 'Няма полета за обновяване');
    params.push(id);
    const result = await db.query(`UPDATE medicine_catalog SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    return ok({ medicine: result.rows[0] });
  }
  if (!name || !unit) return err(400, 'Име и мерна единица са задължителни');
  const result = await db.query(
    `INSERT INTO medicine_catalog (name, name_bg, unit, price_per_unit_eur, current_stock, reorder_threshold, supplier)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [name, name_bg || null, unit, price_per_unit_eur || 0, current_stock || 0, reorder_threshold || 0, supplier || null]
  );
  return ok({ medicine: result.rows[0] });
}

async function medicineUse(db, { medicine_id, quantity, animal_id, event_id, notes, created_by }) {
  if (!medicine_id || !quantity || quantity <= 0) return err(400, 'medicine_id и положително quantity са задължителни');

  const med = await db.query('SELECT * FROM medicine_catalog WHERE id = $1', [medicine_id]);
  if (med.rows.length === 0) return err(404, 'Медикаментът не е намерен');

  const medicine = med.rows[0];
  if (parseFloat(medicine.current_stock) < quantity) {
    return err(400, `Недостатъчна наличност: ${medicine.name_bg || medicine.name} — налични ${medicine.current_stock} ${medicine.unit}, необходими ${quantity}`);
  }

  // Deduct from stock
  await db.query('UPDATE medicine_catalog SET current_stock = current_stock - $1, updated_at = NOW() WHERE id = $2', [quantity, medicine_id]);

  // Calculate cost
  const costBgn = Math.round(quantity * parseFloat(medicine.price_per_unit_eur) * 100) / 100;

  // Create expense entry
  const entryDate = new Date().toISOString().split('T')[0];
  const monthKey = entryDate.substring(0, 7);

  // Get sector from animal's hall
  let sectorId = null;
  if (animal_id) {
    const animalRes = await db.query(
      'SELECT h.sector_id FROM animals a JOIN halls h ON h.id = a.current_hall_id WHERE a.id = $1', [animal_id]);
    sectorId = animalRes.rows[0]?.sector_id || null;
  }

  await db.query(
    `INSERT INTO expense_entries (entry_date, month_key, category, subcategory, description, amount_eur, sector_id, related_entity_type, related_entity_id, created_by)
     VALUES ($1, $2, 'veterinary', 'medicine', $3, $4, $5, 'medicine', $6, $7)`,
    [entryDate, monthKey, `${quantity} ${medicine.unit} ${medicine.name_bg || medicine.name}`,
     costBgn, sectorId, medicine_id, created_by || null]
  );

  // Check low stock alert
  const updated = await db.query('SELECT * FROM medicine_catalog WHERE id = $1', [medicine_id]);
  if (parseFloat(updated.rows[0].current_stock) < parseFloat(updated.rows[0].reorder_threshold)) {
    await createAlert(db, 'warning', 'veterinary',
      `Ниска наличност медикамент: ${medicine.name_bg || medicine.name} — ${updated.rows[0].current_stock} ${medicine.unit}`,
      'medicine', medicine_id, 'medicine_stock', parseFloat(updated.rows[0].current_stock), parseFloat(updated.rows[0].reorder_threshold));
  }

  return ok({ used: { medicine_id, quantity, cost_eur: costBgn, remaining_stock: parseFloat(updated.rows[0].current_stock) } });
}

async function medicineRestock(db, { medicine_id, quantity, notes, created_by }) {
  if (!medicine_id || !quantity || quantity <= 0) return err(400, 'medicine_id и положително quantity са задължителни');
  const result = await db.query(
    'UPDATE medicine_catalog SET current_stock = current_stock + $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [quantity, medicine_id]
  );
  if (result.rows.length === 0) return err(404, 'Медикаментът не е намерен');
  return ok({ medicine: result.rows[0] });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: INVENTORY COUNTS
// ═══════════════════════════════════════════════════════════════════════════

async function inventoryCount(db, { component_id, counted_kg, counted_by, count_date, notes }) {
  if (!component_id || counted_kg === undefined) return err(400, 'component_id и counted_kg са задължителни');

  const comp = await db.query('SELECT * FROM feed_components WHERE id = $1', [component_id]);
  if (comp.rows.length === 0) return err(404, 'Компонентът не е намерен');

  const theoretical = parseFloat(comp.rows[0].current_stock_kg);
  const counted = parseFloat(counted_kg);
  const varianceKg = counted - theoretical;
  const variancePct = theoretical > 0 ? (varianceKg / theoretical * 100) : 0;

  const cDate = count_date || new Date().toISOString().split('T')[0];
  const result = await db.query(
    `INSERT INTO inventory_counts (count_date, component_id, counted_kg, theoretical_kg, variance_kg, variance_pct, counted_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [cDate, component_id, counted, theoretical, Math.round(varianceKg * 100) / 100,
     Math.round(variancePct * 10000) / 10000, counted_by || null, notes || null]
  );

  // Update actual stock to counted value
  await db.query('UPDATE feed_components SET current_stock_kg = $1, updated_at = NOW() WHERE id = $2', [counted, component_id]);

  // Alert if variance > 5%
  if (Math.abs(variancePct) > 5) {
    await createAlert(db, 'warning', 'inventory',
      `Голяма складова разлика: ${comp.rows[0].name_bg || comp.rows[0].name} — ${variancePct.toFixed(1)}% (${varianceKg > 0 ? '+' : ''}${varianceKg.toFixed(0)} кг)`,
      'feed_component', component_id, 'inventory_variance', Math.abs(variancePct), 5);
  }

  return ok({ count: result.rows[0] });
}

async function inventoryCountsList(db, { component_id, from_date, to_date, limit }) {
  let q = `SELECT ic.*, fc.name as component_name, fc.name_bg as component_name_bg, p.name as counted_by_name
           FROM inventory_counts ic
           JOIN feed_components fc ON fc.id = ic.component_id
           LEFT JOIN personnel p ON p.id = ic.counted_by
           WHERE 1=1`;
  const params = []; let idx = 1;
  if (component_id) { q += ` AND ic.component_id = $${idx++}`; params.push(component_id); }
  if (from_date) { q += ` AND ic.count_date >= $${idx++}`; params.push(from_date); }
  if (to_date) { q += ` AND ic.count_date <= $${idx++}`; params.push(to_date); }
  q += ' ORDER BY ic.count_date DESC, ic.id DESC';
  q += ` LIMIT $${idx++}`; params.push(limit || 100);
  const result = await db.query(q, params);
  return ok({ counts: result.rows });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: REPORTS — P&L
// ═══════════════════════════════════════════════════════════════════════════

async function reportsPnl(db, { month_key, from_date, to_date }) {
  let fd, td;
  if (month_key) {
    fd = `${month_key}-01`;
    const [y, m] = month_key.split('-').map(Number);
    td = new Date(y, m, 0).toISOString().split('T')[0]; // last day of month
  } else {
    fd = from_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    td = to_date || new Date().toISOString().split('T')[0];
  }

  // Revenue
  const revenue = await db.query(
    `SELECT COALESCE(SUM(total_amount_eur), 0) as total FROM sales WHERE sale_date >= $1 AND sale_date <= $2`, [fd, td]);
  const revenueBgn = parseFloat(revenue.rows[0].total);

  // Expenses by category
  const expenses = await db.query(
    `SELECT category, COALESCE(SUM(amount_eur), 0) as total FROM expense_entries
     WHERE entry_date >= $1 AND entry_date <= $2 GROUP BY category`, [fd, td]);

  const feedCost = parseFloat(expenses.rows.find(r => r.category === 'feed')?.total || 0);
  const salaryCost = parseFloat(expenses.rows.find(r => r.category === 'salary')?.total || 0);
  const vetCost = parseFloat(expenses.rows.find(r => r.category === 'veterinary')?.total || 0);
  const otherCost = parseFloat(expenses.rows.find(r => r.category === 'other')?.total || 0);
  const totalCost = feedCost + salaryCost + vetCost + otherCost;
  const operatingProfit = revenueBgn - totalCost;
  const grossMargin = revenueBgn > 0 ? ((revenueBgn - feedCost) / revenueBgn * 100) : 0;
  const operatingMargin = revenueBgn > 0 ? (operatingProfit / revenueBgn * 100) : 0;

  // Sold kg and heads
  const soldData = await db.query(
    `SELECT COALESCE(SUM(total_weight_kg), 0) as total_kg, COALESCE(SUM(head_count), 0) as total_heads
     FROM sales WHERE sale_date >= $1 AND sale_date <= $2`, [fd, td]);
  const totalKg = parseFloat(soldData.rows[0].total_kg);
  const totalHeads = parseInt(soldData.rows[0].total_heads);
  const costPerKg = totalKg > 0 ? totalCost / totalKg : 0;

  return ok({
    pnl: {
      period: { from: fd, to: td },
      revenue: Math.round(revenueBgn * 100) / 100,
      feed_cost: Math.round(feedCost * 100) / 100,
      salary_cost: Math.round(salaryCost * 100) / 100,
      vet_cost: Math.round(vetCost * 100) / 100,
      other_cost: Math.round(otherCost * 100) / 100,
      total_cost: Math.round(totalCost * 100) / 100,
      operating_profit: Math.round(operatingProfit * 100) / 100,
      gross_margin_pct: Math.round(grossMargin * 100) / 100,
      operating_margin_pct: Math.round(operatingMargin * 100) / 100,
      total_kg_sold: Math.round(totalKg * 100) / 100,
      total_heads_sold: totalHeads,
      cost_per_kg: Math.round(costPerKg * 100) / 100
    }
  });
}

async function reportsPnlBySector(db, { month_key }) {
  if (!month_key) return err(400, 'month_key е задължително');
  const fd = `${month_key}-01`;
  const [y, m] = month_key.split('-').map(Number);
  const td = new Date(y, m, 0).toISOString().split('T')[0];

  const sectors = await db.query('SELECT * FROM sectors ORDER BY id');
  const result = [];

  for (const sector of sectors.rows) {
    const expenses = await db.query(
      `SELECT category, COALESCE(SUM(amount_eur), 0) as total FROM expense_entries
       WHERE entry_date >= $1 AND entry_date <= $2 AND sector_id = $3 GROUP BY category`, [fd, td, sector.id]);

    result.push({
      sector_id: sector.id, sector_name: sector.name, sector_code: sector.code,
      feed_cost: parseFloat(expenses.rows.find(r => r.category === 'feed')?.total || 0),
      salary_cost: parseFloat(expenses.rows.find(r => r.category === 'salary')?.total || 0),
      vet_cost: parseFloat(expenses.rows.find(r => r.category === 'veterinary')?.total || 0),
      other_cost: parseFloat(expenses.rows.find(r => r.category === 'other')?.total || 0)
    });
  }

  // Revenue attribution: finisher sales → FIN sector, weaner sales → NUR sector
  const finSales = await db.query(
    `SELECT COALESCE(SUM(total_amount_eur), 0) as total FROM sales
     WHERE sale_date >= $1 AND sale_date <= $2 AND sale_type = 'finisher'`, [fd, td]);
  const weanerSales = await db.query(
    `SELECT COALESCE(SUM(total_amount_eur), 0) as total FROM sales
     WHERE sale_date >= $1 AND sale_date <= $2 AND sale_type = 'weaner'`, [fd, td]);
  const culledSales = await db.query(
    `SELECT COALESCE(SUM(total_amount_eur), 0) as total FROM sales
     WHERE sale_date >= $1 AND sale_date <= $2 AND sale_type = 'culled'`, [fd, td]);

  const finSector = result.find(r => r.sector_code === 'FIN');
  if (finSector) finSector.revenue = parseFloat(finSales.rows[0].total);
  const nurSector = result.find(r => r.sector_code === 'NUR');
  if (nurSector) nurSector.revenue = parseFloat(weanerSales.rows[0].total);
  // Culled → INS sector (breeding)
  const insSector = result.find(r => r.sector_code === 'INS');
  if (insSector) insSector.revenue = parseFloat(culledSales.rows[0].total);

  for (const r of result) {
    r.revenue = r.revenue || 0;
    r.total_cost = r.feed_cost + r.salary_cost + r.vet_cost + r.other_cost;
    r.operating_profit = r.revenue - r.total_cost;
  }

  return ok({ sectors: result, month: month_key });
}

async function reportsPnlByBatch(db, { group_id, from_date, to_date }) {
  let q = `SELECT g.*, h.name as hall_name FROM animal_groups g LEFT JOIN halls h ON h.id = g.hall_id
           WHERE g.exit_date IS NOT NULL`;
  const params = []; let idx = 1;
  if (group_id) { q += ` AND g.id = $${idx++}`; params.push(group_id); }
  if (from_date) { q += ` AND g.exit_date >= $${idx++}`; params.push(from_date); }
  if (to_date) { q += ` AND g.exit_date <= $${idx++}`; params.push(to_date); }
  q += ' ORDER BY g.exit_date DESC';

  const groups = await db.query(q, params);
  const batches = [];

  for (const g of groups.rows) {
    // Revenue from sales linked to this group
    const salesRes = await db.query(
      'SELECT COALESCE(SUM(total_amount_eur), 0) as revenue FROM sales WHERE group_id = $1', [g.id]);
    const revenue = parseFloat(salesRes.rows[0].revenue);

    // Feed cost: sum of expense entries linked to batches in this group's hall during the group's lifetime
    const feedCost = await db.query(
      `SELECT COALESCE(SUM(e.amount_eur), 0) as total FROM expense_entries e
       WHERE e.category = 'feed' AND e.entry_date >= $1 AND e.entry_date <= $2
       AND (e.hall_id = $3 OR e.sector_id = (SELECT sector_id FROM halls WHERE id = $3))`,
      [g.entry_date, g.exit_date || new Date().toISOString().split('T')[0], g.hall_id]);

    // Approximate cost attribution per head
    const totalKgGain = g.exit_count && g.exit_weight_avg_kg && g.entry_weight_avg_kg
      ? g.exit_count * (parseFloat(g.exit_weight_avg_kg) - parseFloat(g.entry_weight_avg_kg))
      : 0;

    batches.push({
      group_id: g.id, group_name: g.group_name, hall_name: g.hall_name,
      entry_date: g.entry_date, exit_date: g.exit_date,
      entry_count: g.entry_count, exit_count: g.exit_count,
      entry_weight: g.entry_weight_avg_kg, exit_weight: g.exit_weight_avg_kg,
      total_kg_gain: Math.round(totalKgGain * 100) / 100,
      revenue, feed_cost: parseFloat(feedCost.rows[0].total),
      profit: Math.round((revenue - parseFloat(feedCost.rows[0].total)) * 100) / 100
    });
  }

  return ok({ batches });
}

async function reportsPnlSnapshot(db, { month_key }) {
  if (!month_key) return err(400, 'month_key е задължително');

  // Get P&L data
  const pnlRes = await reportsPnl(db, { month_key });
  const pnlData = JSON.parse(pnlRes.body).pnl;

  await db.query(
    `INSERT INTO monthly_pnl_snapshots (month_key, revenue_eur, feed_cost_eur, salary_cost_eur, vet_cost_eur, other_cost_eur, total_cost_eur, operating_profit_eur, gross_margin_pct, operating_margin_pct, total_kg_sold, total_heads_sold, cost_per_kg)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (month_key) DO UPDATE SET
       revenue_eur = $2, feed_cost_eur = $3, salary_cost_eur = $4, vet_cost_eur = $5,
       other_cost_eur = $6, total_cost_eur = $7, operating_profit_eur = $8,
       gross_margin_pct = $9, operating_margin_pct = $10, total_kg_sold = $11,
       total_heads_sold = $12, cost_per_kg = $13, snapshot_date = NOW()`,
    [month_key, pnlData.revenue, pnlData.feed_cost, pnlData.salary_cost, pnlData.vet_cost,
     pnlData.other_cost, pnlData.total_cost, pnlData.operating_profit,
     pnlData.gross_margin_pct, pnlData.operating_margin_pct, pnlData.total_kg_sold,
     pnlData.total_heads_sold, pnlData.cost_per_kg]
  );

  return ok({ message: `Snapshot за ${month_key} записан`, pnl: pnlData });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: REPORTS — BIG 5
// ═══════════════════════════════════════════════════════════════════════════

async function reportsNpd(db, { from_date, to_date, hall_id, min_parity }) {
  const fd = from_date || new Date(new Date().getFullYear() - 1, new Date().getMonth(), 1).toISOString().split('T')[0];
  const td = to_date || new Date().toISOString().split('T')[0];

  // NPD = days in non-productive statuses (awaiting_breeding, inseminated w/o confirm, weaned_resting)
  const params = [fd, td];
  let extraFilter = '';
  let idx = 3;
  if (hall_id) { extraFilter += ` AND a.current_hall_id = $${idx++}`; params.push(hall_id); }
  if (min_parity) { extraFilter += ` AND a.parity_number >= $${idx++}`; params.push(min_parity); }

  const sowCondition = `a.category IN ('sow', 'gilt') AND a.status != 'culled'${extraFilter}`;

  // SQL-based NPD calculation: sum of days in non-productive statuses
  const npd = await db.query(`
    WITH sow_events AS (
      SELECT e.animal_id, e.event_type, e.event_date,
             LEAD(e.event_date) OVER (PARTITION BY e.animal_id ORDER BY e.event_date) as next_event_date
      FROM events e
      JOIN animals a ON a.id = e.animal_id
      WHERE e.event_date >= $1 AND e.event_date <= $2 AND ${sowCondition}
    ),
    npd_days AS (
      SELECT animal_id,
        SUM(CASE
          WHEN event_type IN ('weaning', 'rest_complete', 'pregnancy_check_negative')
          THEN EXTRACT(DAY FROM COALESCE(next_event_date, $2::timestamp) - event_date)
          ELSE 0
        END) as npd_days
      FROM sow_events
      GROUP BY animal_id
    )
    SELECT a.id, a.ear_tag, a.parity_number, a.status, a.current_hall_id,
           h.name as hall_name, COALESCE(n.npd_days, 0) as npd_days
    FROM animals a
    LEFT JOIN npd_days n ON n.animal_id = a.id
    LEFT JOIN halls h ON h.id = a.current_hall_id
    WHERE ${sowCondition}
    ORDER BY COALESCE(n.npd_days, 0) DESC
  `, params);

  const totalNpd = npd.rows.reduce((sum, r) => sum + parseFloat(r.npd_days), 0);
  const avgNpd = npd.rows.length > 0 ? totalNpd / npd.rows.length : 0;

  return ok({
    npd: {
      period: { from: fd, to: td },
      avg_npd: Math.round(avgNpd * 10) / 10,
      target: 35,
      total_sows: npd.rows.length,
      sows: npd.rows.map(r => ({
        id: r.id, ear_tag: r.ear_tag, parity: r.parity_number,
        status: r.status, hall_name: r.hall_name,
        npd_days: Math.round(parseFloat(r.npd_days))
      }))
    }
  });
}

async function reportsWeightVariation(db, { from_date, to_date, hall_id }) {
  const fd = from_date || new Date(new Date().getFullYear() - 1, 0, 1).toISOString().split('T')[0];
  const td = to_date || new Date().toISOString().split('T')[0];

  let q = `SELECT g.id, g.group_name, g.hall_id, h.name as hall_name,
                  g.exit_date, g.exit_count, g.exit_weight_avg_kg,
                  s.total_weight_kg, s.head_count as sale_heads
           FROM animal_groups g
           LEFT JOIN halls h ON h.id = g.hall_id
           LEFT JOIN sales s ON s.group_id = g.id
           WHERE g.exit_date IS NOT NULL AND g.exit_date >= $1 AND g.exit_date <= $2`;
  const params = [fd, td];
  let idx = 3;
  if (hall_id) { q += ` AND g.hall_id = $${idx++}`; params.push(hall_id); }
  q += ' ORDER BY g.exit_date DESC';

  const groups = await db.query(q, params);

  // For detailed weight variation we need individual weights from weight_recording events
  const batches = [];
  for (const g of groups.rows) {
    // Check for weight recording events with individual weights
    const weightEvents = await db.query(
      `SELECT details FROM events WHERE group_id = $1 AND event_type = 'weight_recording' ORDER BY event_date DESC LIMIT 1`,
      [g.id]
    );

    let cv = null, stddev = null, avgWeight = parseFloat(g.exit_weight_avg_kg) || 0;
    const weights = weightEvents.rows[0]?.details?.weights;

    if (weights && Array.isArray(weights) && weights.length > 1) {
      const mean = weights.reduce((s, w) => s + w, 0) / weights.length;
      const variance = weights.reduce((s, w) => s + Math.pow(w - mean, 2), 0) / weights.length;
      stddev = Math.sqrt(variance);
      cv = mean > 0 ? (stddev / mean * 100) : 0;
      avgWeight = mean;
    }

    batches.push({
      group_id: g.id, group_name: g.group_name, hall_name: g.hall_name,
      exit_date: g.exit_date, head_count: g.exit_count || g.sale_heads || 0,
      avg_weight_kg: Math.round(avgWeight * 10) / 10,
      std_dev: stddev !== null ? Math.round(stddev * 100) / 100 : null,
      cv_pct: cv !== null ? Math.round(cv * 100) / 100 : null,
      status: cv === null ? 'no_data' : cv < 10 ? 'green' : cv < 15 ? 'yellow' : 'red'
    });
  }

  return ok({ weightVariation: { period: { from: fd, to: td }, target_cv: 10, batches } });
}

async function reportsFeedEfficiency(db, { from_date, to_date, recipe_id }) {
  const fd = from_date || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
  const td = to_date || new Date().toISOString().split('T')[0];

  let q = `SELECT TO_CHAR(fpb.batch_date, 'YYYY-MM') as month,
                  fr.name as recipe_name, fr.name_bg as recipe_name_bg,
                  COUNT(*) as batch_count,
                  SUM(fpb.quantity_tons) as total_tons,
                  fr.shrinkage_pct
           FROM feed_production_batches fpb
           JOIN feed_recipes fr ON fr.id = fpb.recipe_id
           WHERE fpb.batch_date >= $1 AND fpb.batch_date <= $2`;
  const params = [fd, td]; let idx = 3;
  if (recipe_id) { q += ` AND fpb.recipe_id = $${idx++}`; params.push(recipe_id); }
  q += ` GROUP BY TO_CHAR(fpb.batch_date, 'YYYY-MM'), fr.name, fr.name_bg, fr.shrinkage_pct ORDER BY month`;

  const result = await db.query(q, params);

  // Cost per ton
  const costData = await db.query(
    `SELECT TO_CHAR(fpb.batch_date, 'YYYY-MM') as month,
            SUM(fpb.quantity_tons) as tons,
            SUM(e.amount_eur) as cost_eur
     FROM feed_production_batches fpb
     LEFT JOIN expense_entries e ON e.related_entity_type = 'feed_batch' AND e.related_entity_id = fpb.id
     WHERE fpb.batch_date >= $1 AND fpb.batch_date <= $2
     GROUP BY TO_CHAR(fpb.batch_date, 'YYYY-MM') ORDER BY month`, [fd, td]);

  const months = result.rows.map(r => ({
    month: r.month, recipe: r.recipe_name_bg || r.recipe_name,
    batch_count: parseInt(r.batch_count), total_tons: parseFloat(r.total_tons),
    shrinkage_pct: parseFloat(r.shrinkage_pct),
    theoretical_loss_tons: parseFloat(r.total_tons) * parseFloat(r.shrinkage_pct) / 100
  }));

  const costByMonth = costData.rows.map(r => ({
    month: r.month, tons: parseFloat(r.tons),
    cost_eur: parseFloat(r.cost_eur || 0),
    cost_per_ton: parseFloat(r.tons) > 0 ? Math.round(parseFloat(r.cost_eur || 0) / parseFloat(r.tons) * 100) / 100 : 0
  }));

  return ok({ feedEfficiency: { period: { from: fd, to: td }, byRecipe: months, costByMonth } });
}

async function reportsHallComparison(db, { sector_id, from_date, to_date, period }) {
  if (!sector_id) return err(400, 'sector_id е задължително');

  const days = period === '60d' ? 60 : period === '90d' ? 90 : 30;
  const fd = from_date || new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  const td = to_date || new Date().toISOString().split('T')[0];

  const sector = await db.query('SELECT * FROM sectors WHERE id = $1', [sector_id]);
  if (sector.rows.length === 0) return err(404, 'Секторът не е намерен');

  const halls = await db.query('SELECT * FROM halls WHERE sector_id = $1 AND is_active = true ORDER BY name', [sector_id]);

  const comparison = [];
  for (const hall of halls.rows) {
    const metrics = {};

    if (['FAR'].includes(sector.rows[0].code)) {
      // Farrowing sector: mortality, born alive, weaned, weaning weight
      const littersData = await db.query(
        `SELECT AVG(l.born_alive) as avg_born, AVG(l.weaned_count) as avg_weaned,
                AVG(l.weaning_weight_kg) as avg_weaning_weight,
                SUM(l.born_alive) as total_born, SUM(l.weaned_count) as total_weaned
         FROM litters l
         JOIN animals a ON a.id = l.birth_sow_id
         WHERE a.current_hall_id = $1 AND l.birth_date >= $2 AND l.birth_date <= $3`,
        [hall.id, fd, td]);

      const d = littersData.rows[0];
      const totalBorn = parseInt(d.total_born) || 0;
      const totalWeaned = parseInt(d.total_weaned) || 0;
      metrics.avg_born_alive = parseFloat(d.avg_born || 0).toFixed(1);
      metrics.avg_weaned = parseFloat(d.avg_weaned || 0).toFixed(1);
      metrics.avg_weaning_weight = parseFloat(d.avg_weaning_weight || 0).toFixed(1);
      metrics.mortality_pct = totalBorn > 0 ? ((totalBorn - totalWeaned) / totalBorn * 100).toFixed(1) : '0.0';
    }

    if (['FIN', 'NUR'].includes(sector.rows[0].code)) {
      // Finishing/nursery: mortality, weight gain, FCR
      const groupData = await db.query(
        `SELECT AVG(g.exit_weight_avg_kg) as avg_exit_weight,
                AVG(g.entry_weight_avg_kg) as avg_entry_weight,
                SUM(g.entry_count) as total_entry, SUM(g.exit_count) as total_exit
         FROM animal_groups g
         WHERE g.hall_id = $1 AND g.exit_date >= $2 AND g.exit_date <= $3`,
        [hall.id, fd, td]);

      const d = groupData.rows[0];
      const totalEntry = parseInt(d.total_entry) || 0;
      const totalExit = parseInt(d.total_exit) || 0;
      metrics.avg_exit_weight = parseFloat(d.avg_exit_weight || 0).toFixed(1);
      metrics.avg_entry_weight = parseFloat(d.avg_entry_weight || 0).toFixed(1);
      metrics.mortality_pct = totalEntry > 0 ? ((totalEntry - totalExit) / totalEntry * 100).toFixed(1) : '0.0';
    }

    comparison.push({ hall_id: hall.id, hall_name: hall.name, capacity: hall.capacity, occupancy: hall.current_occupancy, ...metrics });
  }

  return ok({ hallComparison: { sector: sector.rows[0], period: { from: fd, to: td, days }, halls: comparison } });
}

async function reportsInventoryVariance(db, { from_date, to_date }) {
  const fd = from_date || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
  const td = to_date || new Date().toISOString().split('T')[0];

  // Get latest count per component
  const latestCounts = await db.query(`
    SELECT DISTINCT ON (ic.component_id)
      ic.*, fc.name as component_name, fc.name_bg as component_name_bg,
      fc.current_stock_kg
    FROM inventory_counts ic
    JOIN feed_components fc ON fc.id = ic.component_id
    WHERE ic.count_date >= $1 AND ic.count_date <= $2
    ORDER BY ic.component_id, ic.count_date DESC
  `, [fd, td]);

  // Also include components without counts
  const allComps = await db.query('SELECT * FROM feed_components ORDER BY name');
  const countMap = new Map(latestCounts.rows.map(c => [c.component_id, c]));

  const components = allComps.rows.map(comp => {
    const count = countMap.get(comp.id);
    return {
      component_id: comp.id,
      name: comp.name, name_bg: comp.name_bg,
      theoretical_kg: parseFloat(comp.current_stock_kg),
      counted_kg: count ? parseFloat(count.counted_kg) : null,
      variance_kg: count ? parseFloat(count.variance_kg) : null,
      variance_pct: count ? parseFloat(count.variance_pct) : null,
      last_count_date: count ? count.count_date : null,
      status: !count ? 'no_count' : Math.abs(parseFloat(count.variance_pct)) < 2 ? 'green' : Math.abs(parseFloat(count.variance_pct)) < 5 ? 'yellow' : 'red'
    };
  });

  return ok({ inventoryVariance: { period: { from: fd, to: td }, target_pct: 2, components } });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: FINANCIAL KPIs
// ═══════════════════════════════════════════════════════════════════════════

async function reportsFinancialKpis(db) {
  const oneYearAgo = new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0];
  const today = new Date().toISOString().split('T')[0];

  // Total revenue (365 days)
  const revenueRes = await db.query(
    `SELECT COALESCE(SUM(total_amount_eur), 0) as total, COALESCE(SUM(total_weight_kg), 0) as total_kg,
            COALESCE(SUM(head_count), 0) as total_heads
     FROM sales WHERE sale_date >= $1`, [oneYearAgo]);
  const revenue = parseFloat(revenueRes.rows[0].total);
  const totalKg = parseFloat(revenueRes.rows[0].total_kg);
  const totalHeads = parseInt(revenueRes.rows[0].total_heads);

  // Expenses by category (365 days)
  const expensesRes = await db.query(
    `SELECT category, COALESCE(SUM(amount_eur), 0) as total FROM expense_entries
     WHERE entry_date >= $1 GROUP BY category`, [oneYearAgo]);
  const feedCost = parseFloat(expensesRes.rows.find(r => r.category === 'feed')?.total || 0);
  const salaryCost = parseFloat(expensesRes.rows.find(r => r.category === 'salary')?.total || 0);
  const vetCost = parseFloat(expensesRes.rows.find(r => r.category === 'veterinary')?.total || 0);
  const totalCost = feedCost + salaryCost + vetCost;

  // Active sow count
  const sowCount = await db.query("SELECT COUNT(*) FROM animals WHERE category IN ('sow', 'gilt') AND status != 'culled'");
  const activeSows = parseInt(sowCount.rows[0].count) || 1;

  const kpis = [
    { name: 'cost_per_kg', label: 'Себестойност/кг', value: totalKg > 0 ? Math.round(totalCost / totalKg * 100) / 100 : 0, target: 2.50, unit: '€/кг', lowerIsBetter: true },
    { name: 'feed_cost_per_kg', label: 'Фуражен разход/кг', value: totalKg > 0 ? Math.round(feedCost / totalKg * 100) / 100 : 0, target: 1.60, unit: '€/кг', lowerIsBetter: true },
    { name: 'labor_cost_per_head', label: 'Разход труд/глава', value: totalHeads > 0 ? Math.round(salaryCost / totalHeads * 100) / 100 : 0, target: 25, unit: '€/глава', lowerIsBetter: true },
    { name: 'vet_cost_per_head', label: 'Вет разход/глава', value: totalHeads > 0 ? Math.round(vetCost / totalHeads * 100) / 100 : 0, target: 8, unit: '€/глава', lowerIsBetter: true },
    { name: 'revenue_per_sow', label: 'Приход/свиня/год', value: Math.round(revenue / activeSows * 100) / 100, target: 3000, unit: '€', lowerIsBetter: false },
    { name: 'operating_margin', label: 'Оперативен марж', value: revenue > 0 ? Math.round((revenue - totalCost) / revenue * 10000) / 100 : 0, target: 15, unit: '%', lowerIsBetter: false },
    { name: 'breakeven_price', label: 'Точка на рентабилност', value: totalKg > 0 ? Math.round(totalCost / totalKg * 100) / 100 : 0, target: null, unit: '€/кг', lowerIsBetter: true }
  ];

  // Add color coding
  for (const kpi of kpis) {
    if (kpi.target === null) { kpi.color = 'grey'; continue; }
    const pct = kpi.lowerIsBetter
      ? (kpi.target - kpi.value) / kpi.target
      : (kpi.value - kpi.target) / kpi.target;
    kpi.color = pct >= 0 ? 'green' : pct >= -0.1 ? 'yellow' : 'red';
  }

  return ok({ financialKpis: kpis });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: EXCEL EXPORT (placeholder — will be implemented in sub-phase 2F)
// ═══════════════════════════════════════════════════════════════════════════

async function exportExcel(db, { report_type, params: reportParams }) {
  if (!report_type) return err(400, 'report_type е задължително');
  const p = reportParams || {};

  // CSV helper — escapes fields and joins with semicolons (for BG locale Excel compatibility)
  const esc = v => { const s = String(v ?? ''); return s.includes(';') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s; };
  const csvRow = cols => cols.map(esc).join(';');
  const rows = [];

  try {
    if (report_type === 'pnl') {
      const res = await reportsPnl(db, p); const pnl = JSON.parse(res.body).pnl;
      rows.push(csvRow(['Статия', 'Сума (€)']));
      rows.push(csvRow(['Приходи от продажби', pnl.revenue]));
      rows.push(csvRow(['Фуражни разходи', -pnl.feed_cost]));
      rows.push(csvRow(['Заплати', -pnl.salary_cost]));
      rows.push(csvRow(['Ветеринарни', -pnl.vet_cost]));
      rows.push(csvRow(['Други разходи', -pnl.other_cost]));
      rows.push(csvRow(['Оперативна печалба', pnl.operating_profit]));
      rows.push(csvRow(['Брутен марж %', pnl.gross_margin_pct]));
      rows.push(csvRow(['Оперативен марж %', pnl.operating_margin_pct]));
      rows.push(csvRow(['Продадени кг', pnl.total_kg_sold]));
      rows.push(csvRow(['Продадени глави', pnl.total_heads_sold]));
      rows.push(csvRow(['Себестойност/кг', pnl.cost_per_kg]));

    } else if (report_type === 'sales') {
      const res = await salesList(db, { ...p, limit: 50000 }); const sales = JSON.parse(res.body).sales;
      rows.push(csvRow(['Дата', 'Тип', 'Купувач', 'Глави', 'Тегло (кг)', 'Цена/кг', 'Цена/бр', 'Сума (€)', 'Фактура']));
      for (const s of sales) rows.push(csvRow([s.sale_date?.substring(0, 10), s.sale_type, s.buyer_name, s.head_count, s.total_weight_kg, s.price_per_kg, s.price_per_head, s.total_amount_eur, s.invoice_number]));

    } else if (report_type === 'expenses') {
      const res = await expensesList(db, { ...p, limit: 50000 }); const expenses = JSON.parse(res.body).expenses;
      rows.push(csvRow(['Дата', 'Категория', 'Подкатегория', 'Описание', 'Сума (€)', 'Сектор']));
      for (const e of expenses) rows.push(csvRow([e.entry_date?.substring(0, 10), e.category, e.subcategory, e.description, e.amount_eur, e.sector_name]));

    } else if (report_type === 'npd') {
      const res = await reportsNpd(db, p); const npd = JSON.parse(res.body).npd;
      rows.push(csvRow(['Ушна марка', 'Паритет', 'Статус', 'Хале', 'NPD (дни)']));
      for (const s of npd.sows) rows.push(csvRow([s.ear_tag || `#${s.id}`, s.parity, s.status, s.hall_name, s.npd_days]));

    } else if (report_type === 'inventory_variance') {
      const res = await reportsInventoryVariance(db, p); const inv = JSON.parse(res.body).inventoryVariance;
      rows.push(csvRow(['Компонент', 'Теоретичен (кг)', 'Реален (кг)', 'Вариация (кг)', 'Вариация %', 'Статус']));
      for (const c of inv.components) rows.push(csvRow([c.name_bg || c.name, c.theoretical_kg, c.counted_kg, c.variance_kg, c.variance_pct, c.status]));

    } else if (report_type === 'animals') {
      const res = await db.query(`SELECT a.*, h.name as hall_name FROM animals a LEFT JOIN halls h ON h.id = a.current_hall_id ORDER BY a.id LIMIT 50000`);
      rows.push(csvRow(['ID', 'Ушна марка', 'Категория', 'Порода', 'Статус', 'Паритет', 'Хале', 'Дата раждане']));
      for (const a of res.rows) rows.push(csvRow([a.id, a.ear_tag, a.category, a.breed, a.status, a.parity_number, a.hall_name, a.date_of_birth?.substring(0, 10)]));

    } else if (report_type === 'delivery_routes') {
      const res = await deliveryList(db, { ...p, limit: 50000 }); const routes = JSON.parse(res.body).routes;
      rows.push(csvRow(['Дата', 'МПС', 'Шофьор', 'Тонове', 'Км старт', 'Км край', 'Статус']));
      for (const r of routes) rows.push(csvRow([r.route_date?.substring(0, 10), r.plate_number, r.driver_name, r.total_tons, r.km_start, r.km_end, r.status]));

    } else if (report_type === 'dispatches') {
      const res = await dispatchList(db, { ...p, limit: 50000 }); const dispatches = JSON.parse(res.body).dispatches;
      rows.push(csvRow(['Дата', 'Група', 'Хале', 'Глави', 'Тегло товарене', 'Тегло кланица', 'Фира %', 'МПС', 'Статус']));
      for (const d of dispatches) rows.push(csvRow([d.dispatch_date?.substring(0, 10), d.group_name, d.hall_name, d.head_count, d.weight_at_loading_kg, d.weight_at_destination_kg, d.shrinkage_pct, d.plate_number, d.status]));

    } else {
      return err(400, `Непознат тип отчет: ${report_type}`);
    }

    const csv = '\uFEFF' + rows.join('\n'); // BOM for UTF-8 in Excel
    const fileName = `ajaxerp_${report_type}_${new Date().toISOString().split('T')[0]}.csv`;

    // Upload to S3 if available
    const s3Bucket = process.env.OPENKBS_STORAGE_BUCKET;
    if (s3Bucket) {
      const { S3Client, PutObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      const s3 = new S3Client({ region: process.env.OPENKBS_REGION || 'eu-central-1' });
      const key = `exports/${fileName}`;
      await s3.send(new PutObjectCommand({ Bucket: s3Bucket, Key: key, Body: csv, ContentType: 'text/csv; charset=utf-8' }));
      const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: s3Bucket, Key: key }), { expiresIn: 3600 });
      return ok({ url, fileName, rows: rows.length });
    }

    // Fallback: return inline
    return ok({ fileName, csv, rows: rows.length });

  } catch (e) {
    return err(500, `Грешка при генериране: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: VEHICLES
// ═══════════════════════════════════════════════════════════════════════════

async function vehiclesList(db, { vehicle_type, status, is_active }) {
  let q = `SELECT v.*, p.name as driver_name FROM vehicles v LEFT JOIN personnel p ON p.id = v.assigned_driver_id WHERE 1=1`;
  const params = []; let idx = 1;
  if (vehicle_type) { q += ` AND v.vehicle_type = $${idx++}`; params.push(vehicle_type); }
  if (status) { q += ` AND v.status = $${idx++}`; params.push(status); }
  if (is_active !== undefined) { q += ` AND v.is_active = $${idx++}`; params.push(is_active); }
  q += ' ORDER BY v.plate_number';
  const result = await db.query(q, params);
  return ok({ vehicles: result.rows });
}

async function vehiclesUpsert(db, { id, plate_number, vehicle_type, capacity_tons, assigned_driver_id, current_km, notes }) {
  if (!plate_number) return err(400, 'Регистрационен номер е задължителен');
  if (id) {
    const result = await db.query(
      `UPDATE vehicles SET plate_number=$1, vehicle_type=COALESCE($2,vehicle_type), capacity_tons=COALESCE($3,capacity_tons),
       assigned_driver_id=$4, current_km=COALESCE($5,current_km), notes=$6 WHERE id=$7 RETURNING *`,
      [plate_number, vehicle_type, capacity_tons, assigned_driver_id || null, current_km, notes || null, id]
    );
    if (result.rows.length === 0) return err(404, 'МПС не е намерено');
    return ok({ vehicle: result.rows[0] });
  }
  const result = await db.query(
    `INSERT INTO vehicles (plate_number, vehicle_type, capacity_tons, assigned_driver_id, current_km, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [plate_number, vehicle_type || 'feed_truck', capacity_tons || 0, assigned_driver_id || null, current_km || 0, notes || null]
  );
  return ok({ vehicle: result.rows[0] });
}

async function vehiclesUpdateStatus(db, { id, status }) {
  if (!id || !status) return err(400, 'id и status са задължителни');
  const valid = ['clean', 'dirty', 'maintenance', 'out_of_service'];
  if (!valid.includes(status)) return err(400, `Невалиден статус. Валидни: ${valid.join(', ')}`);
  const result = await db.query('UPDATE vehicles SET status = $1 WHERE id = $2 RETURNING *', [status, id]);
  if (result.rows.length === 0) return err(404, 'МПС не е намерено');
  return ok({ vehicle: result.rows[0] });
}

async function vehiclesStats(db, { from_date, to_date }) {
  const fd = from_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const td = to_date || new Date().toISOString().split('T')[0];
  const result = await db.query(
    `SELECT v.id, v.plate_number, v.vehicle_type, v.current_km, p.name as driver_name,
       COUNT(dr.id) as route_count, COALESCE(SUM(dr.total_tons), 0) as total_tons,
       COALESCE(SUM(dr.km_end - dr.km_start), 0) as total_km
     FROM vehicles v
     LEFT JOIN personnel p ON p.id = v.assigned_driver_id
     LEFT JOIN delivery_routes dr ON dr.vehicle_id = v.id AND dr.status = 'completed'
       AND dr.route_date >= $1 AND dr.route_date <= $2
     WHERE v.is_active = true
     GROUP BY v.id, v.plate_number, v.vehicle_type, v.current_km, p.name
     ORDER BY total_tons DESC`,
    [fd, td]
  );
  return ok({ stats: result.rows, from: fd, to: td });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: SILOS
// ═══════════════════════════════════════════════════════════════════════════

async function silosList(db, { hall_id, low_only }) {
  let q = `SELECT s.*, h.name as hall_name, sec.name as sector_name, sec.code as sector_code,
           fr.name_bg as recipe_name_bg,
           CASE WHEN s.capacity_tons > 0 THEN ROUND((s.current_level_tons / s.capacity_tons * 100)::numeric, 1) ELSE 0 END as fill_pct
     FROM silos s
     JOIN halls h ON h.id = s.hall_id
     JOIN sectors sec ON sec.id = h.sector_id
     LEFT JOIN feed_recipes fr ON fr.id = s.recipe_id
     WHERE s.is_active = true`;
  const params = []; let idx = 1;
  if (hall_id) { q += ` AND s.hall_id = $${idx++}`; params.push(hall_id); }
  if (low_only) { q += ` AND s.capacity_tons > 0 AND (s.current_level_tons / s.capacity_tons * 100) < s.low_level_threshold_pct`; }
  q += ' ORDER BY sec.code, h.name, s.silo_name';
  const result = await db.query(q, params);
  return ok({ silos: result.rows });
}

async function silosUpsert(db, { id, hall_id, silo_name, capacity_tons, feed_type, recipe_id, low_level_threshold_pct, notes }) {
  if (!hall_id || !silo_name || !capacity_tons) return err(400, 'hall_id, silo_name и capacity_tons са задължителни');
  if (id) {
    const result = await db.query(
      `UPDATE silos SET hall_id=$1, silo_name=$2, capacity_tons=$3, feed_type=$4, recipe_id=$5,
       low_level_threshold_pct=COALESCE($6, low_level_threshold_pct), notes=$7 WHERE id=$8 RETURNING *`,
      [hall_id, silo_name, capacity_tons, feed_type || null, recipe_id || null, low_level_threshold_pct, notes || null, id]
    );
    if (result.rows.length === 0) return err(404, 'Силозът не е намерен');
    return ok({ silo: result.rows[0] });
  }
  const result = await db.query(
    `INSERT INTO silos (hall_id, silo_name, capacity_tons, feed_type, recipe_id, low_level_threshold_pct, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [hall_id, silo_name, capacity_tons, feed_type || null, recipe_id || null, low_level_threshold_pct || 20, notes || null]
  );
  return ok({ silo: result.rows[0] });
}

async function silosFill(db, { silo_id, tons }) {
  if (!silo_id || !tons || tons <= 0) return err(400, 'silo_id и tons (> 0) са задължителни');
  const silo = await db.query('SELECT * FROM silos WHERE id = $1', [silo_id]);
  if (silo.rows.length === 0) return err(404, 'Силозът не е намерен');
  const newLevel = parseFloat(silo.rows[0].current_level_tons) + parseFloat(tons);
  if (newLevel > parseFloat(silo.rows[0].capacity_tons)) {
    return err(400, `Надвишаване на капацитета: ${silo.rows[0].capacity_tons}т, текущо ${silo.rows[0].current_level_tons}т + ${tons}т = ${newLevel.toFixed(2)}т`);
  }
  const result = await db.query(
    `UPDATE silos SET current_level_tons = $1, last_filled_at = NOW() WHERE id = $2 RETURNING *`,
    [Math.round(newLevel * 100) / 100, silo_id]
  );
  return ok({ silo: result.rows[0] });
}

async function silosCheckLevels(db) {
  const lowSilos = await db.query(
    `SELECT s.id, s.silo_name, s.current_level_tons, s.capacity_tons, s.low_level_threshold_pct,
       h.name as hall_name, ROUND((s.current_level_tons / s.capacity_tons * 100)::numeric, 1) as fill_pct
     FROM silos s JOIN halls h ON h.id = s.hall_id
     WHERE s.is_active = true AND s.capacity_tons > 0
       AND (s.current_level_tons / s.capacity_tons * 100) < s.low_level_threshold_pct`
  );
  let generated = 0;
  for (const s of lowSilos.rows) {
    const severity = parseFloat(s.fill_pct) < 10 ? 'critical' : 'warning';
    await createAlert(db, severity, 'logistics',
      `Силоз "${s.silo_name}" в ${s.hall_name}: ${s.fill_pct}% (${s.current_level_tons}/${s.capacity_tons} т)`,
      'silo', s.id, 'silo_level', parseFloat(s.fill_pct), parseFloat(s.low_level_threshold_pct));
    generated++;
  }
  return ok({ checked: lowSilos.rows.length, alertsGenerated: generated, lowSilos: lowSilos.rows });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: DELIVERY ROUTES
// ═══════════════════════════════════════════════════════════════════════════

async function deliveryCreate(db, { vehicle_id, driver_id, stops, notes, created_by, km_start }) {
  if (!vehicle_id || !driver_id || !stops || stops.length === 0) {
    return err(400, 'vehicle_id, driver_id и поне 1 спирка са задължителни');
  }
  // Biosecurity: check vehicle is clean
  const vehicle = await db.query('SELECT * FROM vehicles WHERE id = $1', [vehicle_id]);
  if (vehicle.rows.length === 0) return err(404, 'МПС не е намерено');
  if (vehicle.rows[0].status !== 'clean') {
    return err(400, `Камионът ${vehicle.rows[0].plate_number} трябва да е чист (текущ статус: ${vehicle.rows[0].status}). Регистрирайте дезинфекция първо.`);
  }
  // Check total tonnage
  const totalTons = stops.reduce((sum, s) => sum + (parseFloat(s.tons) || 0), 0);
  if (totalTons > parseFloat(vehicle.rows[0].capacity_tons)) {
    return err(400, `Общо ${totalTons.toFixed(2)}т надвишава капацитета ${vehicle.rows[0].capacity_tons}т на ${vehicle.rows[0].plate_number}`);
  }
  // Create route
  const route = await db.query(
    `INSERT INTO delivery_routes (vehicle_id, driver_id, total_tons, notes, created_by, km_start, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'planned') RETURNING *`,
    [vehicle_id, driver_id, Math.round(totalTons * 100) / 100, notes || null, created_by || null, km_start || null]
  );
  // Create stops
  const createdStops = [];
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const stopRes = await db.query(
      `INSERT INTO delivery_stops (route_id, stop_order, silo_id, planned_tons)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [route.rows[0].id, i + 1, s.silo_id, parseFloat(s.tons)]
    );
    createdStops.push(stopRes.rows[0]);
  }
  return ok({ route: route.rows[0], stops: createdStops });
}

async function deliveryList(db, { from_date, to_date, status, driver_id, limit }) {
  let q = `SELECT dr.*, v.plate_number, p.name as driver_name, cr.name as created_by_name,
       (SELECT COUNT(*) FROM delivery_stops ds WHERE ds.route_id = dr.id) as stop_count
     FROM delivery_routes dr
     JOIN vehicles v ON v.id = dr.vehicle_id
     JOIN personnel p ON p.id = dr.driver_id
     LEFT JOIN personnel cr ON cr.id = dr.created_by
     WHERE 1=1`;
  const params = []; let idx = 1;
  if (from_date) { q += ` AND dr.route_date >= $${idx++}`; params.push(from_date); }
  if (to_date) { q += ` AND dr.route_date <= $${idx++}`; params.push(to_date); }
  if (status) { q += ` AND dr.status = $${idx++}`; params.push(status); }
  if (driver_id) { q += ` AND dr.driver_id = $${idx++}`; params.push(driver_id); }
  q += ` ORDER BY dr.route_date DESC, dr.id DESC LIMIT $${idx++}`;
  params.push(limit || 100);
  const result = await db.query(q, params);
  return ok({ routes: result.rows });
}

async function deliveryGet(db, { id }) {
  if (!id) return err(400, 'ID е задължително');
  const route = await db.query(
    `SELECT dr.*, v.plate_number, v.capacity_tons, p.name as driver_name
     FROM delivery_routes dr JOIN vehicles v ON v.id = dr.vehicle_id JOIN personnel p ON p.id = dr.driver_id
     WHERE dr.id = $1`, [id]
  );
  if (route.rows.length === 0) return err(404, 'Маршрутът не е намерен');
  const stops = await db.query(
    `SELECT ds.*, s.silo_name, h.name as hall_name
     FROM delivery_stops ds JOIN silos s ON s.id = ds.silo_id JOIN halls h ON h.id = s.hall_id
     WHERE ds.route_id = $1 ORDER BY ds.stop_order`, [id]
  );
  return ok({ route: route.rows[0], stops: stops.rows });
}

async function deliveryComplete(db, { id, stops_delivered, km_end }) {
  if (!id) return err(400, 'ID е задължително');
  const route = await db.query('SELECT * FROM delivery_routes WHERE id = $1', [id]);
  if (route.rows.length === 0) return err(404, 'Маршрутът не е намерен');
  if (route.rows[0].status === 'completed') return err(400, 'Маршрутът вече е завършен');
  if (route.rows[0].status === 'cancelled') return err(400, 'Маршрутът е отменен');

  let totalDelivered = 0;
  // Update each stop with delivered amounts
  if (stops_delivered && stops_delivered.length > 0) {
    for (const sd of stops_delivered) {
      const delivered = parseFloat(sd.delivered_tons) || 0;
      totalDelivered += delivered;
      await db.query(
        `UPDATE delivery_stops SET delivered_tons = $1, status = $2, delivered_at = NOW()
         WHERE id = $3`,
        [delivered, delivered > 0 ? 'delivered' : 'skipped', sd.stop_id]
      );
      // Update silo level
      if (delivered > 0) {
        const silo = await db.query('SELECT * FROM silos WHERE id = (SELECT silo_id FROM delivery_stops WHERE id = $1)', [sd.stop_id]);
        if (silo.rows.length > 0) {
          const newLevel = Math.min(
            parseFloat(silo.rows[0].current_level_tons) + delivered,
            parseFloat(silo.rows[0].capacity_tons)
          );
          await db.query(
            'UPDATE silos SET current_level_tons = $1, last_filled_at = NOW() WHERE id = $2',
            [Math.round(newLevel * 100) / 100, silo.rows[0].id]
          );
        }
      }
    }
  } else {
    // Auto-mark all stops as delivered with planned amounts
    const stops = await db.query('SELECT * FROM delivery_stops WHERE route_id = $1', [id]);
    for (const stop of stops.rows) {
      const delivered = parseFloat(stop.planned_tons);
      totalDelivered += delivered;
      await db.query(
        `UPDATE delivery_stops SET delivered_tons = $1, status = 'delivered', delivered_at = NOW() WHERE id = $2`,
        [delivered, stop.id]
      );
      // Update silo
      const silo = await db.query('SELECT * FROM silos WHERE id = $1', [stop.silo_id]);
      if (silo.rows.length > 0) {
        const newLevel = Math.min(
          parseFloat(silo.rows[0].current_level_tons) + delivered,
          parseFloat(silo.rows[0].capacity_tons)
        );
        await db.query('UPDATE silos SET current_level_tons = $1, last_filled_at = NOW() WHERE id = $2',
          [Math.round(newLevel * 100) / 100, silo.rows[0].id]);
      }
    }
  }

  // Mark route completed, vehicle dirty
  const updatedRoute = await db.query(
    `UPDATE delivery_routes SET status = 'completed', completed_at = NOW(), total_tons = $1, km_end = $2
     WHERE id = $3 RETURNING *`,
    [Math.round(totalDelivered * 100) / 100, km_end || null, id]
  );
  await db.query('UPDATE vehicles SET status = $1, current_km = COALESCE($2, current_km) WHERE id = $3',
    ['dirty', km_end || null, route.rows[0].vehicle_id]);

  return ok({ route: updatedRoute.rows[0], totalDelivered: Math.round(totalDelivered * 100) / 100 });
}

async function deliveryCancel(db, { id }) {
  if (!id) return err(400, 'ID е задължително');
  const route = await db.query('SELECT status FROM delivery_routes WHERE id = $1', [id]);
  if (route.rows.length === 0) return err(404, 'Маршрутът не е намерен');
  if (route.rows[0].status !== 'planned') return err(400, 'Само планирани маршрути могат да бъдат отменени');
  const result = await db.query('UPDATE delivery_routes SET status = $1 WHERE id = $2 RETURNING *', ['cancelled', id]);
  return ok({ route: result.rows[0] });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: DISPATCH ORDERS
// ═══════════════════════════════════════════════════════════════════════════

async function dispatchCreate(db, { group_id, dispatch_date, buyer_name, destination, vehicle_id, driver_id, head_count, notes, created_by, auto_generated, force_withdrawal }) {
  if (!group_id || !dispatch_date || !head_count) return err(400, 'group_id, dispatch_date и head_count са задължителни');
  const group = await db.query('SELECT * FROM animal_groups WHERE id = $1', [group_id]);
  if (group.rows.length === 0) return err(404, 'Групата не е намерена');

  // Phase 4: Check active withdrawals
  if (!force_withdrawal) {
    const aw = await db.query(
      `SELECT aw.*, mc.name_bg as medicine_name FROM active_withdrawals aw
       JOIN medicine_catalog mc ON mc.id = aw.medicine_id
       WHERE aw.group_id = $1 AND aw.status = 'active' AND aw.end_date > CURRENT_DATE`, [group_id]);
    if (aw.rows.length > 0) {
      const meds = aw.rows.map(w => `${w.medicine_name} (до ${w.end_date})`).join(', ');
      return err(400, `ВНИМАНИЕ: Активни карентни срокове за групата: ${meds}. Използвайте force_withdrawal=true за преминаване.`);
    }
  }

  const result = await db.query(
    `INSERT INTO dispatch_orders (group_id, dispatch_date, buyer_name, destination, vehicle_id, driver_id, head_count, notes, created_by, auto_generated)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [group_id, dispatch_date, buyer_name || null, destination || null, vehicle_id || null, driver_id || null,
     head_count, notes || null, created_by || null, auto_generated || false]
  );
  return ok({ dispatch: result.rows[0] });
}

async function dispatchList(db, { status, from_date, to_date, limit }) {
  let q = `SELECT d.*, g.group_name, g.current_weight_avg_kg, g.current_count,
       h.name as hall_name, v.plate_number, p.name as driver_name
     FROM dispatch_orders d
     JOIN animal_groups g ON g.id = d.group_id
     LEFT JOIN halls h ON h.id = g.hall_id
     LEFT JOIN vehicles v ON v.id = d.vehicle_id
     LEFT JOIN personnel p ON p.id = d.driver_id
     WHERE 1=1`;
  const params = []; let idx = 1;
  if (status) { q += ` AND d.status = $${idx++}`; params.push(status); }
  if (from_date) { q += ` AND d.dispatch_date >= $${idx++}`; params.push(from_date); }
  if (to_date) { q += ` AND d.dispatch_date <= $${idx++}`; params.push(to_date); }
  q += ` ORDER BY d.dispatch_date DESC, d.id DESC LIMIT $${idx++}`;
  params.push(limit || 100);
  const result = await db.query(q, params);
  return ok({ dispatches: result.rows });
}

async function dispatchUpdate(db, { id, status, weight_at_loading_kg, weight_at_destination_kg, vehicle_id, driver_id, buyer_name, destination, notes }) {
  if (!id) return err(400, 'ID е задължително');
  const dispatch = await db.query('SELECT * FROM dispatch_orders WHERE id = $1', [id]);
  if (dispatch.rows.length === 0) return err(404, 'Заявката не е намерена');
  const d = dispatch.rows[0];

  // Build update
  const updates = []; const params = []; let idx = 1;
  if (status) { updates.push(`status = $${idx++}`); params.push(status); }
  if (weight_at_loading_kg !== undefined) { updates.push(`weight_at_loading_kg = $${idx++}`); params.push(weight_at_loading_kg); }
  if (weight_at_destination_kg !== undefined) { updates.push(`weight_at_destination_kg = $${idx++}`); params.push(weight_at_destination_kg); }
  if (vehicle_id !== undefined) { updates.push(`vehicle_id = $${idx++}`); params.push(vehicle_id); }
  if (driver_id !== undefined) { updates.push(`driver_id = $${idx++}`); params.push(driver_id); }
  if (buyer_name !== undefined) { updates.push(`buyer_name = $${idx++}`); params.push(buyer_name); }
  if (destination !== undefined) { updates.push(`destination = $${idx++}`); params.push(destination); }
  if (notes !== undefined) { updates.push(`notes = $${idx++}`); params.push(notes); }

  if (updates.length === 0) return err(400, 'Няма полета за обновяване');
  params.push(id);
  const result = await db.query(`UPDATE dispatch_orders SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`, params);
  const updated = result.rows[0];

  // Calculate shrinkage if both weights available
  if (updated.weight_at_loading_kg && updated.weight_at_destination_kg) {
    const loadKg = parseFloat(updated.weight_at_loading_kg);
    const destKg = parseFloat(updated.weight_at_destination_kg);
    const shrinkage = loadKg > 0 ? Math.round((loadKg - destKg) / loadKg * 10000) / 100 : 0;
    await db.query('UPDATE dispatch_orders SET shrinkage_pct = $1 WHERE id = $2', [shrinkage, id]);
    updated.shrinkage_pct = shrinkage;
  }

  // Auto-create sale when delivered
  if (status === 'delivered' && updated.weight_at_destination_kg && updated.head_count) {
    const group = await db.query('SELECT * FROM animal_groups WHERE id = $1', [updated.group_id]);
    if (group.rows.length > 0) {
      // Default price per kg if not set — use market average 2.95 €/кг
      const pricePerKg = 2.95;
      const totalAmount = Math.round(parseFloat(updated.weight_at_destination_kg) * pricePerKg * 100) / 100;
      await db.query(
        `INSERT INTO sales (sale_date, sale_type, group_id, buyer_name, head_count, total_weight_kg, price_per_kg, total_amount_eur, notes, created_by)
         VALUES ($1, 'finisher', $2, $3, $4, $5, $6, $7, $8, $9)`,
        [updated.dispatch_date, updated.group_id, updated.buyer_name, updated.head_count,
         updated.weight_at_destination_kg, pricePerKg, totalAmount,
         `Авто от dispatch #${id}`, updated.driver_id || null]
      );
      // Update group exit
      await db.query(
        `UPDATE animal_groups SET exit_date = $1, exit_count = $2, exit_weight_avg_kg = $3 WHERE id = $4`,
        [updated.dispatch_date, updated.head_count,
         updated.head_count > 0 ? Math.round(parseFloat(updated.weight_at_destination_kg) / updated.head_count * 100) / 100 : null,
         updated.group_id]
      );
    }
  }

  return ok({ dispatch: updated });
}

async function dispatchAutoCheck(db) {
  // Find finisher groups with avg weight >= 122 kg and no active dispatch
  const groups = await db.query(`
    SELECT g.* FROM animal_groups g
    WHERE g.category = 'finisher' AND g.exit_date IS NULL
      AND g.current_weight_avg_kg >= 122
      AND NOT EXISTS (
        SELECT 1 FROM dispatch_orders d WHERE d.group_id = g.id AND d.status NOT IN ('cancelled', 'delivered')
      )
  `);
  const created = [];
  for (const g of groups.rows) {
    const dispatchDate = new Date();
    dispatchDate.setDate(dispatchDate.getDate() + 3);
    const result = await db.query(
      `INSERT INTO dispatch_orders (group_id, dispatch_date, head_count, auto_generated, status, notes)
       VALUES ($1, $2, $3, true, 'proposed', $4) RETURNING *`,
      [g.id, dispatchDate.toISOString().split('T')[0], g.current_count,
       `Авто-генерирана: средно тегло ${g.current_weight_avg_kg} кг ≥ 122 кг`]
    );
    created.push(result.rows[0]);
    // Create alert
    await createAlert(db, 'info', 'logistics',
      `Предложение за експедиция: ${g.group_name} (${g.current_count} глави, ~${g.current_weight_avg_kg} кг/глава)`,
      'animal_group', g.id, 'avg_weight', parseFloat(g.current_weight_avg_kg), 122);
  }
  return ok({ created: created.length, dispatches: created });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: DISINFECTION
// ═══════════════════════════════════════════════════════════════════════════

async function disinfectionRecord(db, { vehicle_id, wash_confirmed, disinfect_confirmed, performed_by, notes }) {
  if (!vehicle_id || !performed_by) return err(400, 'vehicle_id и performed_by са задължителни');
  if (!wash_confirmed && !disinfect_confirmed) return err(400, 'Трябва да потвърдите поне измиване или дезинфекция');
  const result = await db.query(
    `INSERT INTO disinfection_logs (vehicle_id, wash_confirmed, disinfect_confirmed, performed_by, notes)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [vehicle_id, wash_confirmed || false, disinfect_confirmed || false, performed_by, notes || null]
  );
  // If both confirmed, mark vehicle clean
  if (wash_confirmed && disinfect_confirmed) {
    await db.query('UPDATE vehicles SET status = $1, last_disinfection_at = NOW() WHERE id = $2', ['clean', vehicle_id]);
  }
  return ok({ log: result.rows[0] });
}

async function disinfectionList(db, { vehicle_id, from_date, to_date, limit }) {
  let q = `SELECT dl.*, v.plate_number, p.name as performed_by_name
     FROM disinfection_logs dl
     JOIN vehicles v ON v.id = dl.vehicle_id
     JOIN personnel p ON p.id = dl.performed_by
     WHERE 1=1`;
  const params = []; let idx = 1;
  if (vehicle_id) { q += ` AND dl.vehicle_id = $${idx++}`; params.push(vehicle_id); }
  if (from_date) { q += ` AND dl.disinfection_date >= $${idx++}`; params.push(from_date); }
  if (to_date) { q += ` AND dl.disinfection_date <= $${idx++}`; params.push(to_date); }
  q += ` ORDER BY dl.disinfection_date DESC LIMIT $${idx++}`;
  params.push(limit || 100);
  const result = await db.query(q, params);
  return ok({ logs: result.rows });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: LOGISTICS REPORTS
// ═══════════════════════════════════════════════════════════════════════════

async function reportsTruckEfficiency(db, { from_date, to_date }) {
  const fd = from_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const td = to_date || new Date().toISOString().split('T')[0];
  const result = await db.query(
    `SELECT v.id, v.plate_number, v.capacity_tons, p.name as driver_name,
       COUNT(dr.id) as completed_routes,
       COALESCE(SUM(dr.total_tons), 0) as total_tons_delivered,
       COALESCE(AVG(dr.total_tons), 0) as avg_tons_per_route,
       COALESCE(SUM(dr.km_end - dr.km_start), 0) as total_km,
       COALESCE(SUM(EXTRACT(EPOCH FROM (dr.completed_at - dr.started_at)) / 3600), 0) as total_hours
     FROM vehicles v
     LEFT JOIN personnel p ON p.id = v.assigned_driver_id
     LEFT JOIN delivery_routes dr ON dr.vehicle_id = v.id AND dr.status = 'completed'
       AND dr.route_date >= $1 AND dr.route_date <= $2
     WHERE v.vehicle_type = 'feed_truck' AND v.is_active = true
     GROUP BY v.id, v.plate_number, v.capacity_tons, p.name
     ORDER BY total_tons_delivered DESC`,
    [fd, td]
  );
  // Summary
  const totals = result.rows.reduce((acc, r) => {
    acc.routes += parseInt(r.completed_routes);
    acc.tons += parseFloat(r.total_tons_delivered);
    acc.km += parseInt(r.total_km);
    return acc;
  }, { routes: 0, tons: 0, km: 0 });

  return ok({ truckEfficiency: { from: fd, to: td, trucks: result.rows, totals } });
}

async function reportsDispatchShrinkage(db, { from_date, to_date }) {
  const fd = from_date || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
  const td = to_date || new Date().toISOString().split('T')[0];
  const result = await db.query(
    `SELECT d.*, g.group_name, h.name as hall_name, v.plate_number
     FROM dispatch_orders d
     JOIN animal_groups g ON g.id = d.group_id
     LEFT JOIN halls h ON h.id = g.hall_id
     LEFT JOIN vehicles v ON v.id = d.vehicle_id
     WHERE d.status = 'delivered' AND d.shrinkage_pct IS NOT NULL
       AND d.dispatch_date >= $1 AND d.dispatch_date <= $2
     ORDER BY d.dispatch_date DESC`,
    [fd, td]
  );
  const avgShrinkage = result.rows.length > 0
    ? Math.round(result.rows.reduce((s, r) => s + parseFloat(r.shrinkage_pct), 0) / result.rows.length * 100) / 100
    : 0;
  return ok({
    dispatchShrinkage: {
      from: fd, to: td,
      dispatches: result.rows,
      count: result.rows.length,
      avgShrinkagePct: avgShrinkage
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: BIOSECURITY — ACCESS CONTROL
// ═══════════════════════════════════════════════════════════════════════════

async function accessLog(db, { personnel_id, hall_id, access_action, method, shower_confirmed, override, override_reason, override_by, notes }) {
  if (!personnel_id || !hall_id) return err(400, 'personnel_id и hall_id са задължителни');
  const act = access_action || 'entry';

  // Get hall info with sector
  const hallRes = await db.query(`SELECT h.*, s.code as sector_code, s.name as sector_name FROM halls h JOIN sectors s ON s.id = h.sector_id WHERE h.id = $1`, [hall_id]);
  if (hallRes.rows.length === 0) return err(404, 'Халето не е намерено');
  const hall = hallRes.rows[0];

  // 48h rule check (only on entry to FAR sector)
  if (act === 'entry' && hall.sector_code === 'FAR') {
    const recent = await db.query(`
      SELECT al.*, h2.name as hall_name, s2.code as sector_code FROM access_logs al
      JOIN halls h2 ON h2.id = al.hall_id JOIN sectors s2 ON s2.id = h2.sector_id
      WHERE al.personnel_id = $1 AND al.action = 'entry' AND s2.code = 'FIN'
        AND al.created_at > NOW() - INTERVAL '48 hours'
      ORDER BY al.created_at DESC LIMIT 1
    `, [personnel_id]);

    if (recent.rows.length > 0) {
      const lastFin = recent.rows[0];
      // Record violation
      const pName = (await db.query('SELECT name FROM personnel WHERE id=$1', [personnel_id])).rows[0]?.name;
      const desc = `Служител ${pName} опита влизане в ${hall.name} (Родилно) след като е бил в ${lastFin.hall_name} (Угояване) в рамките на 48 часа.`;

      await db.query(
        `INSERT INTO biosecurity_violations (personnel_id, violation_type, source_hall_id, target_hall_id, severity, description, is_overridden)
         VALUES ($1, '48h_rule', $2, $3, 'critical', $4, $5)`,
        [personnel_id, lastFin.hall_id, hall_id, desc, override ? true : false]
      );

      if (!override) {
        await createAlert(db, 'critical', 'biosecurity', desc, 'personnel', personnel_id, '48h_rule', 0, 48);
        return err(400, `48-часово правило: Служителят е бил в Угояване (${lastFin.hall_name}) на ${new Date(lastFin.created_at).toLocaleString('bg-BG')}. Достъпът до Родилно е блокиран.`);
      }
      // Override — allow but record
      if (!override_reason) return err(400, 'override_reason е задължително при override');
      await createAlert(db, 'warning', 'biosecurity', `OVERRIDE: ${desc} Причина: ${override_reason}`, 'personnel', personnel_id, '48h_rule_override', 0, 48);
    }
  }

  const result = await db.query(
    `INSERT INTO access_logs (personnel_id, hall_id, action, zone, sector_code, method, shower_confirmed, override, override_reason, override_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [personnel_id, hall_id, act, hall.biosecurity_zone, hall.sector_code, method || 'manual',
     shower_confirmed || false, override || false, override_reason || null, override_by || null, notes || null]
  );
  return ok({ log: result.rows[0] });
}

async function accessHistory(db, { personnel_id, hall_id, sector_code, from_date, to_date, limit }) {
  let q = `SELECT al.*, p.name as personnel_name, h.name as hall_name, s.name as sector_name
     FROM access_logs al JOIN personnel p ON p.id = al.personnel_id
     JOIN halls h ON h.id = al.hall_id JOIN sectors s ON s.id = h.sector_id WHERE 1=1`;
  const params = []; let idx = 1;
  if (personnel_id) { q += ` AND al.personnel_id = $${idx++}`; params.push(personnel_id); }
  if (hall_id) { q += ` AND al.hall_id = $${idx++}`; params.push(hall_id); }
  if (sector_code) { q += ` AND al.sector_code = $${idx++}`; params.push(sector_code); }
  if (from_date) { q += ` AND al.created_at >= $${idx++}`; params.push(from_date); }
  if (to_date) { q += ` AND al.created_at <= $${idx++}`; params.push(to_date); }
  q += ` ORDER BY al.created_at DESC LIMIT $${idx++}`;
  params.push(limit || 100);
  const result = await db.query(q, params);
  return ok({ logs: result.rows });
}

async function accessCheck48h(db, { personnel_id, hall_id }) {
  if (!personnel_id || !hall_id) return err(400, 'personnel_id и hall_id са задължителни');
  const hallRes = await db.query(`SELECT h.*, s.code as sector_code FROM halls h JOIN sectors s ON s.id = h.sector_id WHERE h.id = $1`, [hall_id]);
  if (hallRes.rows.length === 0) return err(404, 'Халето не е намерено');
  if (hallRes.rows[0].sector_code !== 'FAR') return ok({ allowed: true, reason: 'Не е Родилно сектор' });

  const recent = await db.query(`
    SELECT al.created_at, h2.name as hall_name FROM access_logs al
    JOIN halls h2 ON h2.id = al.hall_id JOIN sectors s2 ON s2.id = h2.sector_id
    WHERE al.personnel_id = $1 AND al.action = 'entry' AND s2.code = 'FIN'
      AND al.created_at > NOW() - INTERVAL '48 hours'
    ORDER BY al.created_at DESC LIMIT 1
  `, [personnel_id]);

  if (recent.rows.length > 0) {
    const hoursLeft = Math.ceil((new Date(recent.rows[0].created_at).getTime() + 48*3600000 - Date.now()) / 3600000);
    return ok({ allowed: false, reason: `48h правило: бил в ${recent.rows[0].hall_name} (Угояване). Остават ~${hoursLeft}ч.` });
  }
  return ok({ allowed: true, reason: 'Няма ограничения' });
}

async function accessCurrentLocations(db) {
  const result = await db.query(`
    SELECT DISTINCT ON (al.personnel_id) al.personnel_id, p.name as personnel_name, p.role,
      al.hall_id, h.name as hall_name, s.name as sector_name, al.zone, al.action, al.created_at
    FROM access_logs al JOIN personnel p ON p.id = al.personnel_id
    JOIN halls h ON h.id = al.hall_id JOIN sectors s ON s.id = h.sector_id
    WHERE al.created_at > NOW() - INTERVAL '12 hours'
    ORDER BY al.personnel_id, al.created_at DESC
  `);
  // Only show those with last action = 'entry'
  const locations = result.rows.filter(r => r.action === 'entry');
  return ok({ locations });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: BIOSECURITY VIOLATIONS
// ═══════════════════════════════════════════════════════════════════════════

async function biosecurityViolations(db, { violation_type, severity, is_resolved, from_date, to_date, limit }) {
  let q = `SELECT bv.*, p.name as personnel_name,
      h1.name as source_hall_name, h2.name as target_hall_name,
      rp.name as resolved_by_name
    FROM biosecurity_violations bv JOIN personnel p ON p.id = bv.personnel_id
    LEFT JOIN halls h1 ON h1.id = bv.source_hall_id LEFT JOIN halls h2 ON h2.id = bv.target_hall_id
    LEFT JOIN personnel rp ON rp.id = bv.resolved_by WHERE 1=1`;
  const params = []; let idx = 1;
  if (violation_type) { q += ` AND bv.violation_type = $${idx++}`; params.push(violation_type); }
  if (severity) { q += ` AND bv.severity = $${idx++}`; params.push(severity); }
  if (is_resolved !== undefined) { q += ` AND bv.is_resolved = $${idx++}`; params.push(is_resolved); }
  if (from_date) { q += ` AND bv.created_at >= $${idx++}`; params.push(from_date); }
  if (to_date) { q += ` AND bv.created_at <= $${idx++}`; params.push(to_date); }
  q += ` ORDER BY bv.created_at DESC LIMIT $${idx++}`;
  params.push(limit || 100);
  const result = await db.query(q, params);
  return ok({ violations: result.rows });
}

async function biosecurityResolve(db, { id, resolved_by, notes }) {
  if (!id) return err(400, 'ID е задължително');
  const result = await db.query(
    `UPDATE biosecurity_violations SET is_resolved = true, resolved_by = $1, resolved_at = NOW(), resolve_notes = $2
     WHERE id = $3 RETURNING *`,
    [resolved_by || null, notes || null, id]
  );
  if (result.rows.length === 0) return err(404, 'Нарушението не е намерено');
  return ok({ violation: result.rows[0] });
}

async function biosecurityHeatmap(db, { from_date, to_date }) {
  const fd = from_date || new Date(Date.now() - 7*86400000).toISOString().split('T')[0];
  const td = to_date || new Date().toISOString().split('T')[0];
  const entries = await db.query(`
    SELECT al.personnel_id, p.name as personnel_name, al.hall_id, h.name as hall_name,
      COUNT(*) FILTER (WHERE al.action = 'entry') as entries
    FROM access_logs al JOIN personnel p ON p.id = al.personnel_id
    JOIN halls h ON h.id = al.hall_id
    WHERE al.created_at >= $1 AND al.created_at <= ($2::date + 1)
    GROUP BY al.personnel_id, p.name, al.hall_id, h.name
    ORDER BY entries DESC
  `, [fd, td]);

  const violations = await db.query(`
    SELECT bv.personnel_id, p.name as personnel_name, bv.target_hall_id as hall_id, h.name as hall_name,
      COUNT(*) as violation_count
    FROM biosecurity_violations bv JOIN personnel p ON p.id = bv.personnel_id
    LEFT JOIN halls h ON h.id = bv.target_hall_id
    WHERE bv.created_at >= $1 AND bv.created_at <= ($2::date + 1)
    GROUP BY bv.personnel_id, p.name, bv.target_hall_id, h.name
  `, [fd, td]);

  return ok({ heatmap: { from: fd, to: td, entries: entries.rows, violations: violations.rows } });
}

async function biosecuritySummary(db, { from_date, to_date }) {
  const fd = from_date || new Date().toISOString().split('T')[0];
  const td = to_date || new Date().toISOString().split('T')[0];
  const byType = await db.query(`
    SELECT violation_type, COUNT(*) as count FROM biosecurity_violations
    WHERE created_at >= $1 AND created_at <= ($2::date + 1) GROUP BY violation_type
  `, [fd, td]);
  const bySeverity = await db.query(`
    SELECT severity, COUNT(*) as count FROM biosecurity_violations
    WHERE created_at >= $1 AND created_at <= ($2::date + 1) GROUP BY severity
  `, [fd, td]);
  const unresolved = await db.query(`SELECT COUNT(*) FROM biosecurity_violations WHERE is_resolved = false`);
  return ok({ summary: { from: fd, to: td, byType: byType.rows, bySeverity: bySeverity.rows, unresolved: parseInt(unresolved.rows[0].count) } });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: MEDICINE WITHDRAWALS
// ═══════════════════════════════════════════════════════════════════════════

async function medicineSetWithdrawal(db, { medicine_id, withdrawal_days, applies_to, notes }) {
  if (!medicine_id || withdrawal_days === undefined) return err(400, 'medicine_id и withdrawal_days са задължителни');
  const result = await db.query(
    `INSERT INTO medicine_withdrawals (medicine_id, withdrawal_days, applies_to, notes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (medicine_id) DO UPDATE SET withdrawal_days = $2, applies_to = $3, notes = $4, updated_at = NOW()
     RETURNING *`,
    [medicine_id, withdrawal_days, applies_to || 'all', notes || null]
  );
  return ok({ withdrawal: result.rows[0] });
}

async function medicineWithdrawals(db) {
  const result = await db.query(`
    SELECT mw.*, mc.name as medicine_name, mc.name_bg as medicine_name_bg
    FROM medicine_withdrawals mw JOIN medicine_catalog mc ON mc.id = mw.medicine_id
    ORDER BY mc.name
  `);
  return ok({ withdrawals: result.rows });
}

async function withdrawalActive(db, { group_id, animal_id, status }) {
  let q = `SELECT aw.*, mc.name as medicine_name, mc.name_bg as medicine_name_bg,
      g.group_name, a.ear_tag,
      (aw.end_date - CURRENT_DATE) as days_remaining
    FROM active_withdrawals aw
    JOIN medicine_catalog mc ON mc.id = aw.medicine_id
    LEFT JOIN animal_groups g ON g.id = aw.group_id
    LEFT JOIN animals a ON a.id = aw.animal_id
    WHERE 1=1`;
  const params = []; let idx = 1;
  const st = status || 'active';
  q += ` AND aw.status = $${idx++}`; params.push(st);
  if (group_id) { q += ` AND aw.group_id = $${idx++}`; params.push(group_id); }
  if (animal_id) { q += ` AND aw.animal_id = $${idx++}`; params.push(animal_id); }
  q += ' ORDER BY aw.end_date ASC';
  const result = await db.query(q, params);
  return ok({ activeWithdrawals: result.rows });
}

async function withdrawalClear(db, { id, cleared_by, clear_reason }) {
  if (!id || !cleared_by) return err(400, 'id и cleared_by са задължителни');
  if (!clear_reason) return err(400, 'clear_reason е задължително');
  const result = await db.query(
    `UPDATE active_withdrawals SET status = 'cleared', cleared_by = $1, cleared_at = NOW(), clear_reason = $2
     WHERE id = $3 AND status = 'active' RETURNING *`,
    [cleared_by, clear_reason, id]
  );
  if (result.rows.length === 0) return err(404, 'Карентен срок не е намерен или не е активен');
  return ok({ withdrawal: result.rows[0] });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: HALL HYGIENE PAUSES
// ═══════════════════════════════════════════════════════════════════════════

async function hallStartHygiene(db, { hall_id, required_days, notes }) {
  if (!hall_id) return err(400, 'hall_id е задължително');
  // Check no active pause
  const existing = await db.query(`SELECT id FROM hall_hygiene_pauses WHERE hall_id = $1 AND status NOT IN ('ready', 'cancelled')`, [hall_id]);
  if (existing.rows.length > 0) return err(400, 'Халето вече е в хигиенна пауза');
  const days = required_days || 5;
  const readyDate = new Date();
  readyDate.setDate(readyDate.getDate() + days);
  const result = await db.query(
    `INSERT INTO hall_hygiene_pauses (hall_id, required_days, ready_date, notes)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [hall_id, days, readyDate.toISOString().split('T')[0], notes || null]
  );
  return ok({ pause: result.rows[0] });
}

async function hallConfirmHygiene(db, { id, step, confirmed_by }) {
  if (!id || !step || !confirmed_by) return err(400, 'id, step и confirmed_by са задължителни');
  const pause = await db.query('SELECT * FROM hall_hygiene_pauses WHERE id = $1', [id]);
  if (pause.rows.length === 0) return err(404, 'Хигиенна пауза не е намерена');
  const p = pause.rows[0];

  if (step === 'cleaning') {
    await db.query(`UPDATE hall_hygiene_pauses SET cleaning_confirmed = true, cleaning_confirmed_at = NOW(), cleaning_confirmed_by = $1, status = 'cleaning_done' WHERE id = $2`, [confirmed_by, id]);
  } else if (step === 'disinfection') {
    await db.query(`UPDATE hall_hygiene_pauses SET disinfection_confirmed = true, disinfection_confirmed_at = NOW(), disinfection_confirmed_by = $1, status = 'disinfection_done' WHERE id = $2`, [confirmed_by, id]);
  } else if (step === 'ready') {
    // Check if both cleaning and disinfection confirmed and days elapsed
    if (!p.cleaning_confirmed || !p.disinfection_confirmed) return err(400, 'Измиване и дезинфекция трябва да бъдат потвърдени първо');
    const daysPassed = Math.floor((Date.now() - new Date(p.start_date).getTime()) / 86400000);
    if (daysPassed < p.required_days) return err(400, `Минимум ${p.required_days} дни. Изминали: ${daysPassed} дни.`);
    await db.query(`UPDATE hall_hygiene_pauses SET status = 'ready', completed_at = NOW(), completed_by = $1 WHERE id = $2`, [confirmed_by, id]);
  } else {
    return err(400, 'step трябва да е: cleaning, disinfection или ready');
  }
  const updated = await db.query('SELECT * FROM hall_hygiene_pauses WHERE id = $1', [id]);
  return ok({ pause: updated.rows[0] });
}

async function hallHygieneStatus(db, { hall_id, status, limit }) {
  let q = `SELECT hp.*, h.name as hall_name, s.name as sector_name,
      cp.name as cleaning_by_name, dp.name as disinfection_by_name, comp.name as completed_by_name
    FROM hall_hygiene_pauses hp JOIN halls h ON h.id = hp.hall_id JOIN sectors s ON s.id = h.sector_id
    LEFT JOIN personnel cp ON cp.id = hp.cleaning_confirmed_by
    LEFT JOIN personnel dp ON dp.id = hp.disinfection_confirmed_by
    LEFT JOIN personnel comp ON comp.id = hp.completed_by
    WHERE 1=1`;
  const params = []; let idx = 1;
  if (hall_id) { q += ` AND hp.hall_id = $${idx++}`; params.push(hall_id); }
  if (status) { q += ` AND hp.status = $${idx++}`; params.push(status); }
  q += ` ORDER BY hp.created_at DESC LIMIT $${idx++}`;
  params.push(limit || 50);
  const result = await db.query(q, params);
  return ok({ pauses: result.rows });
}

async function hallCancelHygiene(db, { id, cancel_reason, cancelled_by }) {
  if (!id || !cancel_reason) return err(400, 'id и cancel_reason са задължителни');
  const result = await db.query(
    `UPDATE hall_hygiene_pauses SET status = 'cancelled', cancel_reason = $1, completed_at = NOW(), completed_by = $2
     WHERE id = $3 AND status NOT IN ('ready', 'cancelled') RETURNING *`,
    [cancel_reason, cancelled_by || null, id]
  );
  if (result.rows.length === 0) return err(404, 'Хигиенна пауза не е намерена или вече е завършена');
  return ok({ pause: result.rows[0] });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5: KPI BONUSES
// ═══════════════════════════════════════════════════════════════════════════

async function bonusRulesList(db) {
  const result = await db.query('SELECT * FROM bonus_rules ORDER BY id');
  return ok({ rules: result.rows });
}

async function bonusRulesUpsert(db, { id, kpi_name, kpi_label, target_value, operator, bonus_pct, applies_to_roles, applies_to_sector_code, description, is_active }) {
  if (id) {
    const fields = []; const params = []; let idx = 1;
    if (kpi_label !== undefined) { fields.push(`kpi_label = $${idx++}`); params.push(kpi_label); }
    if (target_value !== undefined) { fields.push(`target_value = $${idx++}`); params.push(target_value); }
    if (operator !== undefined) { fields.push(`operator = $${idx++}`); params.push(operator); }
    if (bonus_pct !== undefined) { fields.push(`bonus_pct = $${idx++}`); params.push(bonus_pct); }
    if (applies_to_roles !== undefined) { fields.push(`applies_to_roles = $${idx++}`); params.push(applies_to_roles); }
    if (applies_to_sector_code !== undefined) { fields.push(`applies_to_sector_code = $${idx++}`); params.push(applies_to_sector_code); }
    if (description !== undefined) { fields.push(`description = $${idx++}`); params.push(description); }
    if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); params.push(is_active); }
    fields.push(`updated_at = NOW()`);
    if (fields.length <= 1) return err(400, 'Няма полета за обновяване');
    params.push(id);
    const result = await db.query(`UPDATE bonus_rules SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    return ok({ rule: result.rows[0] });
  }
  if (!kpi_name || !target_value || !bonus_pct) return err(400, 'kpi_name, target_value и bonus_pct са задължителни');
  const result = await db.query(
    `INSERT INTO bonus_rules (kpi_name, kpi_label, target_value, operator, bonus_pct, applies_to_roles, applies_to_sector_code, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (kpi_name) DO UPDATE
     SET kpi_label=$2, target_value=$3, operator=$4, bonus_pct=$5, applies_to_roles=$6, applies_to_sector_code=$7, description=$8, updated_at=NOW()
     RETURNING *`,
    [kpi_name, kpi_label || kpi_name, target_value, operator || 'lt', bonus_pct,
     applies_to_roles || '', applies_to_sector_code || null, description || null]
  );
  return ok({ rule: result.rows[0] });
}

async function bonusCalculate(db, { month_key }) {
  if (!month_key) return err(400, 'month_key е задължително (YYYY-MM)');
  // Check for existing
  const existing = await db.query('SELECT COUNT(*) FROM bonus_calculations WHERE month_key = $1', [month_key]);
  if (parseInt(existing.rows[0].count) > 0) {
    // Delete previous for recalculation
    await db.query('DELETE FROM bonus_calculations WHERE month_key = $1 AND status = $2', [month_key, 'calculated']);
  }

  const rules = await db.query('SELECT * FROM bonus_rules WHERE is_active = true');
  const monthStart = `${month_key}-01`;
  const nextMonth = new Date(monthStart);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const monthEnd = nextMonth.toISOString().split('T')[0];

  let totalCalcs = 0;
  const results = [];

  for (const rule of rules.rows) {
    let kpiValue = null;

    // Calculate KPI based on rule type
    if (rule.kpi_name === 'survival_farrowing') {
      const litRes = await db.query(`
        SELECT COALESCE(SUM(born_alive), 0) as total_born, COALESCE(SUM(weaned_count), 0) as total_weaned
        FROM litters WHERE birth_date >= $1 AND birth_date < $2 AND weaned_count IS NOT NULL
      `, [monthStart, monthEnd]);
      const born = parseFloat(litRes.rows[0].total_born);
      const weaned = parseFloat(litRes.rows[0].total_weaned);
      if (born > 0) kpiValue = Math.round((born - weaned) / born * 10000) / 100; // mortality %
    } else if (rule.kpi_name === 'weaning_weight') {
      const wRes = await db.query(`
        SELECT AVG(CASE WHEN weaned_count > 0 THEN weaning_weight_kg / weaned_count ELSE NULL END) as avg_weight
        FROM litters WHERE weaning_date >= $1 AND weaning_date < $2 AND weaned_count > 0
      `, [monthStart, monthEnd]);
      if (wRes.rows[0].avg_weight) kpiValue = Math.round(parseFloat(wRes.rows[0].avg_weight) * 100) / 100;
    } else if (rule.kpi_name === 'fcr_finishing') {
      const fcrRes = await db.query(`SELECT kpi_value FROM kpi_snapshots WHERE kpi_name = 'fcr_finishing' AND snapshot_date >= $1 AND snapshot_date < $2 ORDER BY snapshot_date DESC LIMIT 1`, [monthStart, monthEnd]);
      if (fcrRes.rows.length > 0) kpiValue = parseFloat(fcrRes.rows[0].kpi_value);
    }

    if (kpiValue === null) {
      results.push({ rule: rule.kpi_name, kpiValue: null, targetMet: false, beneficiaries: 0, totalBonus: 0 });
      continue;
    }

    // Check if target met
    const targetMet = rule.operator === 'lt' ? kpiValue < parseFloat(rule.target_value)
                    : rule.operator === 'gt' ? kpiValue > parseFloat(rule.target_value)
                    : false;

    if (!targetMet) {
      results.push({ rule: rule.kpi_name, kpiValue, targetMet: false, beneficiaries: 0, totalBonus: 0 });
      continue;
    }

    // Find eligible personnel
    const roles = (rule.applies_to_roles || '').split(',').map(r => r.trim()).filter(Boolean);
    let personnelQ = `SELECT DISTINCT p.id, p.name, p.role, st.base_salary_eur, ph.hall_id
      FROM personnel p
      JOIN salary_templates st ON st.role = p.role AND st.is_active = true
      LEFT JOIN personnel_halls ph ON ph.personnel_id = p.id
      LEFT JOIN halls h ON h.id = ph.hall_id
      LEFT JOIN sectors s ON s.id = h.sector_id
      WHERE p.is_active = true`;
    const pParams = [];
    let pIdx = 1;
    if (roles.length > 0) { personnelQ += ` AND p.role = ANY($${pIdx++})`; pParams.push(roles); }
    if (rule.applies_to_sector_code) { personnelQ += ` AND s.code = $${pIdx++}`; pParams.push(rule.applies_to_sector_code); }

    const personnel = await db.query(personnelQ, pParams);
    let ruleTotal = 0;
    for (const p of personnel.rows) {
      const bonusAmt = Math.round(parseFloat(p.base_salary_eur) * parseFloat(rule.bonus_pct) / 100 * 100) / 100;
      await db.query(
        `INSERT INTO bonus_calculations (month_key, personnel_id, bonus_rule_id, kpi_actual_value, target_value, target_met, base_salary_eur, bonus_pct, bonus_amount_eur, hall_id)
         VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, $9)`,
        [month_key, p.id, rule.id, kpiValue, rule.target_value, p.base_salary_eur, rule.bonus_pct, bonusAmt, p.hall_id || null]
      );
      ruleTotal += bonusAmt;
      totalCalcs++;
    }
    results.push({ rule: rule.kpi_name, kpiValue, targetMet: true, beneficiaries: personnel.rows.length, totalBonus: Math.round(ruleTotal * 100) / 100 });
  }

  return ok({ month: month_key, calculations: totalCalcs, results });
}

async function bonusResults(db, { month_key }) {
  if (!month_key) return err(400, 'month_key е задължително');
  const result = await db.query(`
    SELECT bc.*, p.name as personnel_name, p.role, br.kpi_name, br.kpi_label, h.name as hall_name
    FROM bonus_calculations bc
    JOIN personnel p ON p.id = bc.personnel_id
    JOIN bonus_rules br ON br.id = bc.bonus_rule_id
    LEFT JOIN halls h ON h.id = bc.hall_id
    WHERE bc.month_key = $1
    ORDER BY br.kpi_name, p.name
  `, [month_key]);
  // Summary
  const summary = await db.query(`
    SELECT br.kpi_name, br.kpi_label, bc.kpi_actual_value, bc.target_value,
      COUNT(*) as beneficiaries, SUM(bc.bonus_amount_eur) as total_bonus, bc.status
    FROM bonus_calculations bc JOIN bonus_rules br ON br.id = bc.bonus_rule_id
    WHERE bc.month_key = $1 AND bc.target_met = true
    GROUP BY br.kpi_name, br.kpi_label, bc.kpi_actual_value, bc.target_value, bc.status
  `, [month_key]);
  return ok({ month: month_key, details: result.rows, summary: summary.rows });
}

async function bonusApprove(db, { id, month_key, approved_by }) {
  if (!approved_by) return err(400, 'approved_by е задължително');
  if (!id && !month_key) return err(400, 'id или month_key е задължително');
  if (id) {
    // Individual approve
    await db.query(`UPDATE bonus_calculations SET status = 'approved', approved_by = $1, approved_at = NOW() WHERE id = $2 AND status = 'calculated'`, [approved_by, id]);
    const rec = await db.query('SELECT month_key FROM bonus_calculations WHERE id = $1', [id]);
    month_key = rec.rows[0]?.month_key;
    if (!month_key) return ok({ approved: 1, totalExpense: 0 });
  } else {
    await db.query(`UPDATE bonus_calculations SET status = 'approved', approved_by = $1, approved_at = NOW() WHERE month_key = $2 AND status = 'calculated'`, [approved_by, month_key]);
  }
  // Create expense entries for approved bonuses
  const bonuses = await db.query(`
    SELECT bc.*, p.name as pname, br.kpi_label FROM bonus_calculations bc
    JOIN personnel p ON p.id = bc.personnel_id JOIN bonus_rules br ON br.id = bc.bonus_rule_id
    WHERE bc.month_key = $1 AND bc.status = 'approved' AND bc.target_met = true
  `, [month_key]);
  let totalExpense = 0;
  for (const b of bonuses.rows) {
    totalExpense += parseFloat(b.bonus_amount_eur);
  }
  if (totalExpense > 0) {
    await db.query(
      `INSERT INTO expense_entries (entry_date, month_key, category, subcategory, description, amount_eur, created_by)
       VALUES (CURRENT_DATE, $1, 'salary', 'bonus', $2, $3, $4)`,
      [month_key, `KPI Бонуси за ${month_key}: ${bonuses.rows.length} служители`, totalExpense, approved_by]
    );
  }
  return ok({ approved: bonuses.rows.length, totalExpense: Math.round(totalExpense * 100) / 100 });
}

async function bonusHistory(db, { limit }) {
  const result = await db.query(`
    SELECT bc.*, p.name as personnel_name, p.role, br.kpi_name, br.kpi_label
    FROM bonus_calculations bc
    JOIN personnel p ON p.id = bc.personnel_id
    JOIN bonus_rules br ON br.id = bc.bonus_rule_id
    ORDER BY bc.month_key DESC, br.kpi_name, p.name
    LIMIT $1
  `, [limit || 200]);
  return ok({ history: result.rows });
}

async function bonusSummary(db, { month_key }) {
  const mk = month_key || new Date().toISOString().substring(0, 7);
  const result = await db.query(`
    SELECT br.kpi_name, br.kpi_label, br.target_value, br.operator, br.bonus_pct,
      bc.kpi_actual_value, bc.target_met, COUNT(bc.id) as beneficiaries,
      COALESCE(SUM(bc.bonus_amount_eur), 0) as total_bonus, bc.status
    FROM bonus_rules br
    LEFT JOIN bonus_calculations bc ON bc.bonus_rule_id = br.id AND bc.month_key = $1
    WHERE br.is_active = true
    GROUP BY br.kpi_name, br.kpi_label, br.target_value, br.operator, br.bonus_pct, bc.kpi_actual_value, bc.target_met, bc.status
    ORDER BY br.kpi_name
  `, [mk]);
  return ok({ month: mk, summary: result.rows });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6: TRACEABILITY
// ═══════════════════════════════════════════════════════════════════════════

async function traceabilityGenerate(db, { group_id, generated_by }) {
  if (!group_id) return err(400, 'group_id е задължително');
  const group = await db.query(`SELECT g.*, h.name as hall_name, s.name as sector_name, s.code as sector_code
    FROM animal_groups g LEFT JOIN halls h ON h.id = g.hall_id LEFT JOIN sectors s ON s.id = h.sector_id
    WHERE g.id = $1`, [group_id]);
  if (group.rows.length === 0) return err(404, 'Групата не е намерена');
  const g = group.rows[0];

  // 1. Batch info
  const batch = { group_name: g.group_name, hall: g.hall_name, sector: g.sector_name, entry_date: g.entry_date, exit_date: g.exit_date, entry_count: g.entry_count, exit_count: g.exit_count, entry_weight: g.entry_weight_avg_kg, exit_weight: g.exit_weight_avg_kg };

  // 2. Genetics
  let genetics = [];
  try {
    const litIds = g.source_litter_ids || [];
    if (litIds.length > 0) {
      const lits = await db.query(`SELECT l.*, a.ear_tag as sow_ear_tag, a.breed FROM litters l JOIN animals a ON a.id = l.birth_sow_id WHERE l.id = ANY($1)`, [litIds]);
      genetics = lits.rows.map(l => ({ litter_id: l.id, sow_ear_tag: l.sow_ear_tag, breed: l.breed, parity: l.parity_number, born_alive: l.born_alive, birth_date: l.birth_date }));
    }
  } catch {}

  // 3. Feed — silo in hall + recipe
  let feed = {};
  try {
    const siloRes = await db.query(`SELECT si.*, fr.name as recipe_name, fr.cost_per_ton FROM silos si LEFT JOIN feed_recipes fr ON fr.id = si.recipe_id WHERE si.hall_id = $1`, [g.hall_id]);
    if (siloRes.rows.length > 0) {
      const silo = siloRes.rows[0];
      feed = { silo_name: silo.silo_name, recipe: silo.recipe_name, cost_per_ton: silo.cost_per_ton };
      if (silo.recipe_id) {
        const comps = await db.query(`SELECT fc.name, fc.name_bg, frc.percentage FROM feed_recipe_components frc JOIN feed_components fc ON fc.id = frc.component_id WHERE frc.recipe_id = $1`, [silo.recipe_id]);
        feed.components = comps.rows;
      }
    }
  } catch {}

  // 4. Vet events
  let vetEvents = [];
  try {
    const evts = await db.query(`SELECT e.*, p.name as performed_by_name FROM events e LEFT JOIN personnel p ON p.id = e.performed_by WHERE (e.group_id = $1 OR e.hall_id = $2) AND e.event_type IN ('vaccination','treatment','disease') ORDER BY e.event_date`, [group_id, g.hall_id]);
    vetEvents = evts.rows.map(e => ({ type: e.event_type, date: e.event_date, performed_by: e.performed_by_name, details: e.details }));
  } catch {}

  // 5. Active withdrawals
  let withdrawals = [];
  try {
    const aw = await db.query(`SELECT aw.*, mc.name as medicine_name FROM active_withdrawals aw JOIN medicine_catalog mc ON mc.id = aw.medicine_id WHERE aw.group_id = $1`, [group_id]);
    withdrawals = aw.rows;
  } catch {}

  // 6. Transport (dispatch)
  let transport = {};
  try {
    const disp = await db.query(`SELECT d.*, v.plate_number, p.name as driver_name FROM dispatch_orders d LEFT JOIN vehicles v ON v.id = d.vehicle_id LEFT JOIN personnel p ON p.id = d.driver_id WHERE d.group_id = $1 AND d.status = 'delivered' ORDER BY d.dispatch_date DESC LIMIT 1`, [group_id]);
    if (disp.rows.length > 0) {
      const dd = disp.rows[0];
      transport = { dispatch_date: dd.dispatch_date, vehicle: dd.plate_number, driver: dd.driver_name, weight_loading: dd.weight_at_loading_kg, weight_destination: dd.weight_at_destination_kg, shrinkage_pct: dd.shrinkage_pct, buyer: dd.buyer_name, destination: dd.destination };
    }
  } catch {}

  const data = { batch, genetics, feed, vetEvents, withdrawals, transport, generated_at: new Date().toISOString() };

  // Upsert record
  await db.query(
    `INSERT INTO traceability_records (group_id, dispatch_id, data, generated_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (group_id) DO UPDATE SET data = $3, generated_by = $4, generated_at = NOW()`,
    [group_id, transport.dispatch_id || null, JSON.stringify(data), generated_by || null]
  );

  return ok({ traceability: data });
}

async function traceabilityGet(db, { group_id }) {
  if (!group_id) return err(400, 'group_id е задължително');
  const result = await db.query(`SELECT tr.*, g.group_name FROM traceability_records tr JOIN animal_groups g ON g.id = tr.group_id WHERE tr.group_id = $1`, [group_id]);
  if (result.rows.length === 0) return err(404, 'Запис за проследимост не е намерен');
  return ok({ record: result.rows[0] });
}

async function traceabilityList(db, { limit }) {
  const result = await db.query(`SELECT tr.id, tr.group_id, g.group_name, tr.generated_at, p.name as generated_by_name
    FROM traceability_records tr JOIN animal_groups g ON g.id = tr.group_id
    LEFT JOIN personnel p ON p.id = tr.generated_by ORDER BY tr.generated_at DESC LIMIT $1`, [limit || 50]);
  return ok({ records: result.rows });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6: REGULATORY DOCUMENTS
// ═══════════════════════════════════════════════════════════════════════════

async function regulatoryGenerate(db, { document_type, from_date, to_date, dispatch_id, generated_by }) {
  if (!document_type) return err(400, 'document_type е задължително');

  // Generate reference number
  const year = new Date().getFullYear();
  const prefix = document_type === 'vetis_certificate' ? 'VET' : document_type === 'animal_register' ? 'REG' : 'DNV';
  const countRes = await db.query(`SELECT COUNT(*) FROM regulatory_documents WHERE document_type = $1 AND reference_number LIKE $2`, [document_type, `${prefix}-${year}-%`]);
  const seq = parseInt(countRes.rows[0].count) + 1;
  const refNum = `${prefix}-${year}-${String(seq).padStart(4, '0')}`;

  let title = '', data = {}, periodFrom = from_date, periodTo = to_date, relType = null, relId = null;

  if (document_type === 'diary_no1') {
    if (!from_date || !to_date) return err(400, 'from_date и to_date са задължителни за Дневник №1');
    title = `Електронен Дневник №1 — ${from_date} до ${to_date}`;

    // Vaccinations
    const vacc = await db.query(`SELECT e.event_date, h.name as hall_name, e.details, p.name as performed_by FROM events e LEFT JOIN halls h ON h.id = e.hall_id LEFT JOIN personnel p ON p.id = e.performed_by WHERE e.event_type = 'vaccination' AND e.event_date >= $1 AND e.event_date <= $2 ORDER BY e.event_date`, [from_date, to_date]);
    // Disinfections
    const disinf = await db.query(`SELECT dl.disinfection_date, v.plate_number, p.name as performed_by, dl.wash_confirmed, dl.disinfect_confirmed FROM disinfection_logs dl JOIN vehicles v ON v.id = dl.vehicle_id JOIN personnel p ON p.id = dl.performed_by WHERE dl.disinfection_date >= $1 AND dl.disinfection_date <= $2 ORDER BY dl.disinfection_date`, [from_date, to_date]);
    // Mortality
    const mort = await db.query(`SELECT e.event_date, h.name as hall_name, a.category, e.details FROM events e LEFT JOIN halls h ON h.id = e.hall_id LEFT JOIN animals a ON a.id = e.animal_id WHERE e.event_type = 'death' AND e.event_date >= $1 AND e.event_date <= $2 ORDER BY e.event_date`, [from_date, to_date]);
    // Treatments
    const treat = await db.query(`SELECT e.event_date, h.name as hall_name, e.details, p.name as performed_by FROM events e LEFT JOIN halls h ON h.id = e.hall_id LEFT JOIN personnel p ON p.id = e.performed_by WHERE e.event_type = 'treatment' AND e.event_date >= $1 AND e.event_date <= $2 ORDER BY e.event_date`, [from_date, to_date]);
    // Transfers
    const trans = await db.query(`SELECT e.event_date, h.name as hall_name, e.details, p.name as performed_by FROM events e LEFT JOIN halls h ON h.id = e.hall_id LEFT JOIN personnel p ON p.id = e.performed_by WHERE e.event_type = 'transfer' AND e.event_date >= $1 AND e.event_date <= $2 ORDER BY e.event_date`, [from_date, to_date]);

    data = {
      vaccinations: vacc.rows, disinfections: disinf.rows, mortality: mort.rows,
      treatments: treat.rows, transfers: trans.rows,
      totals: { vaccinations: vacc.rows.length, disinfections: disinf.rows.length, mortality: mort.rows.length, treatments: treat.rows.length, transfers: trans.rows.length }
    };

  } else if (document_type === 'vetis_certificate') {
    if (!dispatch_id) return err(400, 'dispatch_id е задължително за ВЕТИС сертификат');
    const disp = await db.query(`SELECT d.*, g.group_name, g.hall_id, h.name as hall_name FROM dispatch_orders d JOIN animal_groups g ON g.id = d.group_id LEFT JOIN halls h ON h.id = g.hall_id WHERE d.id = $1`, [dispatch_id]);
    if (disp.rows.length === 0) return err(404, 'Експедиция не е намерена');
    const dd = disp.rows[0];
    title = `ВЕТИС Сертификат — ${dd.group_name} (Експедиция #${dispatch_id})`;
    relType = 'dispatch'; relId = dispatch_id;
    periodFrom = dd.dispatch_date; periodTo = dd.dispatch_date;

    // Withdrawal check
    const aw = await db.query(`SELECT aw.*, mc.name as medicine_name FROM active_withdrawals aw JOIN medicine_catalog mc ON mc.id = aw.medicine_id WHERE aw.group_id = $1 AND aw.status = 'active'`, [dd.group_id]);
    const hasActiveWithdrawal = aw.rows.length > 0;

    // Recent vaccinations
    const vacc = await db.query(`SELECT e.event_date, e.details FROM events e WHERE (e.group_id = $1 OR e.hall_id = $2) AND e.event_type = 'vaccination' ORDER BY e.event_date DESC LIMIT 10`, [dd.group_id, dd.hall_id]);

    data = {
      dispatch: { id: dd.id, date: dd.dispatch_date, group: dd.group_name, hall: dd.hall_name, head_count: dd.head_count, weight_loading: dd.weight_at_loading_kg, buyer: dd.buyer_name, destination: dd.destination },
      healthStatus: { withdrawalFree: !hasActiveWithdrawal, activeWithdrawals: aw.rows, certification: hasActiveWithdrawal ? `ВНИМАНИЕ: Активен карентен срок за ${aw.rows.map(w => w.medicine_name).join(', ')}` : 'Групата е свободна от карентни срокове' },
      vaccinations: vacc.rows
    };

  } else if (document_type === 'animal_register') {
    if (!from_date || !to_date) return err(400, 'from_date и to_date са задължителни за ИАСРЖ регистър');
    title = `ИАСРЖ Регистър — ${from_date} до ${to_date}`;

    // Initial state — count animals by category before start date
    const categories = ['gilt', 'sow', 'boar', 'weaner', 'finisher'];
    const initial = {};
    for (const cat of categories) {
      const res = await db.query(`SELECT COUNT(*) FROM animals WHERE category = $1 AND entry_date < $2 AND (cull_date IS NULL OR cull_date >= $2)`, [cat, from_date]);
      initial[cat] = parseInt(res.rows[0].count);
    }

    // Movements during period
    const born = await db.query(`SELECT COUNT(*) FROM litters WHERE birth_date >= $1 AND birth_date <= $2`, [from_date, to_date]);
    const sold = await db.query(`SELECT COALESCE(SUM(head_count), 0) as total FROM sales WHERE sale_date >= $1 AND sale_date <= $2`, [from_date, to_date]);
    const died = await db.query(`SELECT COUNT(*) FROM events WHERE event_type = 'death' AND event_date >= $1 AND event_date <= $2`, [from_date, to_date]);
    const culled = await db.query(`SELECT COUNT(*) FROM animals WHERE cull_date >= $1 AND cull_date <= $2 AND cull_reason != 'death'`, [from_date, to_date]);

    // Final state
    const final = {};
    for (const cat of categories) {
      const res = await db.query(`SELECT COUNT(*) FROM animals WHERE category = $1 AND entry_date <= $2 AND (cull_date IS NULL OR cull_date > $2)`, [cat, to_date]);
      final[cat] = parseInt(res.rows[0].count);
    }

    data = {
      initial, final,
      movements: { born: parseInt(born.rows[0].count), sold: parseInt(sold.rows[0].total), died: parseInt(died.rows[0].count), culled: parseInt(culled.rows[0].count) },
      balance: { initial_total: Object.values(initial).reduce((a, b) => a + b, 0), final_total: Object.values(final).reduce((a, b) => a + b, 0) }
    };
  } else {
    return err(400, 'Невалиден document_type. Валидни: diary_no1, vetis_certificate, animal_register');
  }

  const result = await db.query(
    `INSERT INTO regulatory_documents (document_type, reference_number, title, period_from, period_to, related_entity_type, related_entity_id, data, generated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [document_type, refNum, title, periodFrom, periodTo, relType, relId, JSON.stringify(data), generated_by || null]
  );
  return ok({ document: result.rows[0] });
}

async function regulatoryList(db, { document_type, status, limit }) {
  let q = `SELECT rd.*, p.name as generated_by_name FROM regulatory_documents rd LEFT JOIN personnel p ON p.id = rd.generated_by WHERE 1=1`;
  const params = []; let idx = 1;
  if (document_type) { q += ` AND rd.document_type = $${idx++}`; params.push(document_type); }
  if (status) { q += ` AND rd.status = $${idx++}`; params.push(status); }
  q += ` ORDER BY rd.created_at DESC LIMIT $${idx++}`;
  params.push(limit || 50);
  const result = await db.query(q, params);
  return ok({ documents: result.rows });
}

async function regulatoryGet(db, { id }) {
  if (!id) return err(400, 'id е задължително');
  const result = await db.query(`SELECT rd.*, p.name as generated_by_name, fp.name as finalized_by_name FROM regulatory_documents rd LEFT JOIN personnel p ON p.id = rd.generated_by LEFT JOIN personnel fp ON fp.id = rd.finalized_by WHERE rd.id = $1`, [id]);
  if (result.rows.length === 0) return err(404, 'Документът не е намерен');
  return ok({ document: result.rows[0] });
}

async function regulatoryFinalize(db, { id, finalized_by }) {
  if (!id) return err(400, 'id е задължително');
  const doc = await db.query('SELECT * FROM regulatory_documents WHERE id = $1', [id]);
  if (doc.rows.length === 0) return err(404, 'Документът не е намерен');
  if (doc.rows[0].status !== 'draft') return err(400, 'Само чернови (draft) могат да бъдат финализирани');
  const result = await db.query(
    `UPDATE regulatory_documents SET status = 'final', finalized_by = $1, finalized_at = NOW() WHERE id = $2 RETURNING *`,
    [finalized_by || null, id]
  );
  return ok({ document: result.rows[0] });
}

async function regulatorySubmit(db, { id }) {
  if (!id) return err(400, 'id е задължително');
  const doc = await db.query('SELECT * FROM regulatory_documents WHERE id = $1', [id]);
  if (doc.rows.length === 0) return err(404, 'Документът не е намерен');
  if (doc.rows[0].status !== 'final') return err(400, 'Само финализирани документи могат да бъдат маркирани като подадени');
  const result = await db.query(`UPDATE regulatory_documents SET status = 'submitted', submitted_at = NOW() WHERE id = $1 RETURNING *`, [id]);
  return ok({ document: result.rows[0] });
}

async function regulatoryExport(db, { id }) {
  if (!id) return err(400, 'id е задължително');
  const doc = await db.query('SELECT * FROM regulatory_documents WHERE id = $1', [id]);
  if (doc.rows.length === 0) return err(404, 'Документът не е намерен');
  const d = doc.rows[0];
  const data = typeof d.data === 'string' ? JSON.parse(d.data) : d.data;

  const esc = v => { const s = String(v ?? ''); return s.includes(';') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s; };
  const csvRow = cols => cols.map(esc).join(';');
  const rows = [];

  rows.push(csvRow([d.title]));
  rows.push(csvRow([`Реф. №: ${d.reference_number}`, `Статус: ${d.status}`, `Период: ${d.period_from} — ${d.period_to}`]));
  rows.push('');

  if (d.document_type === 'diary_no1') {
    rows.push(csvRow(['=== ВАКСИНАЦИИ ===']));
    rows.push(csvRow(['Дата', 'Хале', 'Детайли', 'Извършил']));
    for (const v of (data.vaccinations || [])) rows.push(csvRow([v.event_date?.substring(0, 10), v.hall_name, JSON.stringify(v.details || {}), v.performed_by]));
    rows.push('');
    rows.push(csvRow(['=== ДЕЗИНФЕКЦИИ ===']));
    rows.push(csvRow(['Дата', 'МПС', 'Измиване', 'Дезинфекция', 'Извършил']));
    for (const d2 of (data.disinfections || [])) rows.push(csvRow([d2.disinfection_date?.substring(0, 10), d2.plate_number, d2.wash_confirmed ? 'Да' : 'Не', d2.disinfect_confirmed ? 'Да' : 'Не', d2.performed_by]));
    rows.push('');
    rows.push(csvRow(['=== СМЪРТНОСТ ===']));
    rows.push(csvRow(['Дата', 'Хале', 'Категория', 'Детайли']));
    for (const m of (data.mortality || [])) rows.push(csvRow([m.event_date?.substring(0, 10), m.hall_name, m.category, JSON.stringify(m.details || {})]));
    rows.push('');
    rows.push(csvRow(['=== ТРЕТИРАНИЯ ===']));
    rows.push(csvRow(['Дата', 'Хале', 'Детайли', 'Извършил']));
    for (const t of (data.treatments || [])) rows.push(csvRow([t.event_date?.substring(0, 10), t.hall_name, JSON.stringify(t.details || {}), t.performed_by]));
  } else if (d.document_type === 'vetis_certificate') {
    rows.push(csvRow(['Група', data.dispatch?.group, 'Хале', data.dispatch?.hall]));
    rows.push(csvRow(['Глави', data.dispatch?.head_count, 'Тегло', data.dispatch?.weight_loading]));
    rows.push(csvRow(['Купувач', data.dispatch?.buyer, 'Дестинация', data.dispatch?.destination]));
    rows.push('');
    rows.push(csvRow(['ЗДРАВЕН СТАТУС:', data.healthStatus?.certification]));
  } else if (d.document_type === 'animal_register') {
    rows.push(csvRow(['Категория', 'Начално', 'Крайно']));
    for (const cat of ['gilt', 'sow', 'boar', 'weaner', 'finisher']) {
      rows.push(csvRow([cat, data.initial?.[cat] || 0, data.final?.[cat] || 0]));
    }
    rows.push('');
    rows.push(csvRow(['Движения', 'Бройка']));
    rows.push(csvRow(['Родени', data.movements?.born]));
    rows.push(csvRow(['Продадени', data.movements?.sold]));
    rows.push(csvRow(['Умрели', data.movements?.died]));
    rows.push(csvRow(['Бракувани', data.movements?.culled]));
  }

  const csv = '\uFEFF' + rows.join('\n');
  return { statusCode: 200, headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${d.reference_number}.csv"` }, body: csv };
}

async function regulatoryStats(db) {
  const byType = await db.query(`SELECT document_type, status, COUNT(*) as count FROM regulatory_documents GROUP BY document_type, status ORDER BY document_type`);
  const recent = await db.query(`SELECT id, document_type, reference_number, title, status, created_at FROM regulatory_documents ORDER BY created_at DESC LIMIT 5`);
  const total = await db.query(`SELECT COUNT(*) FROM regulatory_documents`);
  return ok({ stats: { total: parseInt(total.rows[0].count), byType: byType.rows, recent: recent.rows } });
}

// ═══════════════════════════════════════════════════════════════════════════
// WATER CONSUMPTION MONITORING (Spec Section I.4 — Water flow alert)
// ═══════════════════════════════════════════════════════════════════════════

async function waterRecord(db, { hall_id, reading_date, consumption_m3, animal_count, recorded_by, notes }) {
  if (!hall_id || !reading_date || consumption_m3 === undefined) return err(400, 'hall_id, reading_date и consumption_m3 са задължителни');
  const litersPerAnimal = (animal_count && animal_count > 0) ? (consumption_m3 * 1000 / animal_count) : null;
  const result = await db.query(
    `INSERT INTO water_consumption (hall_id, reading_date, consumption_m3, animal_count, liters_per_animal, recorded_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (hall_id, reading_date) DO UPDATE SET consumption_m3 = $3, animal_count = $4, liters_per_animal = $5, recorded_by = $6, notes = $7
     RETURNING *`,
    [hall_id, reading_date, consumption_m3, animal_count, litersPerAnimal, recorded_by || null, notes || null]
  );
  return ok({ water: result.rows[0] });
}

async function waterHistory(db, { hall_id, from_date, to_date, limit }) {
  const fd = from_date || new Date(Date.now() - 30*86400000).toISOString().split('T')[0];
  const td = to_date || new Date().toISOString().split('T')[0];
  let q = `SELECT wc.*, h.name as hall_name, s.name as sector_name, p.name as recorded_by_name
    FROM water_consumption wc JOIN halls h ON h.id = wc.hall_id JOIN sectors s ON s.id = h.sector_id
    LEFT JOIN personnel p ON p.id = wc.recorded_by
    WHERE wc.reading_date >= $1 AND wc.reading_date <= $2`;
  const params = [fd, td];
  let idx = 3;
  if (hall_id) { q += ` AND wc.hall_id = $${idx++}`; params.push(hall_id); }
  q += ` ORDER BY wc.reading_date DESC, h.name LIMIT $${idx++}`;
  params.push(limit || 200);
  const result = await db.query(q, params);
  return ok({ history: result.rows, from: fd, to: td });
}

async function waterCheckAlerts(db) {
  // Spec: 15% drop in consumption over 24h triggers alert (indicator for PRRS/Flu)
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const prevDay = new Date(Date.now() - 2*86400000).toISOString().split('T')[0];
  const alerts = [];

  const todayData = await db.query(
    `SELECT wc.hall_id, h.name as hall_name, wc.consumption_m3
     FROM water_consumption wc JOIN halls h ON h.id = wc.hall_id
     WHERE wc.reading_date = $1`, [today.length ? today : yesterday]
  );

  for (const current of todayData.rows) {
    // Compare with previous day average (or 7-day average)
    const prev = await db.query(
      `SELECT AVG(consumption_m3) as avg_consumption FROM water_consumption
       WHERE hall_id = $1 AND reading_date >= $2 AND reading_date < $3`,
      [current.hall_id, new Date(Date.now() - 7*86400000).toISOString().split('T')[0], today]
    );
    const avgPrev = parseFloat(prev.rows[0]?.avg_consumption || 0);
    if (avgPrev > 0) {
      const dropPct = ((avgPrev - parseFloat(current.consumption_m3)) / avgPrev) * 100;
      if (dropPct >= 15) {
        // Create alert
        await db.query(
          `INSERT INTO alerts (severity, category, message, related_entity_type, related_entity_id, threshold_name, threshold_value, target_value)
           VALUES ('critical', 'water', $1, 'hall', $2, 'water_drop_15pct', $3, $4)`,
          [`⚠️ Спад на водата в ${current.hall_name}: ${Math.round(dropPct)}% (от ${avgPrev.toFixed(1)}m³ на ${current.consumption_m3}m³). Възможна инфекция (ПРРС/Грип)!`,
           current.hall_id, Math.round(dropPct * 10) / 10, 15]
        );
        alerts.push({ hall: current.hall_name, drop_pct: Math.round(dropPct * 10) / 10, current: parseFloat(current.consumption_m3), average: avgPrev });
      }
    }
  }
  return ok({ checked: todayData.rows.length, alerts });
}

// ═══════════════════════════════════════════════════════════════════════════
// DANbred INTENSITY INDEX (Spec Section I.3 — DI = Weaned / Working hours)
// ═══════════════════════════════════════════════════════════════════════════

async function reportsDanbredIndex(db, { from_date, to_date }) {
  const fd = from_date || new Date(Date.now() - 90*86400000).toISOString().split('T')[0];
  const td = to_date || new Date().toISOString().split('T')[0];

  // Weaned piglets per sector
  const weaned = await db.query(`
    SELECT s.code as sector_code, s.name as sector_name,
      COALESCE(SUM(l.weaned_count), 0) as total_weaned
    FROM litters l
    JOIN animals a ON a.id = l.birth_sow_id
    JOIN halls h ON h.id = a.current_hall_id
    JOIN sectors s ON s.id = h.sector_id
    WHERE l.weaning_date >= $1 AND l.weaning_date <= $2
    GROUP BY s.code, s.name
  `, [fd, td]);

  // Personnel working hours (estimate: 8h/day * working days * personnel count per sector)
  const personnel = await db.query(`
    SELECT s.code as sector_code, s.name as sector_name, COUNT(DISTINCT ph.personnel_id) as staff_count
    FROM personnel_halls ph
    JOIN halls h ON h.id = ph.hall_id
    JOIN sectors s ON s.id = h.sector_id
    JOIN personnel p ON p.id = ph.personnel_id AND p.is_active = true
    GROUP BY s.code, s.name
  `);

  const days = Math.max(1, Math.round((new Date(td) - new Date(fd)) / 86400000));
  const workingDays = Math.round(days * 5 / 7); // Approximate working days

  const indices = weaned.rows.map(w => {
    const p = personnel.rows.find(pr => pr.sector_code === w.sector_code);
    const staffCount = parseInt(p?.staff_count || 1);
    const workingHours = staffCount * workingDays * 8;
    const danbredIndex = workingHours > 0 ? (parseInt(w.total_weaned) / workingHours) : 0;
    return {
      sector_code: w.sector_code,
      sector_name: w.sector_name,
      total_weaned: parseInt(w.total_weaned),
      staff_count: staffCount,
      working_hours: workingHours,
      danbred_index: Math.round(danbredIndex * 1000) / 1000
    };
  });

  // Farm-wide totals
  const totalWeaned = indices.reduce((s, i) => s + i.total_weaned, 0);
  const totalStaff = indices.reduce((s, i) => s + i.staff_count, 0);
  const totalHours = totalStaff * workingDays * 8;
  const farmIndex = totalHours > 0 ? Math.round((totalWeaned / totalHours) * 1000) / 1000 : 0;

  return ok({
    danbredIndex: { from: fd, to: td, days, workingDays, bySector: indices, farm: { totalWeaned, totalStaff, totalHours, index: farmIndex } }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// PER-EMPLOYEE PROFITABILITY (Spec Final Package #7 — Dashboard GAD)
// ═══════════════════════════════════════════════════════════════════════════

async function reportsEmployeeProfitability(db, { month_key }) {
  const mk = month_key || new Date().toISOString().substring(0, 7);
  const monthStart = `${mk}-01`;

  // Total revenue for month
  const rev = await db.query(`SELECT COALESCE(SUM(total_amount_eur), 0) as total FROM sales WHERE sale_date >= $1 AND sale_date < ($1::date + INTERVAL '1 month')`, [monthStart]);
  const revenue = parseFloat(rev.rows[0].total);

  // Total expenses
  const exp = await db.query(`SELECT COALESCE(SUM(amount_eur), 0) as total FROM expense_entries WHERE month_key = $1`, [mk]);
  const expenses = parseFloat(exp.rows[0].total);

  // Total kg sold
  const kgSold = await db.query(`SELECT COALESCE(SUM(total_weight_kg), 0) as total FROM sales WHERE sale_date >= $1 AND sale_date < ($1::date + INTERVAL '1 month')`, [monthStart]);
  const totalKg = parseFloat(kgSold.rows[0].total);

  // Active personnel count
  const staffCount = await db.query(`SELECT COUNT(*) FROM personnel WHERE is_active = true`);
  const totalStaff = parseInt(staffCount.rows[0].count) || 1;

  // By role breakdown
  const byRole = await db.query(`
    SELECT p.role, COUNT(p.id) as count,
      COALESCE(st.base_salary_eur, 0) as base_salary,
      COALESCE(SUM(ee.amount_eur), 0) as total_salary_cost
    FROM personnel p
    LEFT JOIN salary_templates st ON st.role = p.role
    LEFT JOIN expense_entries ee ON ee.category = 'salary' AND ee.month_key = $1
      AND ee.description LIKE '%' || p.name || '%'
    WHERE p.is_active = true
    GROUP BY p.role, st.base_salary_eur
    ORDER BY p.role
  `, [mk]);

  const profit = revenue - expenses;
  const profitPerEmployee = totalStaff > 0 ? Math.round(profit / totalStaff * 100) / 100 : 0;
  const revenuePerEmployee = totalStaff > 0 ? Math.round(revenue / totalStaff * 100) / 100 : 0;
  const kgPerEmployee = totalStaff > 0 ? Math.round(totalKg / totalStaff * 100) / 100 : 0;
  const costPerKg = totalKg > 0 ? Math.round(expenses / totalKg * 100) / 100 : 0;
  // Labour cost per kg (spec formula: LC_kg = Total salary / Total kg sold)
  const salaryCost = await db.query(`SELECT COALESCE(SUM(amount_eur), 0) as total FROM expense_entries WHERE month_key = $1 AND category = 'salary'`, [mk]);
  const labourCostPerKg = totalKg > 0 ? Math.round(parseFloat(salaryCost.rows[0].total) / totalKg * 100) / 100 : 0;

  return ok({
    employeeProfitability: {
      month: mk,
      totalStaff,
      revenue: Math.round(revenue * 100) / 100,
      expenses: Math.round(expenses * 100) / 100,
      profit: Math.round(profit * 100) / 100,
      totalKgSold: Math.round(totalKg * 100) / 100,
      profitPerEmployee,
      revenuePerEmployee,
      kgPerEmployee,
      costPerKg,
      labourCostPerKg,
      byRole: byRole.rows
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MORTALITY BY MONETARY VALUE (Spec Section IV.Д — "Mortality by financial value")
// ═══════════════════════════════════════════════════════════════════════════

async function reportsMortalityValue(db, { from_date, to_date }) {
  const fd = from_date || new Date(Date.now() - 30*86400000).toISOString().split('T')[0];
  const td = to_date || new Date().toISOString().split('T')[0];

  // Get death events with animal details
  const deaths = await db.query(`
    SELECT e.event_date, e.details, a.category, a.ear_tag, h.name as hall_name, s.name as sector_name
    FROM events e
    LEFT JOIN animals a ON a.id = e.animal_id
    LEFT JOIN halls h ON h.id = COALESCE(e.hall_id, a.current_hall_id)
    LEFT JOIN sectors s ON s.id = h.sector_id
    WHERE e.event_type IN ('death', 'group_mortality') AND e.event_date >= $1 AND e.event_date <= $2
    ORDER BY e.event_date DESC
  `, [fd, td]);

  // Estimate cost per dead animal based on category (feed consumed until death)
  // Approximate feed cost per animal by category (EUR):
  const costEstimates = {
    suckling_piglet: 8,    // EUR - minimal feed, mainly colostrum/milk
    weaner: 43,            // EUR - starter feed consumed (~12kg at ~0.95 EUR/kg)
    finisher: 179,         // EUR - significant feed investment (~120kg at ~1.50 EUR/kg)
    gilt: 205,             // EUR - similar to finisher + selection cost
    sow: 128,              // EUR - replacement value consideration
    boar: 256              // EUR - high value genetic material
  };

  let totalValue = 0;
  let totalCount = 0;
  const bySector = {};
  const byCategory = {};
  const byDate = {};

  for (const d of deaths.rows) {
    const count = d.details?.count ? parseInt(d.details.count) : 1;
    const cat = d.category || d.details?.category || 'finisher';
    const value = (costEstimates[cat] || 100) * count;

    totalValue += value;
    totalCount += count;

    const sector = d.sector_name || 'Неопределен';
    if (!bySector[sector]) bySector[sector] = { count: 0, value: 0 };
    bySector[sector].count += count;
    bySector[sector].value += value;

    if (!byCategory[cat]) byCategory[cat] = { count: 0, value: 0 };
    byCategory[cat].count += count;
    byCategory[cat].value += value;

    const dateKey = d.event_date?.toISOString?.()?.split('T')[0] || d.event_date?.substring?.(0, 10) || fd;
    if (!byDate[dateKey]) byDate[dateKey] = { count: 0, value: 0 };
    byDate[dateKey].count += count;
    byDate[dateKey].value += value;
  }

  return ok({
    mortalityValue: {
      from: fd, to: td,
      totalCount,
      totalValueEur: Math.round(totalValue * 100) / 100,
      bySector: Object.entries(bySector).map(([name, d]) => ({ sector: name, ...d, valueEur: Math.round(d.value * 100) / 100 })),
      byCategory: Object.entries(byCategory).map(([cat, d]) => ({ category: cat, ...d, valueEur: Math.round(d.value * 100) / 100 })),
      byDate: Object.entries(byDate).map(([date, d]) => ({ date, ...d, valueEur: Math.round(d.value * 100) / 100 })).sort((a, b) => b.date.localeCompare(a.date)),
      costEstimates
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// DAILY INPUT/OUTPUT REPORT (Spec Section IV.Д — "Daily In-Out report")
// ═══════════════════════════════════════════════════════════════════════════

async function reportsDailyIO(db, { date, from_date, to_date }) {
  const targetDate = date || new Date().toISOString().split('T')[0];
  const fd = from_date || targetDate;
  const td = to_date || targetDate;

  // INPUT: Feed produced (tons)
  const feedProduced = await db.query(
    `SELECT COALESCE(SUM(fpb.quantity_tons), 0) as total_tons,
       COUNT(fpb.id) as batch_count
     FROM feed_production_batches fpb
     WHERE fpb.batch_date >= $1 AND fpb.batch_date <= $2`, [fd, td]);

  // INPUT: Feed delivered to halls (from routes)
  const feedDelivered = await db.query(
    `SELECT COALESCE(SUM(ds.delivered_tons), 0) as total_tons,
       COUNT(DISTINCT dr.id) as route_count
     FROM delivery_stops ds
     JOIN delivery_routes dr ON dr.id = ds.route_id
     WHERE dr.status = 'completed' AND dr.route_date >= $1 AND dr.route_date <= $2`, [fd, td]);

  // INPUT: Raw materials received (component restocks)
  const rawMaterials = await db.query(
    `SELECT COALESCE(SUM(ee.amount_eur), 0) as total_eur, COUNT(ee.id) as entries
     FROM expense_entries ee WHERE ee.category = 'feed' AND ee.entry_date >= $1 AND ee.entry_date <= $2`, [fd, td]);

  // OUTPUT: Animals born
  const born = await db.query(
    `SELECT COALESCE(SUM(l.born_alive), 0) as alive, COALESCE(SUM(l.stillborn), 0) as dead
     FROM litters l WHERE l.birth_date >= $1 AND l.birth_date <= $2`, [fd, td]);

  // OUTPUT: Animals sold/dispatched
  const sold = await db.query(
    `SELECT COALESCE(SUM(s.head_count), 0) as heads, COALESCE(SUM(s.total_weight_kg), 0) as kg,
       COALESCE(SUM(s.total_amount_eur), 0) as revenue_eur
     FROM sales s WHERE s.sale_date >= $1 AND s.sale_date <= $2`, [fd, td]);

  // OUTPUT: Deaths
  const deaths = await db.query(
    `SELECT COUNT(*) as count FROM events
     WHERE event_type IN ('death', 'group_mortality') AND event_date >= $1 AND event_date <= $2`, [fd, td]);

  // Animal balance
  const currentCount = await db.query(
    `SELECT COUNT(*) as total FROM animals WHERE status != 'culled'`);

  // Weight gain estimate (ADG * animal count * days)
  const finisherCount = await db.query(
    `SELECT COALESCE(SUM(current_count), 0) as total FROM animal_groups WHERE category = 'finisher' AND exit_date IS NULL`);
  const days = Math.max(1, Math.round((new Date(td) - new Date(fd)) / 86400000) + 1);
  const estimatedGainKg = parseInt(finisherCount.rows[0].total) * 1.0 * days; // 1000g/day = 1kg/day

  return ok({
    dailyIO: {
      from: fd, to: td, days,
      input: {
        feedProducedTons: parseFloat(feedProduced.rows[0].total_tons),
        feedProductionBatches: parseInt(feedProduced.rows[0].batch_count),
        feedDeliveredTons: parseFloat(feedDelivered.rows[0].total_tons),
        deliveryRoutes: parseInt(feedDelivered.rows[0].route_count),
        rawMaterialsCostEur: parseFloat(rawMaterials.rows[0].total_eur),
        bornAlive: parseInt(born.rows[0].alive),
        bornDead: parseInt(born.rows[0].dead)
      },
      output: {
        soldHeads: parseInt(sold.rows[0].heads),
        soldKg: parseFloat(sold.rows[0].kg),
        soldRevenueEur: parseFloat(sold.rows[0].revenue_eur),
        deaths: parseInt(deaths.rows[0].count),
        estimatedWeightGainKg: Math.round(estimatedGainKg)
      },
      balance: {
        currentAnimalCount: parseInt(currentCount.rows[0].total),
        finishersInProduction: parseInt(finisherCount.rows[0].total)
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// APP SETTINGS (key-value, persists across reset)
// ═══════════════════════════════════════════════════════════════════════════

async function settingsGet(db, { key }) {
  if (!key) return err(400, 'key е задължителен');
  const result = await db.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return { key, value: result.rows[0]?.value || null };
}

async function settingsSet(db, { key, value }) {
  if (!key) return err(400, 'key е задължителен');
  if (value === null || value === undefined) {
    await db.query('DELETE FROM app_settings WHERE key = $1', [key]);
    return { key, deleted: true };
  }
  await db.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, String(value)]
  );
  return { key, value: String(value) };
}

async function settingsGetAll(db) {
  const result = await db.query('SELECT key, value FROM app_settings ORDER BY key');
  const settings = {};
  for (const row of result.rows) settings[row.key] = row.value;
  return { settings };
}
