import pg from 'pg';
const { Client } = pg;

let db = null;
let dbConnected = false;

export async function getDB() {
  if (!dbConnected) {
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    dbConnected = true;
    await runMigrations(db);
  }
  return db;
}

export function resetDB() {
  dbConnected = false;
  if (db) { try { db.end(); } catch {} }
  db = null;
}

async function runMigrations(db) {
  // Sectors
  await db.query(`
    CREATE TABLE IF NOT EXISTS sectors (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      code VARCHAR(20) UNIQUE NOT NULL
    )
  `);

  // Halls
  await db.query(`
    CREATE TABLE IF NOT EXISTS halls (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      sector_id INTEGER REFERENCES sectors(id),
      biosecurity_zone VARCHAR(20) NOT NULL DEFAULT 'grey',
      capacity INTEGER NOT NULL DEFAULT 0,
      current_occupancy INTEGER DEFAULT 0,
      target_temp_min DECIMAL(4,1),
      target_temp_max DECIMAL(4,1),
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Personnel
  await db.query(`
    CREATE TABLE IF NOT EXISTS personnel (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(512) NOT NULL,
      salt VARCHAR(64) NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'farm_worker',
      phone VARCHAR(50),
      hire_date DATE,
      is_active BOOLEAN DEFAULT true,
      private_channel VARCHAR(64) UNIQUE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Personnel-Halls junction
  await db.query(`
    CREATE TABLE IF NOT EXISTS personnel_halls (
      personnel_id INTEGER REFERENCES personnel(id) ON DELETE CASCADE,
      hall_id INTEGER REFERENCES halls(id) ON DELETE CASCADE,
      PRIMARY KEY (personnel_id, hall_id)
    )
  `);

  // Animals
  await db.query(`
    CREATE TABLE IF NOT EXISTS animals (
      id SERIAL PRIMARY KEY,
      ear_tag VARCHAR(20) UNIQUE,
      category VARCHAR(20) NOT NULL,
      breed VARCHAR(50),
      date_of_birth DATE,
      status VARCHAR(30) NOT NULL DEFAULT 'active',
      parity_number INTEGER DEFAULT 0,
      current_hall_id INTEGER REFERENCES halls(id),
      entry_date DATE DEFAULT CURRENT_DATE,
      cull_date DATE,
      cull_reason VARCHAR(50),
      cull_destination VARCHAR(50),
      cull_weight_kg DECIMAL(6,2),
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Events
  await db.query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      event_type VARCHAR(50) NOT NULL,
      animal_id INTEGER REFERENCES animals(id),
      group_id INTEGER,
      hall_id INTEGER REFERENCES halls(id),
      performed_by INTEGER REFERENCES personnel(id),
      event_date TIMESTAMP NOT NULL DEFAULT NOW(),
      details JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Litters
  await db.query(`
    CREATE TABLE IF NOT EXISTS litters (
      id SERIAL PRIMARY KEY,
      birth_sow_id INTEGER REFERENCES animals(id) NOT NULL,
      nurse_sow_id INTEGER REFERENCES animals(id),
      farrowing_event_id INTEGER REFERENCES events(id),
      parity_number INTEGER NOT NULL,
      born_alive INTEGER NOT NULL DEFAULT 0,
      stillborn INTEGER DEFAULT 0,
      mummified INTEGER DEFAULT 0,
      weaned_count INTEGER,
      weaning_weight_kg DECIMAL(6,2),
      weaning_date DATE,
      birth_date DATE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Animal groups (batches for finishing)
  await db.query(`
    CREATE TABLE IF NOT EXISTS animal_groups (
      id SERIAL PRIMARY KEY,
      group_name VARCHAR(100) NOT NULL,
      category VARCHAR(20) NOT NULL DEFAULT 'finisher',
      hall_id INTEGER REFERENCES halls(id),
      entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
      entry_count INTEGER NOT NULL DEFAULT 0,
      entry_weight_avg_kg DECIMAL(6,2),
      current_count INTEGER DEFAULT 0,
      current_weight_avg_kg DECIMAL(6,2),
      target_slaughter_date DATE,
      exit_date DATE,
      exit_count INTEGER,
      exit_weight_avg_kg DECIMAL(6,2),
      source_litter_ids JSONB DEFAULT '[]',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Feed components
  await db.query(`
    CREATE TABLE IF NOT EXISTS feed_components (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      name_bg VARCHAR(100),
      price_per_ton DECIMAL(10,2) NOT NULL DEFAULT 0,
      current_stock_kg DECIMAL(12,2) DEFAULT 0,
      reorder_threshold_kg DECIMAL(12,2) DEFAULT 0,
      supplier VARCHAR(255),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Feed recipes
  await db.query(`
    CREATE TABLE IF NOT EXISTS feed_recipes (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      name_bg VARCHAR(100),
      target_category VARCHAR(50),
      cost_per_ton DECIMAL(10,2) DEFAULT 0,
      shrinkage_pct DECIMAL(4,2) DEFAULT 0.50,
      is_active BOOLEAN DEFAULT true,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Feed recipe components (junction)
  await db.query(`
    CREATE TABLE IF NOT EXISTS feed_recipe_components (
      id SERIAL PRIMARY KEY,
      recipe_id INTEGER REFERENCES feed_recipes(id) ON DELETE CASCADE,
      component_id INTEGER REFERENCES feed_components(id) ON DELETE CASCADE,
      percentage DECIMAL(5,2) NOT NULL,
      UNIQUE(recipe_id, component_id)
    )
  `);

  // Feed production batches
  await db.query(`
    CREATE TABLE IF NOT EXISTS feed_production_batches (
      id SERIAL PRIMARY KEY,
      recipe_id INTEGER REFERENCES feed_recipes(id),
      batch_date DATE NOT NULL DEFAULT CURRENT_DATE,
      quantity_tons DECIMAL(8,2) NOT NULL,
      produced_by INTEGER REFERENCES personnel(id),
      deduction_confirmed BOOLEAN DEFAULT false,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // KPI snapshots
  await db.query(`
    CREATE TABLE IF NOT EXISTS kpi_snapshots (
      id SERIAL PRIMARY KEY,
      snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
      kpi_name VARCHAR(100) NOT NULL,
      kpi_value DECIMAL(10,4),
      scope_type VARCHAR(20) DEFAULT 'farm',
      scope_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Alerts
  await db.query(`
    CREATE TABLE IF NOT EXISTS alerts (
      id SERIAL PRIMARY KEY,
      severity VARCHAR(20) NOT NULL DEFAULT 'info',
      category VARCHAR(50) NOT NULL,
      message TEXT NOT NULL,
      related_entity_type VARCHAR(50),
      related_entity_id INTEGER,
      threshold_name VARCHAR(100),
      threshold_value DECIMAL(10,4),
      target_value DECIMAL(10,4),
      is_acknowledged BOOLEAN DEFAULT false,
      acknowledged_by INTEGER REFERENCES personnel(id),
      acknowledged_at TIMESTAMP,
      acknowledge_notes TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'new',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Migration: add status column to existing alerts tables
  await db.query(`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'new'`);
  await db.query(`UPDATE alerts SET status = 'closed' WHERE is_acknowledged = true AND status = 'new'`);

  // Alert notes log
  await db.query(`
    CREATE TABLE IF NOT EXISTS alert_notes (
      id SERIAL PRIMARY KEY,
      alert_id INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
      author_id INTEGER REFERENCES personnel(id),
      note TEXT NOT NULL,
      status_change VARCHAR(20),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // ─── Phase 2: Finance & Reports tables ────────────────────────────────────

  // Sales
  await db.query(`
    CREATE TABLE IF NOT EXISTS sales (
      id SERIAL PRIMARY KEY,
      sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
      sale_type VARCHAR(20) NOT NULL,
      group_id INTEGER REFERENCES animal_groups(id),
      animal_id INTEGER REFERENCES animals(id),
      buyer_name VARCHAR(255),
      head_count INTEGER NOT NULL DEFAULT 0,
      total_weight_kg DECIMAL(10,2),
      price_per_kg DECIMAL(8,4),
      price_per_head DECIMAL(10,2),
      total_amount_eur DECIMAL(12,2) NOT NULL,
      invoice_number VARCHAR(50),
      notes TEXT,
      created_by INTEGER REFERENCES personnel(id),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Expense entries
  await db.query(`
    CREATE TABLE IF NOT EXISTS expense_entries (
      id SERIAL PRIMARY KEY,
      entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
      month_key VARCHAR(7),
      category VARCHAR(30) NOT NULL,
      subcategory VARCHAR(50),
      description TEXT,
      amount_eur DECIMAL(12,2) NOT NULL,
      sector_id INTEGER REFERENCES sectors(id),
      hall_id INTEGER REFERENCES halls(id),
      related_entity_type VARCHAR(50),
      related_entity_id INTEGER,
      created_by INTEGER REFERENCES personnel(id),
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Salary templates
  await db.query(`
    CREATE TABLE IF NOT EXISTS salary_templates (
      id SERIAL PRIMARY KEY,
      role VARCHAR(50) NOT NULL UNIQUE,
      base_salary_eur DECIMAL(10,2) NOT NULL,
      is_active BOOLEAN DEFAULT true,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Medicine catalog
  await db.query(`
    CREATE TABLE IF NOT EXISTS medicine_catalog (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      name_bg VARCHAR(200),
      unit VARCHAR(20) NOT NULL DEFAULT 'ml',
      price_per_unit_eur DECIMAL(10,4) NOT NULL DEFAULT 0,
      current_stock DECIMAL(12,2) DEFAULT 0,
      reorder_threshold DECIMAL(12,2) DEFAULT 0,
      supplier VARCHAR(255),
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Inventory counts (physical stock counts)
  await db.query(`
    CREATE TABLE IF NOT EXISTS inventory_counts (
      id SERIAL PRIMARY KEY,
      count_date DATE NOT NULL DEFAULT CURRENT_DATE,
      component_id INTEGER REFERENCES feed_components(id) NOT NULL,
      counted_kg DECIMAL(12,2) NOT NULL,
      theoretical_kg DECIMAL(12,2),
      variance_kg DECIMAL(12,2),
      variance_pct DECIMAL(8,4),
      counted_by INTEGER REFERENCES personnel(id),
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Monthly P&L snapshots
  await db.query(`
    CREATE TABLE IF NOT EXISTS monthly_pnl_snapshots (
      id SERIAL PRIMARY KEY,
      month_key VARCHAR(7) NOT NULL UNIQUE,
      revenue_eur DECIMAL(14,2) DEFAULT 0,
      feed_cost_eur DECIMAL(14,2) DEFAULT 0,
      salary_cost_eur DECIMAL(14,2) DEFAULT 0,
      vet_cost_eur DECIMAL(14,2) DEFAULT 0,
      other_cost_eur DECIMAL(14,2) DEFAULT 0,
      total_cost_eur DECIMAL(14,2) DEFAULT 0,
      operating_profit_eur DECIMAL(14,2) DEFAULT 0,
      gross_margin_pct DECIMAL(8,4),
      operating_margin_pct DECIMAL(8,4),
      total_kg_sold DECIMAL(12,2) DEFAULT 0,
      total_heads_sold INTEGER DEFAULT 0,
      cost_per_kg DECIMAL(8,4),
      metrics JSONB DEFAULT '{}',
      snapshot_date TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // ─── Phase 3: Logistics tables ────────────────────────────────────────

  // Vehicles (feed trucks and livestock transport)
  await db.query(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id SERIAL PRIMARY KEY,
      plate_number VARCHAR(20) UNIQUE NOT NULL,
      vehicle_type VARCHAR(30) NOT NULL DEFAULT 'feed_truck',
      capacity_tons DECIMAL(6,2),
      status VARCHAR(20) NOT NULL DEFAULT 'clean',
      assigned_driver_id INTEGER REFERENCES personnel(id),
      current_km INTEGER DEFAULT 0,
      last_disinfection_at TIMESTAMP,
      notes TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Silos (one or more per hall)
  await db.query(`
    CREATE TABLE IF NOT EXISTS silos (
      id SERIAL PRIMARY KEY,
      hall_id INTEGER NOT NULL REFERENCES halls(id),
      silo_name VARCHAR(50) NOT NULL,
      capacity_tons DECIMAL(8,2) NOT NULL,
      current_level_tons DECIMAL(8,2) DEFAULT 0,
      feed_type VARCHAR(100),
      recipe_id INTEGER REFERENCES feed_recipes(id),
      low_level_threshold_pct DECIMAL(5,2) DEFAULT 20,
      last_filled_at TIMESTAMP,
      notes TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(hall_id, silo_name)
    )
  `);

  // Delivery routes
  await db.query(`
    CREATE TABLE IF NOT EXISTS delivery_routes (
      id SERIAL PRIMARY KEY,
      route_date DATE NOT NULL DEFAULT CURRENT_DATE,
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
      driver_id INTEGER NOT NULL REFERENCES personnel(id),
      status VARCHAR(20) NOT NULL DEFAULT 'planned',
      total_tons DECIMAL(8,2) DEFAULT 0,
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      km_start INTEGER,
      km_end INTEGER,
      notes TEXT,
      created_by INTEGER REFERENCES personnel(id),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Delivery stops (per route)
  await db.query(`
    CREATE TABLE IF NOT EXISTS delivery_stops (
      id SERIAL PRIMARY KEY,
      route_id INTEGER NOT NULL REFERENCES delivery_routes(id) ON DELETE CASCADE,
      stop_order INTEGER NOT NULL,
      silo_id INTEGER NOT NULL REFERENCES silos(id),
      planned_tons DECIMAL(8,2) NOT NULL,
      delivered_tons DECIMAL(8,2),
      status VARCHAR(20) DEFAULT 'pending',
      delivered_at TIMESTAMP,
      notes TEXT,
      UNIQUE(route_id, stop_order)
    )
  `);

  // Dispatch orders (slaughterhouse expeditions)
  await db.query(`
    CREATE TABLE IF NOT EXISTS dispatch_orders (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES animal_groups(id),
      dispatch_date DATE NOT NULL,
      buyer_name VARCHAR(200),
      destination VARCHAR(200),
      vehicle_id INTEGER REFERENCES vehicles(id),
      driver_id INTEGER REFERENCES personnel(id),
      head_count INTEGER NOT NULL,
      weight_at_loading_kg DECIMAL(10,2),
      weight_at_destination_kg DECIMAL(10,2),
      shrinkage_pct DECIMAL(5,2),
      status VARCHAR(20) NOT NULL DEFAULT 'proposed',
      auto_generated BOOLEAN DEFAULT false,
      notes TEXT,
      created_by INTEGER REFERENCES personnel(id),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Disinfection logs
  await db.query(`
    CREATE TABLE IF NOT EXISTS disinfection_logs (
      id SERIAL PRIMARY KEY,
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
      disinfection_date TIMESTAMP NOT NULL DEFAULT NOW(),
      wash_confirmed BOOLEAN DEFAULT false,
      disinfect_confirmed BOOLEAN DEFAULT false,
      performed_by INTEGER NOT NULL REFERENCES personnel(id),
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // ─── Phase 4: Biosecurity tables ──────────────────────────────────────

  // Access logs (personnel entry/exit halls)
  await db.query(`
    CREATE TABLE IF NOT EXISTS access_logs (
      id SERIAL PRIMARY KEY,
      personnel_id INTEGER NOT NULL REFERENCES personnel(id),
      hall_id INTEGER NOT NULL REFERENCES halls(id),
      action VARCHAR(10) NOT NULL DEFAULT 'entry',
      zone VARCHAR(20),
      sector_code VARCHAR(10),
      method VARCHAR(10) DEFAULT 'manual',
      shower_confirmed BOOLEAN DEFAULT false,
      override BOOLEAN DEFAULT false,
      override_reason TEXT,
      override_by INTEGER REFERENCES personnel(id),
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Biosecurity violations
  await db.query(`
    CREATE TABLE IF NOT EXISTS biosecurity_violations (
      id SERIAL PRIMARY KEY,
      personnel_id INTEGER NOT NULL REFERENCES personnel(id),
      violation_type VARCHAR(30) NOT NULL,
      source_hall_id INTEGER REFERENCES halls(id),
      target_hall_id INTEGER REFERENCES halls(id),
      severity VARCHAR(20) DEFAULT 'warning',
      description TEXT,
      is_overridden BOOLEAN DEFAULT false,
      is_resolved BOOLEAN DEFAULT false,
      resolved_by INTEGER REFERENCES personnel(id),
      resolved_at TIMESTAMP,
      resolve_notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Medicine withdrawal rules
  await db.query(`
    CREATE TABLE IF NOT EXISTS medicine_withdrawals (
      id SERIAL PRIMARY KEY,
      medicine_id INTEGER NOT NULL REFERENCES medicine_catalog(id),
      withdrawal_days INTEGER NOT NULL DEFAULT 0,
      applies_to VARCHAR(20) DEFAULT 'all',
      notes TEXT,
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(medicine_id)
    )
  `);

  // Active withdrawal periods
  await db.query(`
    CREATE TABLE IF NOT EXISTS active_withdrawals (
      id SERIAL PRIMARY KEY,
      animal_id INTEGER REFERENCES animals(id),
      group_id INTEGER REFERENCES animal_groups(id),
      medicine_id INTEGER NOT NULL REFERENCES medicine_catalog(id),
      event_id INTEGER REFERENCES events(id),
      start_date DATE NOT NULL DEFAULT CURRENT_DATE,
      end_date DATE NOT NULL,
      status VARCHAR(20) DEFAULT 'active',
      cleared_by INTEGER REFERENCES personnel(id),
      cleared_at TIMESTAMP,
      clear_reason TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Hall hygiene pauses
  await db.query(`
    CREATE TABLE IF NOT EXISTS hall_hygiene_pauses (
      id SERIAL PRIMARY KEY,
      hall_id INTEGER NOT NULL REFERENCES halls(id),
      start_date DATE NOT NULL DEFAULT CURRENT_DATE,
      required_days INTEGER DEFAULT 5,
      cleaning_confirmed BOOLEAN DEFAULT false,
      cleaning_confirmed_at TIMESTAMP,
      cleaning_confirmed_by INTEGER REFERENCES personnel(id),
      disinfection_confirmed BOOLEAN DEFAULT false,
      disinfection_confirmed_at TIMESTAMP,
      disinfection_confirmed_by INTEGER REFERENCES personnel(id),
      status VARCHAR(20) DEFAULT 'started',
      ready_date DATE,
      completed_at TIMESTAMP,
      completed_by INTEGER REFERENCES personnel(id),
      cancel_reason TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // ─── Phase 5: KPI Bonuses tables ───────────────────────────────────────

  // Bonus rules
  await db.query(`
    CREATE TABLE IF NOT EXISTS bonus_rules (
      id SERIAL PRIMARY KEY,
      kpi_name VARCHAR(50) UNIQUE NOT NULL,
      kpi_label VARCHAR(200),
      target_value DECIMAL(10,4) NOT NULL,
      operator VARCHAR(5) NOT NULL DEFAULT 'lt',
      bonus_pct DECIMAL(5,2) NOT NULL,
      applies_to_roles TEXT DEFAULT '',
      applies_to_sector_code VARCHAR(10),
      description TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Bonus calculations
  await db.query(`
    CREATE TABLE IF NOT EXISTS bonus_calculations (
      id SERIAL PRIMARY KEY,
      month_key VARCHAR(7) NOT NULL,
      personnel_id INTEGER NOT NULL REFERENCES personnel(id),
      bonus_rule_id INTEGER NOT NULL REFERENCES bonus_rules(id),
      kpi_actual_value DECIMAL(10,4),
      target_value DECIMAL(10,4),
      target_met BOOLEAN DEFAULT false,
      base_salary_eur DECIMAL(10,2),
      bonus_pct DECIMAL(5,2),
      bonus_amount_eur DECIMAL(10,2),
      hall_id INTEGER REFERENCES halls(id),
      status VARCHAR(20) DEFAULT 'calculated',
      approved_by INTEGER REFERENCES personnel(id),
      approved_at TIMESTAMP,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // ─── Phase 6: Traceability tables ──────────────────────────────────────

  // Traceability records
  await db.query(`
    CREATE TABLE IF NOT EXISTS traceability_records (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES animal_groups(id),
      dispatch_id INTEGER REFERENCES dispatch_orders(id),
      data JSONB NOT NULL DEFAULT '{}',
      generated_by INTEGER REFERENCES personnel(id),
      generated_at TIMESTAMP DEFAULT NOW(),
      notes TEXT,
      UNIQUE(group_id)
    )
  `);

  // Regulatory documents
  await db.query(`
    CREATE TABLE IF NOT EXISTS regulatory_documents (
      id SERIAL PRIMARY KEY,
      document_type VARCHAR(50) NOT NULL,
      reference_number VARCHAR(50) UNIQUE NOT NULL,
      title VARCHAR(300),
      period_from DATE,
      period_to DATE,
      related_entity_type VARCHAR(50),
      related_entity_id INTEGER,
      data JSONB NOT NULL DEFAULT '{}',
      status VARCHAR(20) DEFAULT 'draft',
      generated_by INTEGER REFERENCES personnel(id),
      generated_at TIMESTAMP DEFAULT NOW(),
      finalized_by INTEGER REFERENCES personnel(id),
      finalized_at TIMESTAMP,
      submitted_at TIMESTAMP,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Water consumption tracking (for early warning system)
  await db.query(`
    CREATE TABLE IF NOT EXISTS water_consumption (
      id SERIAL PRIMARY KEY,
      hall_id INTEGER NOT NULL REFERENCES halls(id),
      reading_date DATE NOT NULL,
      consumption_m3 NUMERIC(10,3) NOT NULL,
      animal_count INTEGER,
      liters_per_animal NUMERIC(8,2),
      recorded_by INTEGER REFERENCES personnel(id),
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(hall_id, reading_date)
    )
  `);

  // Indexes
  await db.query(`CREATE INDEX IF NOT EXISTS idx_water_hall_date ON water_consumption(hall_id, reading_date)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_animals_category ON animals(category)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_animals_status ON animals(status)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_animals_hall ON animals(current_hall_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_animals_ear_tag ON animals(ear_tag)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_events_animal ON events(animal_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_litters_birth_sow ON litters(birth_sow_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_litters_nurse_sow ON litters(nurse_sow_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_alerts_ack ON alerts(is_acknowledged)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_alert_notes_alert ON alert_notes(alert_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_kpi_date ON kpi_snapshots(snapshot_date)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_kpi_name ON kpi_snapshots(kpi_name)`);

  // Phase 2 indexes
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sales_type ON sales(sale_type)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sales_group ON sales(group_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_expenses_date ON expense_entries(entry_date)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_expenses_month ON expense_entries(month_key)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_expenses_category ON expense_entries(category)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_expenses_sector ON expense_entries(sector_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_inv_counts_date ON inventory_counts(count_date)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_inv_counts_comp ON inventory_counts(component_id)`);

  // Phase 3 indexes
  await db.query(`CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_silos_hall ON silos(hall_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_delivery_routes_date ON delivery_routes(route_date)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_delivery_routes_status ON delivery_routes(status)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_delivery_stops_route ON delivery_stops(route_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_dispatch_orders_status ON dispatch_orders(status)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_dispatch_orders_group ON dispatch_orders(group_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_disinfection_vehicle ON disinfection_logs(vehicle_id)`);

  // Phase 4 indexes
  await db.query(`CREATE INDEX IF NOT EXISTS idx_access_logs_personnel ON access_logs(personnel_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_access_logs_hall ON access_logs(hall_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_access_logs_created ON access_logs(created_at)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_violations_personnel ON biosecurity_violations(personnel_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_violations_type ON biosecurity_violations(violation_type)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_active_withdrawals_group ON active_withdrawals(group_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_active_withdrawals_status ON active_withdrawals(status)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_hygiene_hall ON hall_hygiene_pauses(hall_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_hygiene_status ON hall_hygiene_pauses(status)`);

  // Phase 5 indexes
  await db.query(`CREATE INDEX IF NOT EXISTS idx_bonus_calc_month ON bonus_calculations(month_key)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_bonus_calc_personnel ON bonus_calculations(personnel_id)`);

  // Phase 6 indexes
  await db.query(`CREATE INDEX IF NOT EXISTS idx_traceability_group ON traceability_records(group_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_regulatory_type ON regulatory_documents(document_type)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_regulatory_status ON regulatory_documents(status)`);

  // ─── Phase 7: AI Agent conversations ──────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS agent_conversations (
      id SERIAL PRIMARY KEY,
      session_id VARCHAR(64) NOT NULL,
      personnel_id INTEGER REFERENCES personnel(id),
      agent_mode VARCHAR(30) NOT NULL DEFAULT 'production',
      role VARCHAR(20) NOT NULL,
      content TEXT NOT NULL,
      tool_calls JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_agent_conv_session ON agent_conversations(session_id)`);

  // ─── App Settings (persists across reset) ─────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
}
