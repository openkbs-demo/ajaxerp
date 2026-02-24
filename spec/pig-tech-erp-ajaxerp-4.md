# Pig-Tech ERP AjaxERP 4

## Контекст

Фаза 1 (Ядро) покрива: 13 PostgreSQL таблици, 34 API действия, 8 SPA страници. Пълен жизнен цикъл (статус-машина с 8 прехода), управление на фуражи (4 рецепти, 15 компонента, фира 0.5%), KPI (8 показателя), система за аларми, 6 роли персонал.

Фаза 2 (Финанси + Отчети) покрива: +6 таблици, ~25 API действия, 4 SPA страници. Продажби (3 типа), разходи (4 категории), P&L, Големите 5 отчета, CSV експорт, финансови KPI.

Фаза 3 (Логистика) покрива: +6 таблици, ~21 API действия, 2 SPA страници. Управление на МПС, силози, маршрути за доставка с биосигурностна валидация, експедиция, дезинфекционен дневник, отчети ефективност.

**Фаза 4** добавя: Биосигурност и Карентни срокове — 48-часово правило за движение на персонал между сектори, дигитален контрол на достъп по зонова йерархия (бяла/сива/черна), heatmap на нарушения, карентни срокове при медикаменти с блокиране на експедиция, хигиенна пауза за халета (дезинфекция преди нови животни).

**Източник:** pig-tech.md — Секция 6 (Модул "Биосигурност и Движение на персонала"), Секция 6А (Дигитален контрол на достъпа), Секция 5А (Карентни срокове), Секция 5Г (Хигиенна пауза за халета), Секция 5Б (Heatmap на биосигурността).

---

## 1. Цели

- **G4-1.** Контрол на достъпа по зони: регистрация влизане/излизане на персонал в халета с проследяване на дата, час и зона
- **G4-2.** 48-часово правило: блокиране на достъп до сектор "Родилно" (FAR) ако служителят е бил в "Угояване" (FIN) или "Изолатор" през последните 48 часа
- **G4-3.** Heatmap на нарушения: визуален отчет за движението на персонала между зоните и регистрирани нарушения за период
- **G4-4.** Карентни срокове при медикаменти: дефиниране на карентен срок (дни) по медикамент, автоматична забрана за експедиция на група/животно преди изтичането му
- **G4-5.** Хигиенна пауза за халета: задължителен период на почистване и дезинфекция след изпразване, преди зачисляване на нови животни
- **G4-6.** Dashboard разширение: секция "Биосигурност" с нарушения днес, активни карентни срокове, халета в хигиенна пауза

---

## 2. Функционални изисквания

### 2.1 Контрол на достъпа (FR-4100)

- **FR-4101.** Регистрация влизане/излизане: `access.log` — personnel_id, hall_id, действие (`entry`/`exit`), метод (`manual`/`qr`), бележки. Автоматично определя зоната от `halls.biosecurity_zone`
- **FR-4102.** 48-часово правило: при `entry` в хале от сектор `FAR` (Родилно), системата проверява дали служителят е имал `entry` в сектор `FIN` (Угояване) през последните 48 часа. Ако да → грешка с описание на нарушението
- **FR-4103.** Override: `manager` или `veterinarian` може да направи forced entry с `override = true` + задължителна причина. Записва се като нарушение с `is_overridden = true`
- **FR-4104.** Зонова валидация за обратни преходи: влизане от черна → сива зона е позволено само ако е регистрирано преминаване през "душ" (потвърждение `shower_confirmed = true`)
- **FR-4105.** История на достъпа: списък записи с филтри (служител, хале, сектор, зона, период)
- **FR-4106.** Текущо местоположение: за всеки служител — последното хале, в което е влязъл без излизане

### 2.2 Нарушения и Heatmap (FR-4200)

