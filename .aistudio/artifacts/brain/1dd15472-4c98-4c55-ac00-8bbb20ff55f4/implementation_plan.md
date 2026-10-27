# Poolparty 300 Hardcopy Tickets, Batch Print Engine & Secured Gate Check-In

Expand the Poolparty ticketing platform with **300 pre-printed hardcopy passes** (`ORD-051`–`ORD-250` at UGX 20,000 and `VIP-021`–`VIP-120` at UGX 50,000) stored alongside—and strictly isolated from—the **70 existing online passes**, paired with print-ready PDF batch export, staff range activation, and authenticated single-scan gate admission.

## User Review & Critical Decisions

> [!IMPORTANT]
> **Zero Changes Applied Yet**: Per your instructions, no source files, Supabase migrations, ticket records, QR tokens, or payment flows have been modified. Review the architecture, database plan, rollout sequence, and risk mitigations below before approving execution.

- **Confirmed Decision — Inactive Until Sold**: All 300 hardcopy passes will be seeded as unactivated stock (`status = 'available'`, `payment_status = 'unpaid'`). Unsold or misplaced physical passes cannot be admitted at the gate until an admin activates specific ticket numbers or contiguous ranges (e.g., `ORD-051`–`ORD-075`) upon cash/agent sale.
- **Confirmed Decision — Dual Print Layouts**: Admins will be able to export hardcopy passes in both **A4 4-up print sheets** (4 tickets stacked per portrait A4 page with trim guides for print-shop guillotine cutting) and **single-pass `210 × 68 mm` voucher pages**, filtered by category or number range.
- **Confirmed Decision — Dedicated Gate Staff Passcode**: Gate check-in (`POST /api/tickets/verify-checkin`) will require a dedicated **`GATE_PASSCODE`** (with organizer `ADMIN_PASSCODE` also accepted), preventing public callers from burning tickets while keeping full Admin Dashboard controls (`ADMIN_PASSCODE`) restricted to organizers.
- **Confirmed Decision — Safe Guest Read-Only Scan**: Scanning a QR URL (`?verify=<qr_token>`) without gate staff login will display a **read-only pass authenticity card** (valid/unused, not yet activated, already admitted, or cancelled) via a non-mutating lookup that never marks `checked_in_at`.
- **Canonical QR Domain Safeguard (Recommended Default)**: Batch PDF rendering will support an explicit production base URL (`VITE_PUBLIC_APP_URL`, defaulting to `window.location.origin`) so physical passes printed from any admin session always encode the live production domain.

---

## 1. Overview & Core Concept

- **What It Does**: Adds 300 uniquely numbered, UUID-backed physical passes to `public.tickets`, isolates them from website checkout inventory, provides chunked print-shop PDF generation reusing the existing Canva artwork renderer, adds admin tools to activate/track hardcopy batches by agent or buyer, and locks gate check-in behind staff authentication.
- **Target Audience / Personas**:
  - **Event Organizers / Box Office Admins**: Generate print-ready PDFs for the print shop, allocate/activate numbered hardcopy batches for promoters or cash buyers, and audit online vs. hardcopy revenue separately.
  - **Gate Security Staff**: Sign in on mobile phones or scanner terminals with `GATE_PASSCODE` to verify and admit both online and hardcopy passes in one tap/scan without accessing financial or admin settings.
  - **Ticket Buyers**: Optionally scan their physical pass QR code with their phone camera to verify authenticity without accidentally consuming their single-entry admission.
- **Key Value**: Eliminates double-allocation between online buyers and physical stock, prevents stolen/unactivated print stock from entering the venue, closes the unauthenticated check-in vulnerability, and preserves 100% of existing online payment and inventory records.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Print-Shop Export Flow (Admin Dashboard → Hardcopy Passes Tab)**:
   - Organizer selects pass tier (`ORDINARY` `ORD-051`–`ORD-250` or `VIP` `VIP-021`–`VIP-120`), optional sub-range (e.g., `ORD-051` to `ORD-150`), and format (**A4 4-Up Print Sheet** or **210×68mm Individual Pages**).
   - Clicking **Export Print PDF** renders passes sequentially in chunks with a live progress counter (`Rendering 48 / 200 passes…`) and downloads the print-ready PDF with `[GUEST NAME]` set to `Official Hardcopy Pass` (or assigned buyer name).
