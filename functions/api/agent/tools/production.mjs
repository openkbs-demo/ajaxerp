/**
 * Production Intelligence tools — 10 read-only tools for farm KPIs and operations.
 */
import { z } from 'zod';
import { tool } from 'ai';
import { safeQuery } from './shared.mjs';

export function productionTools(db) {
  return {
    get_kpis: tool({
      description: 'Извличане на последни KPI стойности спрямо целевите показатели. Връща кратък отчет с актуални метрики.',
      parameters: z.object({
        kpi_name: z.string().optional().describe('Филтър по конкретен KPI (напр. "born_alive_avg", "mortality_pct")'),
        days: z.number().optional().default(30).describe('Брой дни назад за данните')
      }),
      execute: async ({ kpi_name, days }) => {
        let sql = `SELECT ks.kpi_name, ks.kpi_value, ks.snapshot_date, ks.scope_type, ks.scope_id,
                     br.target_value, br.operator, br.kpi_label
                   FROM kpi_snapshots ks
                   LEFT JOIN bonus_rules br ON br.kpi_name = ks.kpi_name
                   WHERE ks.snapshot_date >= CURRENT_DATE - $1`;
        const params = [days || 30];
        if (kpi_name) {
          sql += ` AND ks.kpi_name = $2`;
          params.push(kpi_name);
        }
        sql += ` ORDER BY ks.snapshot_date DESC, ks.kpi_name LIMIT 100`;
        return await safeQuery(db, sql, params);
      }
    }),

    get_active_alerts: tool({
      description: 'Неприети (активни) аларми по тежест и категория. Показва критични проблеми изискващи внимание.',
      parameters: z.object({
        severity: z.string().optional().describe('Филтър: critical, warning, info'),
        category: z.string().optional().describe('Филтър по категория: mortality, temperature, biosecurity и др.')
      }),
      execute: async ({ severity, category }) => {
        let sql = `SELECT id, severity, category, message, related_entity_type, related_entity_id,
                     threshold_name, threshold_value, target_value, created_at
                   FROM alerts WHERE is_acknowledged = false`;
        const params = [];
        if (severity) { params.push(severity); sql += ` AND severity = $${params.length}`; }
        if (category) { params.push(category); sql += ` AND category = $${params.length}`; }
        sql += ` ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, created_at DESC LIMIT 50`;
        return await safeQuery(db, sql, params);
      }
    }),

    get_litter_performance: tool({
      description: 'Резултати от последни раждания — живородени, отбити, тегла. По избор — за конкретна свиня-майка.',
      parameters: z.object({
        sow_ear_tag: z.string().optional().describe('Ушна марка на свиня-майка'),
        limit: z.number().optional().default(20).describe('Брой записи')
      }),
      execute: async ({ sow_ear_tag, limit }) => {
        let sql = `SELECT l.id, l.birth_date, l.parity_number, l.born_alive, l.stillborn, l.mummified,
                     l.weaned_count, l.weaning_weight_kg, l.weaning_date,
                     a.ear_tag as sow_ear_tag, h.name as hall_name
                   FROM litters l
                   JOIN animals a ON a.id = l.birth_sow_id
                   LEFT JOIN halls h ON h.id = a.current_hall_id`;
        const params = [];
        if (sow_ear_tag) { params.push(sow_ear_tag); sql += ` WHERE a.ear_tag = $1`; }
        sql += ` ORDER BY l.birth_date DESC LIMIT $${params.length + 1}`;
        params.push(limit || 20);
        return await safeQuery(db, sql, params);
      }
    }),

    get_mortality_data: tool({
      description: 'Смъртност по период, категория и хале — брой, причини. За анализ на тенденции.',
      parameters: z.object({
        days: z.number().optional().default(30).describe('Период в дни'),
        category: z.string().optional().describe('Категория животни: sow, weaner, finisher'),
        hall_id: z.number().optional().describe('ID на хале')
      }),
      execute: async ({ days, category, hall_id }) => {
        let sql = `SELECT a.category, h.name as hall_name, e.details->>'cause' as cause,
                     COUNT(*) as death_count, DATE(e.event_date) as event_day
                   FROM events e
                   JOIN animals a ON a.id = e.animal_id
                   LEFT JOIN halls h ON h.id = e.hall_id
                   WHERE e.event_type = 'death' AND e.event_date >= NOW() - INTERVAL '1 day' * $1`;
        const params = [days || 30];
        if (category) { params.push(category); sql += ` AND a.category = $${params.length}`; }
        if (hall_id) { params.push(hall_id); sql += ` AND e.hall_id = $${params.length}`; }
        sql += ` GROUP BY a.category, h.name, e.details->>'cause', DATE(e.event_date)
                 ORDER BY event_day DESC LIMIT 100`;
        return await safeQuery(db, sql, params);
      }
    }),

    get_hall_status: tool({
      description: 'Статус на халета — заетост, зона, хигиенни паузи. Преглед на капацитета.',
      parameters: z.object({
        sector_code: z.string().optional().describe('Код на сектор: FAR, NUR, FIN, QUA')
      }),
      execute: async ({ sector_code }) => {
        let sql = `SELECT h.id, h.name, s.code as sector_code, s.name as sector_name,
                     h.biosecurity_zone, h.capacity, h.current_occupancy,
                     CASE WHEN h.capacity > 0 THEN ROUND(h.current_occupancy::numeric / h.capacity * 100, 1) ELSE 0 END as occupancy_pct,
                     h.is_active,
                     hp.status as hygiene_status, hp.start_date as hygiene_start
                   FROM halls h
                   JOIN sectors s ON s.id = h.sector_id
                   LEFT JOIN hall_hygiene_pauses hp ON hp.hall_id = h.id AND hp.status IN ('started', 'cleaning', 'disinfection')`;
        const params = [];
        if (sector_code) { params.push(sector_code); sql += ` WHERE s.code = $1`; }
        sql += ` ORDER BY s.code, h.name`;
        return await safeQuery(db, sql, params);
      }
    }),

    get_water_trends: tool({
      description: 'Тенденции в консумацията на вода по халета (ранно предупреждение за болести).',
      parameters: z.object({
        hall_id: z.number().optional().describe('ID на хале'),
        days: z.number().optional().default(14).describe('Период в дни')
      }),
      execute: async ({ hall_id, days }) => {
        let sql = `SELECT wc.hall_id, h.name as hall_name, wc.reading_date,
                     wc.consumption_m3, wc.animal_count, wc.liters_per_animal
                   FROM water_consumption wc
                   JOIN halls h ON h.id = wc.hall_id
                   WHERE wc.reading_date >= CURRENT_DATE - $1`;
        const params = [days || 14];
        if (hall_id) { params.push(hall_id); sql += ` AND wc.hall_id = $${params.length}`; }
        sql += ` ORDER BY wc.reading_date DESC, h.name LIMIT 100`;
        return await safeQuery(db, sql, params);
      }
    }),

    get_sow_pipeline: tool({
      description: 'Брой свине-майки по статус — тръбопровод на размножаване (breeding pipeline).',
      parameters: z.object({}),
      execute: async () => {
        const sql = `SELECT status, COUNT(*) as count
                     FROM animals WHERE category = 'sow' AND status != 'culled'
                     GROUP BY status ORDER BY count DESC`;
        return await safeQuery(db, sql);
      }
    }),

    get_group_performance: tool({
      description: 'Угоителни групи — тегло, бройки, целеви дати за клане.',
      parameters: z.object({
        active_only: z.boolean().optional().default(true).describe('Само активни групи (без exit_date)')
      }),
      execute: async ({ active_only }) => {
        let sql = `SELECT ag.id, ag.group_name, ag.category, h.name as hall_name,
                     ag.entry_date, ag.entry_count, ag.entry_weight_avg_kg,
                     ag.current_count, ag.current_weight_avg_kg,
                     ag.target_slaughter_date, ag.exit_date, ag.exit_weight_avg_kg
                   FROM animal_groups ag
                   LEFT JOIN halls h ON h.id = ag.hall_id`;
        if (active_only !== false) sql += ` WHERE ag.exit_date IS NULL`;
        sql += ` ORDER BY ag.entry_date DESC LIMIT 50`;
        return await safeQuery(db, sql);
      }
    }),

    get_financial_summary: tool({
      description: 'Месечен финансов преглед — приходи, разходи, печалба от P&L моментни снимки.',
      parameters: z.object({
        months: z.number().optional().default(6).describe('Брой месеци назад')
      }),
      execute: async ({ months }) => {
        const sql = `SELECT month_key, revenue_eur, feed_cost_eur, salary_cost_eur, vet_cost_eur,
                       other_cost_eur, total_cost_eur, operating_profit_eur,
                       gross_margin_pct, operating_margin_pct, total_kg_sold, total_heads_sold, cost_per_kg
                     FROM monthly_pnl_snapshots
                     ORDER BY month_key DESC LIMIT $1`;
        return await safeQuery(db, sql, [months || 6]);
      }
    }),

    get_feed_status: tool({
      description: 'Статус на фуражните компоненти — наличност, под прага за поръчка.',
      parameters: z.object({
        low_only: z.boolean().optional().default(false).describe('Само компоненти под прага')
      }),
      execute: async ({ low_only }) => {
        let sql = `SELECT id, name, name_bg, price_per_ton, current_stock_kg, reorder_threshold_kg, supplier,
                     CASE WHEN reorder_threshold_kg > 0 AND current_stock_kg < reorder_threshold_kg THEN true ELSE false END as below_threshold
                   FROM feed_components`;
        if (low_only) sql += ` WHERE reorder_threshold_kg > 0 AND current_stock_kg < reorder_threshold_kg`;
        sql += ` ORDER BY name`;
        return await safeQuery(db, sql);
      }
    })
  };
}