- **FR-4201.** Автоматична регистрация на нарушение при: опит за нарушаване на 48h правило (блокиран), override влизане (допуснат с причина), влизане от черна→сива без душ
- **FR-4202.** Типове нарушения: `48h_rule`, `zone_reverse`, `shower_skip`, `unauthorized_access`
- **FR-4203.** Нарушение: severity (`critical`/`warning`), описание, служител, от хале → към хале, дата, resolved статус
- **FR-4204.** При критично нарушение → автоматична аларма в `alerts` (severity `critical`, category `biosecurity`)
- **FR-4205.** Heatmap данни: за период — брой влизания по служител × хале, брой нарушения по служител × хале. Агрегация за визуализация в таблица/матрица
- **FR-4206.** Резолюция на нарушение: `manager`/`veterinarian` може да маркира като resolved с бележки

### 2.3 Карентни срокове (FR-4300)

- **FR-4301.** Дефиниране карентен срок: за всеки медикамент от `medicine_catalog` — `withdrawal_days` (по подразбиране 0 = без карентен срок). Отделна таблица `medicine_withdrawals` с `medicine_id`, `withdrawal_days`, `applies_to` (all/finisher/weaner)
- **FR-4302.** При ветеринарно събитие с медикамент (от `events.record`): автоматичен запис в `active_withdrawals` — animal_id/group_id, medicine_id, start_date, end_date (start + withdrawal_days), статус (`active`/`expired`/`cleared`)
- **FR-4303.** Проверка при експедиция: `dispatch.create` и `dispatch.update` (към `loading`/`in_transit`) → проверка дали групата или животните в нея имат активен карентен срок. Ако да → грешка: "Група X има активен карентен срок за [медикамент] до [дата]. Експедиция блокирана."
- **FR-4304.** Ръчно освобождаване (clearing): `veterinarian` може ръчно да маркира карентен срок като `cleared` с причина (напр. лабораторен тест)
- **FR-4305.** Dashboard: списък активни карентни срокове с обратно броене (дни до изтичане)
- **FR-4306.** Аларма: 3 дни преди планирана експедиция, ако групата има активен карентен срок → warning аларма
- **FR-4307.** Автоматично изтичане: при `alerts.check` → проверка за `active_withdrawals` с `end_date < NOW()` → статус `expired`

### 2.4 Хигиенна пауза за халета (FR-4400)

- **FR-4401.** Стартиране хигиенна пауза: когато халето се изпразва (current_occupancy = 0 или ръчно) → запис `hall_hygiene_pauses` с `start_date`, `required_days` (по подразбиране 5 дни)
- **FR-4402.** Стъпки на хигиенна пауза: `started` → `cleaning_done` (потвърждение измиване) → `disinfection_done` (потвърждение дезинфекция) → `ready` (след изтичане на required_days от start_date)
- **FR-4403.** Блокиране зачисляване: при трансфер на животни в хале (`events.record` тип `transfer`) → проверка дали халето е в активна хигиенна пауза. Ако да → грешка: "Хале X е в хигиенна пауза до [дата]. Зачисляването е блокирано."
- **FR-4404.** Списък хигиенни паузи: с филтри (хале, статус, период)
- **FR-4405.** Ръчно завършване: при спешност `manager` може да приключи пауза преждевременно с причина

### 2.5 Разширения на съществуващи модули (FR-4500)

- **FR-4501.** `events.record` (тип `transfer`): при преместване на животно/група → автоматичен `access.log` за `performed_by`. Проверка на 48h правило за извършващия
- **FR-4502.** `events.record` (тип `vaccination`/`treatment`): при наличие на `medicine_id` с `withdrawal_days > 0` → автоматичен запис `active_withdrawals`
- **FR-4503.** `dispatch.create` / `dispatch.update`: проверка за активни карентни срокове за групата
- **FR-4504.** `dashboard`: нова секция "Биосигурност" — брой нарушения днес, активни карентни срокове, халета в хигиенна пауза, последни нарушения
- **FR-4505.** `alerts.check`: допълнителни проверки — карентни срокове близо до експедиция, хигиенни паузи изтичащи, автоматично expire на withdrawals

---

## 3. Потребителски истории