2. **Hardcopy Sale & Range Activation Flow (Admin Dashboard → Hardcopy Passes Tab)**:
   - When selling physical passes at the box office or issuing a paid batch to a promoter, admin selects **Single Ticket** or **Number Range** (e.g., `VIP-021` to `VIP-030`), enters buyer/agent name and contact phone, and clicks **Activate Sold Passes**.
   - Selected rows transition atomically from `available / unpaid` to `issued / manual_paid` with a `PP-HC-...` order log for cash reconciliation. Unsold passes returned intact can be deactivated back to `available`; lost/stolen physical passes can be permanently **Voided (`cancelled`)**.
3. **Guest QR Self-Check vs. Gate Staff Admission Flow (`?verify=<qr_token>` & Gate Scanner)**:
   - **Unauthenticated Guest Scan**: Opening `${origin}?verify=<qr_token>` without a staff session routes to the verification view in **Read-Only Authenticity Mode**, showing pass tier, ticket number, channel (`Hardcopy` / `Online`), and status (`Valid — Ready for Gate Entry`, `Inactive — Not Yet Activated`, `Already Used`, or `Voided`), plus a clear notice: *"Read-only check — your pass has not been used."*
   - **Authenticated Gate Staff Scan**: Staff tap **Gate Staff Sign In**, enter `GATE_PASSCODE` once per session (`sessionStorage`), and immediately unlock live check-in. If opened from a `?verify=<qr_token>` camera scan (or scanned via USB wedge / manual entry), the pass is atomically verified and checked in (`ADMITTED` vs. `ALREADY_USED` vs. `UNPAID`). Hardcoded demo scan buttons (`VIP-001`, `ORD-001`, etc.) are removed so live inventory cannot be accidentally consumed.

### Visual Identity & Theme

- **Aesthetic Direction**: High-contrast dark event operations console consistent with the existing Poolparty night-resort palette (`#030712` / `#070e1b` / `#0d1522`), single-elevation bordered panels (`border-white/10`), zero nested card clutter, and tabular numerals (`tabular-nums font-mono`) across all ticket numbers, ranges, capacities, and UGX figures.
- **Color Palette & Semantic States**:
  - **Canvas & Surfaces**: Deep navy-slate background (`#080c14`) and structured panel surface (`#0d1522`).
  - **Tier & Action Accents**: Gold/Amber (`amber-400`) for primary actions and Ordinary pass indicators; Cyan (`cyan-400`) for VIP pass indicators.
  - **Semantic Verification States** (always paired with explicit icon + text label, never color alone): Emerald (`ADMITTED` / `VALID & UNUSED`), Amber (`UNPAID / NOT ACTIVATED`), Rose/Crimson (`ALREADY USED` / `VOIDED` / `INVALID`).
- **Typography & Layout**: Existing `Outfit` display headings paired with `Plus Jakarta Sans` UI copy and monospace tabular figures for `ORD-051`–`ORD-250`, `VIP-021`–`VIP-120`, timestamps, and UGX revenue totals. Compact `40px+` touch targets on mobile for one-handed gate operation.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Explicit `ticket_channel` Column (`'online' | 'hardcopy'`) + Ticket-Number Range Guard**
  - *Chosen Approach*: Add `ticket_channel` (`default 'online'`) to `public.tickets` so rows `ORD-001`–`ORD-050` and `VIP-001`–`VIP-020` remain `'online'` while `ORD-051`–`ORD-250` and `VIP-021`–`VIP-120` are `'hardcopy'`, reinforced by a server-side range helper if PostgREST schema cache is temporarily stale.
  - *Why*: Guarantees online website checkouts (`getPublicCounts`, `reserveTicketsDirect`, `initiateMtnMerchantReservation`, `reserve_tickets_atomic`) only ever count and lock the 70 online passes—without touching Relworx or MTN payment logic.
  - *Alternatives Considered*: A separate `hardcopy_tickets` table was rejected because Requirement 2 & 5 require storing all 370 passes in `public.tickets` and using the unified gate scanner and atomic check-in logic.
- **Decision 2: Inactive-First Hardcopy Stock vs. Voiding Lost Passes**
  - *Chosen Approach*: Seed hardcopy passes as `available` + `unpaid` (rejected as `UNPAID / NOT ACTIVATED` at the gate), activate to `issued` + `manual_paid` on sale, return intact unsold agent returns to `available` + `unpaid`, and mark lost/stolen physical passes `cancelled` (never rotating `qr_token` on pre-printed paper stock).
  - *Why*: Rotating `qr_token` on a physical printed card would permanently desynchronize the paper QR from the database. Keeping `qr_token` immutable for hardcopy rows while controlling `status` (`available` → `issued` → `cancelled`) matches physical print reality.
- **Decision 3: Role-Scoped Gate Authentication (`GATE_PASSCODE` vs. `ADMIN_PASSCODE`)**
  - *Chosen Approach*: Introduce `requireGateAuth` accepting either `GATE_PASSCODE` (gate-only scope) or `ADMIN_PASSCODE` (organizer superset scope), alongside a strictly read-only UUID-only `GET /api/tickets/public-status` endpoint for unauthenticated QR scans.
  - *Why*: Prevents attackers or curious buyers from checking in tickets via `/api/tickets/verify-checkin`, prevents sequential ticket-number scraping on public routes, and keeps gate bouncers out of financial/admin actions.

---

## 4. Technical Architecture & Data Strategy

### Architecture & Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         SUPABASE POSTGRESQL DATABASE                         │
│  public.tickets (370 rows total — 70 preserved online + 300 new hardcopy)    │
│  ├─ Online Pool (70):   ORD-001..050 (50), VIP-001..020 (20) [channel=online]│
│  ├─ Hardcopy Pool (300): ORD-051..250 (200), VIP-021..120 (100) [hardcopy]   │
│  ├─ Columns added: ticket_channel, assigned_agent, activated_by              │
│  └─ Atomic Check-In: gate_checkin_atomic (FOR UPDATE) + CAS fallback         │
└───────────────┬──────────────────────────────┬───────────────────────────────┘
                │                              │
     Online Pool Only                 Admin & Gate Endpoints
  (No payment code changes)                    │
                ▼                              ▼
┌───────────────────────────────┐  ┌───────────────────────────────────────────┐
│ Public Website Checkout       │  │ Express / Vercel API                      │
│ • GET /api/inventory/counts   │  │ • POST /api/gate/auth (GATE_PASSCODE)     │
│   (filters channel='online')  │  │ • GET  /api/tickets/public-status (RO)    │
│ • Existing Relworx / MTN      │  │ • POST /api/tickets/verify-checkin (Auth) │
│   reservation queries         │  │ • GET  /api/gate/recent-checkins (Auth)   │
│   (isolated from hardcopy)    │  │ • POST /api/admin/hardcopy/activate (Adm) │
└───────────────────────────────┘  │ • POST /api/admin/hardcopy/status (Adm)   │
                                   └───────────┬───────────────────┬───────────┘
                                               │                   │
                              ┌────────────────┘                   └──────────────┐
                              ▼                                                   ▼