| ID | Роля | Действие | Цел |
|----|------|----------|-----|
| US-4-01 | Животновъд | Регистрирам влизане в хале | Системата знае кой къде е |
| US-4-02 | Животновъд | Опитвам да вляза в Родилно след като бях в Угояване | Системата ме блокира — 48h правило |
| US-4-03 | Мениджър | Override: допускам служител с причина | Спешен случай е документиран |
| US-4-04 | Мениджър | Отварям Heatmap за седмицата | Виждам кой служител е нарушил зони |
| US-4-05 | Ветеринар | Задавам карентен срок 14 дни за AmoxiVet | Системата ще блокира експедиция |
| US-4-06 | Ветеринар | Ваксинация с медикамент с карентен срок | Автоматично се създава withdrawal запис |
| US-4-07 | Мениджър | Създавам експедиция за група с активен withdrawal | Системата блокира с описание |
| US-4-08 | Ветеринар | Ръчно освобождавам карентен срок (лаб. тест) | Експедицията е разблокирана |
| US-4-09 | Мениджър | Стартирам хигиенна пауза за Хале 15 | 5 дни с потвърждение измиване/дезинфекция |
| US-4-10 | Животновъд | Опитвам трансфер в хале на хиг. пауза | Системата блокира |
| US-4-11 | Мениджър | Виждам Dashboard с биосигурност | Нарушения, карентни срокове, хигиена |
| US-4-12 | Мениджър | Списък нарушения за месеца | CSV експорт за анализ |

---

## 4. Критерии за приемане

- **AC-4-01.** `access.log` entry в хале FIN → следващ `access.log` entry в хале FAR в рамките на 48h → грешка "48-часово правило"
- **AC-4-02.** `access.log` entry в FAR с override=true → запис + нарушение с `is_overridden = true`
- **AC-4-03.** `access.log` entry в FAR 49 часа след FIN → успешно (правилото е изтекло)
- **AC-4-04.** `biosecurity.heatmap` за период → матрица служител × хале с брой влизания и нарушения
- **AC-4-05.** `medicine.setWithdrawal` AmoxiVet 14 дни → запис. Ваксинация на група с AmoxiVet → `active_withdrawals` с end_date = now + 14 дни
- **AC-4-06.** `dispatch.create` за група с активен withdrawal → грешка "Карентен срок за AmoxiVet до DD.MM.YYYY"
- **AC-4-07.** `dispatch.create` за група с expired withdrawal → успешно
- **AC-4-08.** `withdrawal.clear` от ветеринар → статус `cleared`, `dispatch.create` → успешно
- **AC-4-09.** `hall.startHygiene` за Хале 15 → запис с `required_days = 5`. Трансфер в Хале 15 → грешка "Хигиенна пауза"
- **AC-4-10.** `hall.confirmHygiene` cleaning + disinfection + 5 дни изтекли → статус `ready`. Трансфер → успешно
- **AC-4-11.** Dashboard секция "Биосигурност": нарушения днес, активни withdrawals, халета в пауза
- **AC-4-12.** Критично нарушение (48h override) → аларма в `alerts` + Pulse broadcast
- **AC-4-13.** CSV експорт за нарушения — коректен BOM, БГ заглавия

---

## 5. Нови DB таблици (5)

### `access_logs`
id, personnel_id → personnel, hall_id → halls, action (entry/exit), zone VARCHAR(20), sector_code VARCHAR(10), method (manual/qr) DEFAULT 'manual', shower_confirmed BOOLEAN DEFAULT false, override BOOLEAN DEFAULT false, override_reason TEXT, override_by → personnel, notes TEXT, created_at TIMESTAMP DEFAULT NOW()

### `biosecurity_violations`
id, personnel_id → personnel, violation_type (48h_rule/zone_reverse/shower_skip/unauthorized_access), source_hall_id → halls, target_hall_id → halls, severity (critical/warning), description TEXT, is_overridden BOOLEAN DEFAULT false, is_resolved BOOLEAN DEFAULT false, resolved_by → personnel, resolved_at TIMESTAMP, resolve_notes TEXT, created_at TIMESTAMP DEFAULT NOW()

### `medicine_withdrawals`
id, medicine_id → medicine_catalog (UNIQUE), withdrawal_days INTEGER NOT NULL DEFAULT 0, applies_to VARCHAR(20) DEFAULT 'all', notes TEXT, updated_at TIMESTAMP DEFAULT NOW()

### `active_withdrawals`
id, animal_id → animals, group_id → animal_groups, medicine_id → medicine_catalog, event_id → events, start_date DATE NOT NULL, end_date DATE NOT NULL, status (active/expired/cleared) DEFAULT 'active', cleared_by → personnel, cleared_at TIMESTAMP, clear_reason TEXT, created_at TIMESTAMP DEFAULT NOW()

### `hall_hygiene_pauses`
id, hall_id → halls, start_date DATE NOT NULL, required_days INTEGER DEFAULT 5, cleaning_confirmed BOOLEAN DEFAULT false, cleaning_confirmed_at TIMESTAMP, cleaning_confirmed_by → personnel, disinfection_confirmed BOOLEAN DEFAULT false, disinfection_confirmed_at TIMESTAMP, disinfection_confirmed_by → personnel, status (started/cleaning_done/disinfection_done/ready/cancelled) DEFAULT 'started', ready_date DATE, completed_at TIMESTAMP, completed_by → personnel, cancel_reason TEXT, notes TEXT, created_at TIMESTAMP DEFAULT NOW()

---

## 6. Нови API действия (~16)

| Действие | Описание |
|----------|----------|
| `access.log` | Регистрация влизане/излизане с 48h валидация |
| `access.history` | История на достъпа с филтри (служител, хале, период) |
| `access.check48h` | Проверка дали служител може да влезе в хале (48h правило) |
| `access.currentLocations` | Текущо местоположение на всички служители |
| `biosecurity.violations` | Списък нарушения с филтри |
| `biosecurity.resolve` | Маркиране нарушение като resolved |
| `biosecurity.heatmap` | Heatmap данни: влизания и нарушения по служител × хале |
| `biosecurity.summary` | Обобщение: нарушения днес/седмица, по тип, по сектор |
| `medicine.setWithdrawal` | Задаване/обновяване карентен срок за медикамент |
| `medicine.withdrawals` | Списък карентни срокове по медикаменти |
| `withdrawal.active` | Активни карентни срокове с обратно броене |
| `withdrawal.clear` | Ръчно освобождаване на карентен срок (само vet) |
| `hall.startHygiene` | Стартиране хигиенна пауза за хале |
| `hall.confirmHygiene` | Потвърждение етап (cleaning/disinfection/ready) |
| `hall.hygieneStatus` | Списък активни/приключили хигиенни паузи |
| `hall.cancelHygiene` | Отмяна хигиенна пауза (спешност, с причина) |

**Модифицирани:** `events.record` (+48h проверка при transfer, +withdrawal запис при vaccination/treatment), `dispatch.create`/`dispatch.update` (+withdrawal проверка), `dashboard` (+биосигурност секция), `alerts.check` (+withdrawal expire, +withdrawal vs dispatch предупреждение)

---

## 7. SPA страници

### Нови (1)

- **`/biosecurity`** — 4 таба:
  - **Достъп**: Форма за регистрация (избор служител + хале + действие). Таблица последни записи. Текущо местоположение на активен персонал. Цветово кодиране по зона (бяла=зелено, сива=жълто, черна=червено)
  - **Нарушения**: Таблица с филтри (период, тип, severity). Бутон "Разреши" за manager/vet. Статистика: по тип, по сектор. Бутон CSV експорт
  - **Хигиена халета**: Списък халета с текущ статус пауза. Бутони: "Старт пауза", "Потвърди измиване", "Потвърди дезинфекция", "Готово". Индикатор: дни от старт / необходими дни. Цветово кодиране (червено=в пауза, жълто=частично, зелено=готово)
  - **Карентни срокове**: Таблица медикаменти с текущ withdrawal_days (inline edit). Списък активни withdrawals с обратно броене. Бутон "Освободи" за vet

### Модифицирани