┌─────────────────────────────────────────────┐  ┌────────────────────────────────────────────┐
│ Admin Dashboard (Hardcopy & Print Tab)      │  │ Gate Scanner & URL ?verify=<qr_token>      │
│ • Separate Online (70) vs Hardcopy (300)    │  │ • Guest Mode (unauthenticated):            │
│   KPIs, search, agent/status filters        │  │   Read-only pass validity (no check-in)    │
│ • Single & range activation (e.g. 051–075)  │  │ • Staff Mode (GATE_PASSCODE session):      │
│ • TicketRenderer Batch PDF Engine:          │  │   Auto-verifies ?verify= token, wedge scan │
│   - A4 4-Up Sheets (with cut guides)        │  │   or ticket #, atomic duplicate guard      │
│   - 210×68mm Single-Ticket Pages            │  └────────────────────────────────────────────┘
└─────────────────────────────────────────────┘
```

### Database Changes Needed (New Non-Destructive SQL Migration)

A new idempotent SQL migration (`supabase/migrations/20261028_add_300_hardcopy_tickets.sql`) to be run in Supabase SQL Editor after plan approval:

1. **Non-Destructive Column Additions on `public.tickets`**:
   - `ticket_channel text not null default 'online' check (ticket_channel in ('online', 'hardcopy'))` (all 70 existing rows remain `'online'` automatically).
   - `assigned_agent text` (optional promoter/seller tracking for hardcopy batches).
   - `activated_by text` (audit trail of admin/staff who activated hardcopy passes).
   - Index on `(ticket_channel, category, status)` for fast inventory filtering.
2. **Idempotent Seed of 300 Hardcopy Tickets (`ON CONFLICT (ticket_number) DO NOTHING`)**:
   - **200 Ordinary Hardcopy (`ORD-051`–`ORD-250`)**: `generate_series(51, 250)` → `category = 'ORDINARY'`, `price_ugx = 20000`, `status = 'available'`, `payment_status = 'unpaid'`, `ticket_channel = 'hardcopy'`, `qr_token = gen_random_uuid()`.
   - **100 VIP Hardcopy (`VIP-021`–`VIP-120`)**: `generate_series(21, 120)` → `category = 'VIP'`, `price_ugx = 50000`, `status = 'available'`, `payment_status = 'unpaid'`, `ticket_channel = 'hardcopy'`, `qr_token = gen_random_uuid()`.
   - Existing 70 rows (`ORD-001`–`ORD-050`, `VIP-001`–`VIP-020`) and their `qr_token` values are untouched.
3. **Stored Procedure Updates & Schema Cache Reload**:
   - Update `public.reserve_tickets_atomic(...)` (if used) to include `AND ticket_channel = 'online'` so online reservations never lock hardcopy rows.
   - Install/refresh `public.gate_checkin_atomic(p_token_or_number text)` with `FOR UPDATE` row locking and channel-aware `UNPAID` message for unactivated hardcopy passes.
   - Execute `NOTIFY pgrst, 'reload schema';`.

### Exact Files to Modify / Create

1. **`supabase/migrations/20261028_add_300_hardcopy_tickets.sql`** *(new)*: Non-destructive `ALTER TABLE`, 300-row idempotent `INSERT ... ON CONFLICT (ticket_number) DO NOTHING`, updated `reserve_tickets_atomic` online-channel filter, `gate_checkin_atomic` RPC, and `NOTIFY pgrst, 'reload schema'`.
2. **`.env.example`**: Document `GATE_PASSCODE` (dedicated gate scanner credential) and optional `VITE_PUBLIC_APP_URL` (canonical domain for printed QR URLs).
3. **`src/types/inventory.ts`**: Add `TicketChannel = 'online' | 'hardcopy'`, optional `ticket_channel`, `assigned_agent`, `activated_by` fields on `TicketRecord`, separate `hardcopy` summary metrics in `InventoryDashboardStats`, and `PublicTicketStatusResult` type for read-only QR checks.
4. **`src/server/supabaseServer.ts`**:
   - Filter online availability & reservation queries (`getPublicCounts`, `reserveTicketsDirect`, `initiateMtnMerchantReservation`) to online tickets (`ticket_channel = 'online'` with ticket-number range fallback if schema cache lags) — **zero changes to Relworx or MTN payment processing**.
   - Fix the UUID-vs-`ticket_number` query bug in `verifyAndCheckIn` fallback (use `.eq('qr_token', clean)` when UUID, `.eq('ticket_number', clean.toUpperCase())` when ticket code) while preserving `.eq('id', ticket.id).is('checked_in_at', null)` atomic duplicate-scan protection.
   - Add `getPublicTicketStatusByToken(qrToken)` (strictly read-only `SELECT` by UUID `qr_token` only; never mutates `checked_in_at`; redacts PII).
   - Add `getRecentCheckInsGate(limit)` (minimal check-in log for gate staff without full admin ticket dump).
   - Add `activateHardcopyBatchAdmin(...)` (single ticket or range activation, sets `issued` + `manual_paid`, records `PP-HC-...` cash/agent order) and `updateHardcopyStatusAdmin(...)` (return un-scanned pass to unactivated `available` or mark lost pass `cancelled`, never altering `qr_token`).
5. **`src/server/app.ts`**:
   - Add `requireGateAuth` middleware accepting `GATE_PASSCODE` or `ADMIN_PASSCODE` via `Authorization: Bearer ...` / `x-gate-key`.
   - Protect `POST /api/tickets/verify-checkin` with `requireGateAuth` (closing the unauthenticated check-in hole).
   - Add `POST /api/gate/auth` (validates gate passcode), `GET /api/gate/recent-checkins` (`requireGateAuth`), and `GET /api/tickets/public-status` (read-only UUID check).
   - Add `POST /api/admin/hardcopy/activate` and `POST /api/admin/hardcopy/status` (`requireAdminAuth`).
6. **`src/lib/ticketRenderer.ts`**:
   - Support optional `baseUrl` (`import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin`) and default label `'Official Hardcopy Pass'` when `ticket_channel === 'hardcopy'` and `buyer_name` is null.
   - Add `downloadPrintReadyA4SheetsPdf(tickets, options)` (4 passes per portrait A4 sheet `210 × 297 mm` with corner trim marks and chunked async rendering + progress callback) and `downloadBatchVoucherPdf(tickets, options)` (chunked `210 × 68 mm` pages with progress callback).
7. **`src/lib/ticketService.ts`**: Add client methods for gate login/session token (`sessionStorage`), authenticated `verifyAndCheckIn`, read-only `getPublicTicketStatus`, `getRecentGateCheckIns`, and admin hardcopy batch activation/status updates.
8. **`src/App.tsx`** & **`src/components/scanner/GateScanner.tsx`**:
   - Pass `?verify=<qr_token>` from `App.tsx` into `GateScanner` (and clean URL state safely).
   - In `GateScanner.tsx`: implement **Read-Only Guest Verification View** when unauthenticated, **Gate Staff Passcode Sign-In** bar/modal, auto-verification of `?verify=` token when staff is authenticated, `getRecentGateCheckIns()` audit feed, and removal of the 4 hardcoded live-ticket test buttons.
9. **`src/components/admin/AdminDashboard.tsx`**:
   - Separate inventory KPIs into **Online Pool (70)** and **Hardcopy Pool (300: 200 Ordinary, 100 VIP)**.
   - Add a **Hardcopy & Batch Print** tab with range/tier filters, single & range sale activation form (agent/buyer name, phone, notes), void/return actions, and batch PDF export controls (A4 4-up sheets vs. `210×68mm` voucher pages with live rendering progress).
   - Include the new non-destructive 300-hardcopy SQL script in the Setup Guide tab for easy copy-paste into Supabase SQL Editor.
10. **`test/supabase-ticketing.test.ts`**:
    - Update check-in test #9 for `requireGateAuth` (`401` when unauthenticated, `200` with `GATE_PASSCODE`, gate passcode rejected on `/api/admin/*`).
    - Add tests for read-only `GET /api/tickets/public-status` (never sets `checked_in_at`, rejects sequential ticket numbers), online-vs-hardcopy inventory isolation, hardcopy batch activation, UUID vs. `ORD-051`/`VIP-021` lookup, and concurrent duplicate-scan rejection.

### Implementation Order

1. **Step 1 — Types & SQL Migration Artifact**: Update `src/types/inventory.ts`, `.env.example`, and write `supabase/migrations/20261028_add_300_hardcopy_tickets.sql` (without running destructive queries or touching payment services).
2. **Step 2 — Backend Isolation, Hardcopy Admin Operations & Gate Auth**: Update `src/server/supabaseServer.ts` and `src/server/app.ts` to isolate online counts/reservations to the 70 online passes, add `requireGateAuth`, add read-only `public-status`, fix the UUID/`ticket_number` fallback check-in query, and add hardcopy batch activation endpoints.
3. **Step 3 — Batch Print Engine (`TicketRenderer`) & Client Service (`TicketService`)**: Add A4 4-up cut-sheet and chunked `210×68mm` PDF generators with progress callbacks in `src/lib/ticketRenderer.ts`, plus gate/hardcopy API wrappers in `src/lib/ticketService.ts`.
4. **Step 4 — Gate Scanner & `?verify=` Handoff**: Update `src/App.tsx` and `src/components/scanner/GateScanner.tsx` with `?verify=` token plumbing, guest read-only authenticity view, `GATE_PASSCODE` staff login, and removal of hardcoded test-scan buttons.
5. **Step 5 — Admin Dashboard Hardcopy Management & Print Studio**: Update `src/components/admin/AdminDashboard.tsx` to track Online (70) vs. Hardcopy (300) separately, activate hardcopy ranges, and export print-ready PDFs.
6. **Step 6 — Automated Tests & Production Build Verification**: Update and run `npm test`, `lint_applet`, and `compile_applet` (`npm run build`), then provide the exact Supabase SQL Editor execution steps.

### Key Risks & Mitigations

| Risk | Impact | Mitigation in Plan |
| :--- | :--- | :--- |
| **Online checkout accidentally claims a hardcopy pass** | An online buyer and a physical pass holder receive the same ticket number (`ORD-051`). | Dual guard: `ticket_channel = 'online'` filter on all public count & reservation queries **plus** a ticket-number range guard (`ORD-001`–`ORD-050`, `VIP-001`–`VIP-020`) if PostgREST schema cache hasn't reloaded yet. |
| **Wrong domain baked into printed QR codes** | Printing 300 passes while viewing `localhost` or a staging URL encodes a non-production URL in physical ink. | `TicketRenderer` checks `VITE_PUBLIC_APP_URL` (and Admin Print UI displays & lets the admin confirm the exact domain encoded into the QR before generating the PDF). |
| **Browser memory spike rendering 200 high-res canvases (`2000×647`)** | Tab freezes or crashes mid-export when generating a 200-ticket PDF. | Reuse a single offscreen `<canvas>`, pre-load the Canva template `HTMLImageElement` once per batch instead of 200 times, yield to the event loop every 5 passes, and stream compressed JPEG pages into `jsPDF` with a progress bar. |
| **Unactivated hardcopy passes handed to promoters** | Buyer arrives at gate before promoter reports the sale; gate scan shows `UNPAID`. | Activate ranges (`ORD-051`–`ORD-075`) when issuing stock to trusted sellers or upon cash settlement; gate `UNPAID` screen clearly labels `"Hardcopy Pass Not Yet Activated"` so box office can verify and activate in seconds. |
| **Printed pass lost/stolen vs. returned unsold** | Releasing a stolen pass back to `available` leaves its printed QR in the wild; rotating `qr_token` breaks intact returned paper stock. | Provide two distinct admin actions: **Return to Unsold Stock** (`available` + `unpaid`, keeps printed `qr_token` for intact cards) vs. **Void Lost/Stolen Card** (`cancelled`, permanently blocks the printed QR). |
| **`GATE_PASSCODE` missing in Vercel production env** | Gate staff cannot sign in on event day if env var was forgotten. | `requireGateAuth` always accepts `ADMIN_PASSCODE` as organizer fallback, and `/api/admin/health` explicitly reports whether `GATE_PASSCODE` is configured. |