- **Layout.jsx** — +1 навигационен линк (&#128737; Биосигурност) между Експедиция и Аларми
- **App.jsx** — +1 Route (`/biosecurity`)
- **Dashboard.jsx** — +секция "Биосигурност" (нарушения днес, активни карентни срокове, халета в пауза)

---

## 8. Seed данни

- **Карентни срокове** за 5 медикамента от съществуващия каталог:
  - AmoxiVet: 14 дни
  - EnroFlox: 10 дни
  - IverPig: 21 дни
  - OxyTet: 7 дни
  - VitaBoost: 0 дни (без карентен срок)
- **Примерни access_logs**: 20 записа за последните 3 дни (различни служители и халета)
- **1 хигиенна пауза** в Хале 1 (status: `ready`, 5 дни)

---

## 9. Под-фази

- **4A:** DB таблици (5) + Seed данни + Access log CRUD
- **4B:** 48h правило + Нарушения + Heatmap
- **4C:** Карентни срокове (withdrawal rules + active tracking + dispatch block)
- **4D:** Хигиенна пауза за халета
- **4E:** Модификации на events.record, dispatch, dashboard, alerts.check
- **4F:** SPA — Biosecurity.jsx + Layout/App/Dashboard
- **4G:** Build, deploy, test

---

## 10. Ограничения

- Без RFID/QR хардуер — регистрацията е ръчна (dropdown избор на служител и хале)
- Без автоматично проследяване на реално местоположение — базирано на последен log запис
- Душ потвърждение е ръчно (checkbox), без сензорна интеграция
- 48h правилото проверява само сектори FAR vs FIN — по-сложни зонови правила са извън обхват
- Хигиенна пауза е фиксирани 5 дни по подразбиране — може да се промени ръчно при създаване
- Карентни срокове се прилагат само при dispatch — не при трансфери между халета

---

## 11. Извън обхвата

- RFID/QR интеграция за автоматична регистрация на достъп
- GPS/Bluetooth проследяване на персонал в реално време
- Автоматично заключване на врати/гардероби
- Интеграция с БАБХ/ВЕТИС документация (Фаза 6)
- KPI бонус калкулатор (Фаза 5)
- Проследимост seed-to-meat (Фаза 6)
- Сложни зонови правила (повече от 48h FAR↔FIN)
- Карентни срокове по партида суровина (lot-level tracking)

---

## 12. Критични файлове

| Файл | Действие |
|------|----------|
| `functions/api/db.mjs` | +5 таблици, +6 индекса, seed withdrawals/access_logs |
| `functions/api/index.mjs` | +16 action handlers, модификация events.record/dispatch/dashboard/alerts.check |
| `spa/src/App.jsx` | +1 Route, +1 import |
| `spa/src/components/Layout.jsx` | +1 навигационен линк |
| `spa/src/pages/Dashboard.jsx` | +секция "Биосигурност" |
| `spa/src/pages/Biosecurity.jsx` | НОВ — ~350 реда, 4 таба, 3 модала |

---

## 13. Верификация

1. `seed` → 5 withdrawal правила, 20 access logs, 1 хигиенна пауза ✓
2. `access.log` entry в FIN → entry в FAR <48h → блокирано ✓
3. `access.log` entry в FAR >48h след FIN → успешно ✓
4. `access.log` override → запис + нарушение ✓
5. `biosecurity.heatmap` → матрица служител × хале ✓
6. `medicine.setWithdrawal` AmoxiVet 14 дни → запис ✓
7. Ваксинация с AmoxiVet → `active_withdrawals` end_date +14 ✓
8. `dispatch.create` за група с активен withdrawal → блокирано ✓
9. `withdrawal.clear` → dispatch разблокирана ✓
10. `hall.startHygiene` → трансфер блокиран ✓
11. `hall.confirmHygiene` all steps + дни → ready, трансфер успешен ✓
12. Dashboard → биосигурност секция с реални данни ✓
13. CSV експорт нарушения → коректен BOM + БГ заглавия ✓

---

## 14. Оставащи фази от pig-tech.md

### Фаза 5: KPI Бонуси
- Автоматичен бонус калкулатор (3 типа: оцеляемост, тегло отбиване, FCR)
- Интеграция със salary.generate
- Месечно начисляване на бонуси

### Фаза 6: Проследимост + Регулаторни документи
- Seed-to-meat проследимост (партида → силоз → лекарства → родителско стадо)
- Електронен Дневник №1 (БАБХ)
- ВЕТИС интеграция
- ИАСРЖ регистър
