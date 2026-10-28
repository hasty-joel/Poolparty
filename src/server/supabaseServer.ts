import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import {
  RelworxService,
  CUSTOMER_PAYMENTS_UNAVAILABLE_MESSAGE,
  sanitizeDiagnosticText,
} from './relworxService.js';
import { MtnMoMoService } from './mtnMoMoService.js';
import { safeCompareSecret } from './gateSecurity.js';
import type { OrderRecord, OrderStatus, PaymentNetwork, VerificationStatus } from '../types/order.js';

dotenv.config();

type InitiationResult = {
  success: boolean;
  orderRef?: string;
  message: string;
  relworxInternalRef?: string | null;
  reservedUntil?: string;
  totalAmountUgx?: number;
  gateway?: 'relworx';
  error?: string;
  code?: string;
  retryable?: boolean;
  retryAfterSeconds?: number;
  reusedExistingOrder?: boolean;
};

// Coalesces concurrent identical submissions to prevent duplicate orders and duplicate charges
const _inFlightInitiations = new Map<string, Promise<InitiationResult>>();
const _recentIdempotencyResults = new Map<string, { expiresAt: number; result: InitiationResult }>();

interface MtnSubmissionRecord {
  orderRef: string;
  mtnTransactionId: string;
  payerPhone: string;
  verificationStatus: VerificationStatus;
  submittedAt: string;
  verifiedAt?: string;
  verifiedBy?: string;
  rejectionReason?: string;
  notes?: string;
}

const _mtnSubmissionsByTxId = new Map<string, MtnSubmissionRecord>();
const _mtnSubmissionsByOrderRef = new Map<string, MtnSubmissionRecord>();

function sanitizeEnv(val: string | undefined): string | undefined {
  if (!val) return undefined;
  const cleaned = val.trim().replace(/^["']|["']$/g, '').trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function getSupabaseEnv() {
  const url = sanitizeEnv(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  );
  const serviceKey = sanitizeEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return { url, serviceKey };
}

function detectJwtRole(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf-8');
    const payload = JSON.parse(json);
    return typeof payload?.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

function isSupabaseEnvValid(url?: string, serviceKey?: string): boolean {
  return Boolean(
    url &&
      serviceKey &&
      !url.includes('your-project') &&
      !url.includes('placeholder') &&
      !url.includes('example') &&
      url.startsWith('https://') &&
      serviceKey.length > 20 &&
      !serviceKey.includes('your-supabase-service-role-key')
  );
}

let _cachedClient: SupabaseClient | null = null;
let _cachedKeySig = '';

function getSupabaseClient(): { client: SupabaseClient | null; configError?: string } {
  const { url, serviceKey } = getSupabaseEnv();

  if (!isSupabaseEnvValid(url, serviceKey)) {
    return {
      client: null,
      configError: 'Ticketing database is not configured on the server. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    };
  }

  const jwtRole = detectJwtRole(serviceKey);
  if (jwtRole === 'anon') {
    return {
      client: null,
      configError: 'Server database configuration error: SUPABASE_SERVICE_ROLE_KEY is set to an anon key instead of the service_role key.',
    };
  }

  const sig = `${url}|${serviceKey}`;
  if (!_cachedClient || _cachedKeySig !== sig) {
    _cachedClient = createClient(url!, serviceKey!, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    _cachedKeySig = sig;
  }

  return { client: _cachedClient };
}

const initialEnv = getSupabaseEnv();
export const isLiveSupabaseAvailable = isSupabaseEnvValid(initialEnv.url, initialEnv.serviceKey);
export const supabaseAdmin: SupabaseClient | null = getSupabaseClient().client;

export interface PublicInventoryCounts {
  VIP: {
    total: number;
    available: number;
    priceUgx: number;
  };
  ORDINARY: {
    total: number;
    available: number;
    priceUgx: number;
  };
  totalAvailable: number;
  isLiveSupabase: boolean;
}

export interface TicketRow {
  id: string;
  ticket_number: string;
  category: 'VIP' | 'ORDINARY';
  price_ugx: number;
  status: 'available' | 'reserved' | 'issued' | 'cancelled';
  payment_status: 'unpaid' | 'pending' | 'paid' | 'failed' | 'refunded' | 'manual_paid';
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  qr_token: string;
  created_at: string;
  paid_at: string | null;
  checked_in_at: string | null;
  ticket_channel?: 'online' | 'hardcopy';
  assigned_agent?: string | null;
  activated_by?: string | null;
  activated_at?: string | null;
  hardcopy_batch_ref?: string | null;
  order_ref?: string | null;
  reserved_until?: string | null;
  mtn_transaction_id?: string | null;
  relworx_internal_ref?: string | null;
  flw_transaction_id?: string | null;
}

export interface HardcopyAuditRow {
  id: string;
  batch_ref: string;
  action: 'activate_single' | 'activate_range' | 'deactivate_return' | 'void_cancel';
  category: 'VIP' | 'ORDINARY';
  ticket_numbers: string[];
  quantity: number;
  unit_price_ugx: number;
  total_amount_ugx: number;
  agent_or_seller: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  performed_by: string;
  notes: string | null;
  created_at: string;
}

export type OrderRow = OrderRecord;

export interface PublicLookupTicketSummary {
  ticket_number: string;
  category: 'VIP' | 'ORDINARY';
  price_ugx: number;
  status: 'issued';
  payment_status: 'paid' | 'manual_paid';
  buyer_name: string | null;
  order_ref: string | null;
  paid_at: string | null;
  checked_in_at: string | null;
}

const UUID_STRICT_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TICKET_NUMBER_STRICT_REGEX = /^(VIP|ORD)-(\d{3,4})$/i;
export const ORDER_REF_STRICT_REGEX = /^PP-(?:MTN|RWX|MOMO|BOX|FLW)-[A-Z0-9-]{4,64}$/i;
const EMAIL_STRICT_REGEX = /^[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,190}\.[A-Z]{2,24}$/i;

export function normalizeStrictOrderRef(raw: string): { valid: boolean; orderRef: string } {
  const trimmed = String(raw || '').trim();
  if (!ORDER_REF_STRICT_REGEX.test(trimmed)) {
    return { valid: false, orderRef: '' };
  }
  return { valid: true, orderRef: trimmed.toUpperCase() };
}

export const HARDCOPY_RANGES = {
  ORDINARY: { min: 1, max: 150, prefix: 'ORD', unitPriceUgx: 20000 },
  VIP: { min: 1, max: 50, prefix: 'VIP', unitPriceUgx: 50000 },
} as const;

export const ONLINE_RANGES = {
  ORDINARY: { min: 151, max: 250, prefix: 'ORD', unitPriceUgx: 20000 },
  VIP: { min: 51, max: 120, prefix: 'VIP', unitPriceUgx: 50000 },
} as const;

/**
 * Extracts raw token/ticket code even if a full `?verify=<token>` URL was scanned or pasted.
 */
export function extractVerificationInput(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  if (trimmed.includes('verify=')) {
    const match = trimmed.match(/[?&]verify=([^&#\s]+)/i) || trimmed.match(/verify=([^&#\s]+)/i);
    if (match && match[1]) {
      try {
        return decodeURIComponent(match[1]).trim();
      } catch {
        return match[1].trim();
      }
    }
  }
  return trimmed;
}

/**
 * Determines ticket channel from canonical ticket_number boundaries:
 * - Hardcopy: ORD-001..ORD-150 (150), VIP-001..VIP-050 (50)
 * - Online:   ORD-151..ORD-250 (100), VIP-051..VIP-120 (70)
 */
export function inferTicketChannelFromNumber(ticketNumber: string): 'online' | 'hardcopy' {
  const match = String(ticketNumber || '').trim().toUpperCase().match(TICKET_NUMBER_STRICT_REGEX);
  if (!match) return 'online';
  const prefix = match[1] as 'VIP' | 'ORD';
  const num = parseInt(match[2], 10);
  if (prefix === 'VIP') {
    return num <= HARDCOPY_RANGES.VIP.max ? 'hardcopy' : 'online';
  }
  return num <= HARDCOPY_RANGES.ORDINARY.max ? 'hardcopy' : 'online';
}

/**
 * Defense-in-depth predicate ensuring hardcopy tickets are NEVER treated as online inventory.
 */
export function isOnlineTicketRow(row: {
  ticket_number?: string | null;
  ticket_channel?: string | null;
}): boolean {
  if (row.ticket_channel === 'hardcopy') return false;
  if (row.ticket_number && inferTicketChannelFromNumber(row.ticket_number) === 'hardcopy') {
    return false;
  }
  return true;
}

function parseSingleTicketCode(raw: string): {
  valid: boolean;
  category?: 'VIP' | 'ORDINARY';
  num?: number;
  formatted?: string;
} {
  const match = String(raw || '').trim().toUpperCase().match(TICKET_NUMBER_STRICT_REGEX);
  if (!match) return { valid: false };
  const prefix = match[1] as 'VIP' | 'ORD';
  const num = parseInt(match[2], 10);
  if (!Number.isInteger(num) || num < 1) return { valid: false };
  const category = prefix === 'VIP' ? 'VIP' : 'ORDINARY';
  return {
    valid: true,
    category,
    num,
    formatted: `${prefix}-${String(num).padStart(3, '0')}`,
  };
}

export function sanitizeCheckInTicket(raw: Partial<TicketRow> | undefined | null): TicketRow | undefined {
  if (!raw || !raw.id || !raw.ticket_number || !raw.category) return undefined;
  const channel: 'online' | 'hardcopy' =
    raw.ticket_channel === 'hardcopy' || inferTicketChannelFromNumber(raw.ticket_number) === 'hardcopy'
      ? 'hardcopy'
      : 'online';

  return {
    id: raw.id,
    ticket_number: raw.ticket_number,
    category: raw.category,
    price_ugx: Number(raw.price_ugx || 0),
    status: (raw.status as TicketRow['status']) || 'available',
    payment_status: (raw.payment_status as TicketRow['payment_status']) || 'unpaid',
    buyer_name: raw.status === 'issued' ? (raw.buyer_name || null) : null,
    buyer_email: null,
    buyer_phone: null,
    qr_token: '[REDACTED]',
    created_at: raw.created_at || '',
    paid_at: raw.paid_at || null,
    checked_in_at: raw.checked_in_at || null,
    ticket_channel: channel,
  };
}

export function parseHardcopySelection(params: {
  ticketNumber?: string;
  ticketNumbers?: string[];
  category?: string;
  startNumber?: string | number;
  endNumber?: string | number;
}): {
  valid: boolean;
  category?: 'VIP' | 'ORDINARY';
  ticketNumbers?: string[];
  isRange?: boolean;
  error?: string;
  message?: string;
  conflictingTickets?: string[];
} {
  if (params.category !== undefined && params.category !== null && String(params.category).trim() !== '') {
    const normalizedCat = String(params.category).trim().toUpperCase();
    if (normalizedCat !== 'VIP' && normalizedCat !== 'ORDINARY') {
      return {
        valid: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid category. Must be VIP or ORDINARY.',
      };
    }
  }

  const hasSingle =
    params.ticketNumber !== undefined && params.ticketNumber !== null && String(params.ticketNumber).trim() !== '';
  const hasList = Array.isArray(params.ticketNumbers);
  const hasRange = params.startNumber !== undefined || params.endNumber !== undefined;

  const modeCount = Number(hasSingle) + Number(hasList) + Number(hasRange);
  if (modeCount > 1) {
    return {
      valid: false,
      error: 'VALIDATION_ERROR',
      message: 'Provide only one selection mode: ticketNumber (single), ticketNumbers (batch list), OR startNumber/endNumber (range).',
    };
  }

  // Mode A: Explicit batch list (validates duplicates, format, category, and hardcopy bounds)
  if (hasList) {
    const rawList = params.ticketNumbers!;
    if (rawList.length < 1 || rawList.length > 200) {
      return {
        valid: false,
        error: 'VALIDATION_ERROR',
        message: 'ticketNumbers batch must contain between 1 and 200 tickets.',
      };
    }

    const seen = new Set<string>();
    const duplicates = new Set<string>();
    const formattedList: string[] = [];
    let resolvedCategory: 'VIP' | 'ORDINARY' | undefined =
      params.category && String(params.category).trim()
        ? (String(params.category).trim().toUpperCase() as 'VIP' | 'ORDINARY')
        : undefined;

    for (const item of rawList) {
      if (typeof item !== 'string' || !item.trim()) {
        return {
          valid: false,
          error: 'VALIDATION_ERROR',
          message: 'ticketNumbers batch cannot contain null or blank entries.',
        };
      }

      const parsed = parseSingleTicketCode(item);
      if (!parsed.valid || !parsed.category || parsed.num === undefined || !parsed.formatted) {
        return {
          valid: false,
          error: 'VALIDATION_ERROR',
          message: `Invalid ticket number "${String(item).trim()}". Expected ORD-001..ORD-150 or VIP-001..VIP-050.`,
        };
      }

      if (seen.has(parsed.formatted)) {
        duplicates.add(parsed.formatted);
      }
      seen.add(parsed.formatted);

      if (resolvedCategory && parsed.category !== resolvedCategory) {
        return {
          valid: false,
          error: 'CATEGORY_MISMATCH',
          message: `Ticket ${parsed.formatted} does not match category ${resolvedCategory}.`,
          conflictingTickets: [parsed.formatted],
        };
      }
      resolvedCategory = resolvedCategory || parsed.category;

      const bounds = HARDCOPY_RANGES[parsed.category];
      const onlineBounds = ONLINE_RANGES[parsed.category];
      if (parsed.num >= onlineBounds.min && parsed.num <= onlineBounds.max) {
        return {
          valid: false,
          error: 'ONLINE_TICKET_FORBIDDEN',
          message: `${parsed.formatted} belongs to the online ticket pool and cannot be managed as a hardcopy ticket.`,
          conflictingTickets: [parsed.formatted],
        };
      }
      if (parsed.num < bounds.min || parsed.num > bounds.max) {
        return {
          valid: false,
          error: 'OUT_OF_HARDCOPY_RANGE',
          message: `Hardcopy ${parsed.category} tickets must be within ${bounds.prefix}-${String(bounds.min).padStart(3, '0')} to ${bounds.prefix}-${String(bounds.max).padStart(3, '0')}.`,
          conflictingTickets: [parsed.formatted],
        };
      }

      formattedList.push(parsed.formatted);
    }

    if (duplicates.size > 0) {
      return {
        valid: false,
        error: 'DUPLICATE_TICKET_NUMBERS',
        message: 'Duplicate ticket numbers are not permitted in a batch.',
        conflictingTickets: Array.from(duplicates).sort(),
      };
    }

    formattedList.sort();
    return {
      valid: true,
      category: resolvedCategory!,
      ticketNumbers: formattedList,
      isRange: formattedList.length > 1,
    };
  }

  // Mode B: Single ticket activation/update
  if (hasSingle) {
    const parsed = parseSingleTicketCode(String(params.ticketNumber));
    if (!parsed.valid || !parsed.category || parsed.num === undefined || !parsed.formatted) {
      return {
        valid: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid ticket number format. Expected ORD-001..ORD-150 or VIP-001..VIP-050.',
      };
    }

    if (params.category && String(params.category).trim().toUpperCase() !== parsed.category) {
      return {
        valid: false,
        error: 'CATEGORY_MISMATCH',
        message: `Ticket ${parsed.formatted} does not match category ${params.category}.`,
      };
    }

    const bounds = HARDCOPY_RANGES[parsed.category];
    const onlineBounds = ONLINE_RANGES[parsed.category];
    if (parsed.num >= onlineBounds.min && parsed.num <= onlineBounds.max) {
      return {
        valid: false,
        error: 'ONLINE_TICKET_FORBIDDEN',
        message: `${parsed.formatted} belongs to the online ticket pool (${onlineBounds.prefix}-${String(onlineBounds.min).padStart(3, '0')} to ${onlineBounds.prefix}-${String(onlineBounds.max).padStart(3, '0')}) and cannot be managed as a hardcopy ticket.`,
      };
    }

    if (parsed.num < bounds.min || parsed.num > bounds.max) {
      return {
        valid: false,
        error: 'OUT_OF_HARDCOPY_RANGE',
        message: `Hardcopy ${parsed.category} tickets must be within ${bounds.prefix}-${String(bounds.min).padStart(3, '0')} to ${bounds.prefix}-${String(bounds.max).padStart(3, '0')}.`,
      };
    }

    return {
      valid: true,
      category: parsed.category,
      ticketNumbers: [parsed.formatted],
      isRange: false,
    };
  }

  // Mode C: Range activation/update
  if (params.startNumber === undefined || params.endNumber === undefined) {
    return {
      valid: false,
      error: 'VALIDATION_ERROR',
      message: 'Provide ticketNumber (single), ticketNumbers (batch), or startNumber and endNumber (range).',
    };
  }

  const normalizedCatParam = params.category ? String(params.category).trim().toUpperCase() : '';
  let resolvedCategory: 'VIP' | 'ORDINARY' | undefined =
    normalizedCatParam === 'VIP' || normalizedCatParam === 'ORDINARY'
      ? normalizedCatParam
      : undefined;

  const parseEndpoint = (val: string | number): { num?: number; category?: 'VIP' | 'ORDINARY' } => {
    if (typeof val === 'number' && Number.isInteger(val)) {
      return { num: val };
    }
    const str = String(val).trim().toUpperCase();
    if (/^\d{1,4}$/.test(str)) {
      return { num: parseInt(str, 10) };
    }
    const code = parseSingleTicketCode(str);
    if (!code.valid) return {};
    return { num: code.num, category: code.category };
  };

  const startParsed = parseEndpoint(params.startNumber);
  const endParsed = parseEndpoint(params.endNumber);

  if (startParsed.num === undefined || endParsed.num === undefined) {
    return {
      valid: false,
      error: 'VALIDATION_ERROR',
      message: 'Invalid startNumber or endNumber format.',
    };
  }

  if (startParsed.category && endParsed.category && startParsed.category !== endParsed.category) {
    return {
      valid: false,
      error: 'CATEGORY_MISMATCH',
      message: 'Start and end ticket numbers must belong to the same pass category (VIP or ORDINARY).',
    };
  }

  const inferredCat = startParsed.category || endParsed.category;
  if (resolvedCategory && inferredCat && resolvedCategory !== inferredCat) {
    return {
      valid: false,
      error: 'CATEGORY_MISMATCH',
      message: `Ticket range prefix (${inferredCat}) does not match category (${resolvedCategory}).`,
    };
  }

  resolvedCategory = resolvedCategory || inferredCat;
  if (!resolvedCategory) {
    return {
      valid: false,
      error: 'VALIDATION_ERROR',
      message: 'category (VIP or ORDINARY) is required when specifying numeric startNumber/endNumber.',
    };
  }

  if (startParsed.num > endParsed.num) {
    return {
      valid: false,
      error: 'VALIDATION_ERROR',
      message: 'startNumber must be less than or equal to endNumber.',
    };
  }

  const bounds = HARDCOPY_RANGES[resolvedCategory];
  const onlineBounds = ONLINE_RANGES[resolvedCategory];

  if (
    (startParsed.num >= onlineBounds.min && startParsed.num <= onlineBounds.max) ||
    (endParsed.num >= onlineBounds.min && endParsed.num <= onlineBounds.max)
  ) {
    return {
      valid: false,
      error: 'ONLINE_TICKET_FORBIDDEN',
      message: `${bounds.prefix}-${String(onlineBounds.min).padStart(3, '0')} to ${bounds.prefix}-${String(onlineBounds.max).padStart(3, '0')} belong to the online ticket pool and cannot be activated as hardcopy tickets.`,
    };
  }

  if (startParsed.num < bounds.min || endParsed.num > bounds.max) {
    return {
      valid: false,
      error: 'OUT_OF_HARDCOPY_RANGE',
      message: `Hardcopy ${resolvedCategory} range must stay within ${bounds.prefix}-${String(bounds.min).padStart(3, '0')} to ${bounds.prefix}-${String(bounds.max).padStart(3, '0')}.`,
    };
  }

  const ticketNumbers: string[] = [];
  for (let n = startParsed.num; n <= endParsed.num; n++) {
    ticketNumbers.push(`${bounds.prefix}-${String(n).padStart(3, '0')}`);
  }

  return {
    valid: true,
    category: resolvedCategory,
    ticketNumbers,
    isRange: ticketNumbers.length > 1,
  };
}

function isMissingColumnError(err: any, columnName?: string): boolean {
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  const isMissingCol =
    code === 'PGRST204' ||
    code === '42703' ||
    (msg.includes('column') && (msg.includes('does not exist') || msg.includes('schema cache')));
  if (!isMissingCol) return false;
  if (!columnName) return true;
  return msg.includes(columnName.toLowerCase());
}

// Serializes in-process check-in & hardcopy activation mutations for deterministic concurrency safety
const _inFlightTicketCheckIns = new Set<string>();
let _hardcopyMutationChain: Promise<any> = Promise.resolve();

function runSerializedHardcopyMutation<T>(fn: () => Promise<T>): Promise<T> {
  const next = _hardcopyMutationChain.then(fn, fn);
  _hardcopyMutationChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function isMissingRpcError(err: any): boolean {
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    msg.includes('could not find the function') ||
    (msg.includes('function') && msg.includes('does not exist'))
  );
}

function isMissingRelationError(err: any, relationName?: string): boolean {
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  const isRelationMissing =
    code === 'PGRST205' ||
    code === '42P01' ||
    msg.includes('could not find the table') ||
    (msg.includes('relation') && msg.includes('does not exist'));

  if (!isRelationMissing) return false;
  if (!relationName) return true;
  return msg.includes(relationName.toLowerCase());
}

function classifySchemaError(err: any, fallbackMessage: string): { message: string; error: string } {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  const lower = msg.toLowerCase();

  if (code === 'PGRST204' || code === '42703' || (lower.includes('column') && (lower.includes('schema cache') || lower.includes('does not exist')))) {
    return {
      message:
        "Database schema update or cache reload required on public.tickets (missing order_ref, reserved_until, or relworx_internal_ref, or PostgREST schema cache not refreshed).",
      error: 'SCHEMA_MISMATCH',
    };
  }

  if (isMissingRelationError(err)) {
    return {
      message:
        "Database schema setup is incomplete or schema cache has not refreshed yet. Run NOTIFY pgrst, 'reload schema'; in Supabase SQL Editor and retry.",
      error: 'SCHEMA_MISMATCH',
    };
  }

  return {
    message: fallbackMessage,
    error: 'DATABASE_ERROR',
  };
}

export const SupabaseServerService = {
  /**
   * Health Check: Read-only connection & schema readiness check against live Supabase project
   */
  async checkConnection(): Promise<{
    connected: boolean;
    count: number;
    ticketsSchemaReady?: boolean;
    ordersTableReady?: boolean;
    ticketChannelReady?: boolean;
    hardcopyAuditTableReady?: boolean;
    schemaWarning?: string;
    error?: string;
  }> {
    const { client, configError } = getSupabaseClient();
    if (!client) {
      return {
        connected: false,
        count: 0,
        error: configError || 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured.',
      };
    }

    try {
      const { count, error } = await client
        .from('tickets')
        .select('*', { count: 'exact', head: true });

      if (error) {
        return { connected: false, count: 0, error: 'Database query failed while checking tickets table.' };
      }

      const { error: ticketColsErr } = await client
        .from('tickets')
        .select('id, order_ref, reserved_until, relworx_internal_ref')
        .limit(1);

      const { error: channelColErr } = await client
        .from('tickets')
        .select('id, ticket_channel')
        .limit(1);

      const { error: ordersErr } = await client
        .from('orders')
        .select('id, order_ref, status')
        .limit(1);

      const { error: auditErr } = await client
        .from('hardcopy_audit_logs')
        .select('id')
        .limit(1);

      const ticketsSchemaReady = !ticketColsErr;
      const ordersTableReady = !ordersErr;
      const ticketChannelReady = !channelColErr;
      const hardcopyAuditTableReady = !auditErr;
      const warnings: string[] = [];

      if (!ticketsSchemaReady) {
        warnings.push("public.tickets is missing reservation columns (order_ref, reserved_until, relworx_internal_ref) or PostgREST schema cache needs reload.");
      }
      if (!ordersTableReady) {
        warnings.push('public.orders table is not created yet (falling back to public.tickets reservation tracking).');
      }
      if (!ticketChannelReady || !hardcopyAuditTableReady) {
        warnings.push('Stage 1 hardcopy migration (ticket_channel / hardcopy_audit_logs) has not been applied yet.');
      }

      return {
        connected: true,
        count: count ?? 0,
        ticketsSchemaReady,
        ordersTableReady,
        ticketChannelReady,
        hardcopyAuditTableReady,
        schemaWarning: warnings.length > 0 ? warnings.join(' ') : undefined,
      };
    } catch {
      return { connected: false, count: 0, error: 'Connection to Supabase failed.' };
    }
  },

  /**
   * Safe Atomic Cleanup: Release 10-Minute Expired Unpaid Reservations
   * Ensures capacity returns to 'available' automatically if customer doesn't pay
   */
  async releaseExpiredReservations(): Promise<number> {
    const { client } = getSupabaseClient();
    if (!client) {
      return 0;
    }

    // Try PostgreSQL stored procedure first
    try {
      const { data: rpcCount, error: rpcErr } = await client.rpc('release_expired_ticket_reservations');
      if (!rpcErr && typeof rpcCount === 'number') {
        return rpcCount;
      }
    } catch {
      // Proceed to direct table update fallback
    }

    const nowIso = new Date().toISOString();

    try {
      let { data: expiredTickets, error: tErr } = await client
        .from('tickets')
        .update({
          status: 'available',
          payment_status: 'unpaid',
          buyer_name: null,
          buyer_email: null,
          buyer_phone: null,
          order_ref: null,
          reserved_until: null,
          relworx_internal_ref: null,
        })
        .eq('ticket_channel', 'online')
        .eq('status', 'reserved')
        .in('payment_status', ['unpaid', 'pending'])
        .lt('reserved_until', nowIso)
        .select('id');

      // Pre-migration fallback if ticket_channel or relworx_internal_ref column is not yet present
      if (tErr && isMissingColumnError(tErr)) {
        const retry = await client
          .from('tickets')
          .update({
            status: 'available',
            payment_status: 'unpaid',
            buyer_name: null,
            buyer_email: null,
            buyer_phone: null,
            order_ref: null,
            reserved_until: null,
          })
          .eq('status', 'reserved')
          .in('payment_status', ['unpaid', 'pending'])
          .lt('reserved_until', nowIso)
          .select('id');
        expiredTickets = retry.data;
        tErr = retry.error;
      }

      if (!tErr && expiredTickets && expiredTickets.length > 0) {
        await client
          .from('orders')
          .update({ status: 'expired' })
          .eq('status', 'pending')
          .lt('reserved_until', nowIso);

        return expiredTickets.length;
      }
    } catch (err: any) {
      console.warn('Error releasing expired reservations in Supabase:', sanitizeDiagnosticText(err?.message || ''));
    }

    return 0;
  },

  /**
   * Public Inventory Counts ONLY: Read ONLINE VIP and Ordinary availability from Supabase.
   * Excludes all hardcopy tickets (ORD-051..ORD-250 and VIP-021..VIP-120).
   * Never exposes buyer details, personal phone numbers, or QR tokens.
   */
  async getPublicCounts(): Promise<{ success: boolean; counts?: PublicInventoryCounts; error?: string }> {
    const { client, configError } = getSupabaseClient();
    if (!client) {
      return {
        success: false,
        error: configError || 'Ticketing database is currently offline.',
      };
    }

    await this.releaseExpiredReservations();

    try {
      let data: Array<{ ticket_number?: string; category: string; status: string; ticket_channel?: string | null }> | null = null;
      let error: any = null;

      const primary = await client
        .from('tickets')
        .select('ticket_number, category, status, ticket_channel')
        .eq('ticket_channel', 'online');

      data = primary.data as any;
      error = primary.error;

      // Graceful pre-migration fallback if ticket_channel column has not been added yet
      if (error && isMissingColumnError(error, 'ticket_channel')) {
        const fallback = await client
          .from('tickets')
          .select('ticket_number, category, status');
        data = fallback.data as any;
        error = fallback.error;
      }

      if (error) {
        console.error('[Supabase getPublicCounts Error]', error.code, sanitizeDiagnosticText(error.message));
        return { success: false, error: 'Unable to load live ticket inventory at this time.' };
      }

      if (!data || data.length === 0) {
        return {
          success: false,
          error: 'Ticket inventory has not been initialized or is inaccessible. Verify database setup and service role key.',
        };
      }

      // Defense-in-depth: strictly exclude any hardcopy row by both ticket_channel and ticket_number range
      const onlineOnly = data.filter((t) => isOnlineTicketRow(t));

      const vipTotal = onlineOnly.filter((t) => t.category === 'VIP').length;
      const vipAvail = onlineOnly.filter((t) => t.category === 'VIP' && t.status === 'available').length;

      const ordTotal = onlineOnly.filter((t) => t.category === 'ORDINARY').length;
      const ordAvail = onlineOnly.filter((t) => t.category === 'ORDINARY' && t.status === 'available').length;

      return {
        success: true,
        counts: {
          VIP: { total: vipTotal, available: vipAvail, priceUgx: 50000 },
          ORDINARY: { total: ordTotal, available: ordAvail, priceUgx: 20000 },
          totalAvailable: vipAvail + ordAvail,
          isLiveSupabase: true,
        },
      };
    } catch (err: any) {
      console.error('[Supabase getPublicCounts Exception]', sanitizeDiagnosticText(err?.message || ''));
      return { success: false, error: 'Unable to reach the ticketing database.' };
    }
  },

  /**
   * MTN Mobile Money Merchant Reservation:
   * 1. Validates inputs & calculates trusted server price (UGX 20,000 Ordinary, UGX 50,000 VIP)
   * 2. Atomically reserves tickets in Supabase with a 15-minute hold
   * 3. Creates a pending order record with verification_status = 'unsubmitted'
   * 4. Returns official MTN Merchant payment instructions and unique order reference
   */
  async initiateMtnMerchantReservation(params: {
    category: 'VIP' | 'ORDINARY';
    quantity: number;
    buyerName: string;
    buyerEmail: string;
    buyerPhone: string;
  }): Promise<{
    success: boolean;
    orderRef?: string;
    reservedUntil?: string;
    totalAmountUgx?: number;
    category?: 'VIP' | 'ORDINARY';
    quantity?: number;
    merchantCode?: string;
    merchantName?: string;
    isConfigured?: boolean;
    message: string;
    error?: string;
  }> {
    const { category, quantity, buyerName, buyerEmail, buyerPhone } = params;

    if (!quantity || quantity < 1 || quantity > 10) {
      return {
        success: false,
        message: 'Invalid ticket quantity (minimum 1, maximum 10).',
        error: 'VALIDATION_ERROR',
      };
    }

    if (category !== 'VIP' && category !== 'ORDINARY') {
      return {
        success: false,
        message: 'Invalid ticket category. Must be VIP or ORDINARY.',
        error: 'VALIDATION_ERROR',
      };
    }

    if (!buyerName || buyerName.trim().length < 2) {
      return {
        success: false,
        message: 'Please provide your full legal name for the ticket.',
        error: 'VALIDATION_ERROR',
      };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!buyerEmail || !emailRegex.test(buyerEmail.trim())) {
      return {
        success: false,
        message: 'Please provide a valid email address.',
        error: 'VALIDATION_ERROR',
      };
    }

    const phoneCheck = MtnMoMoService.formatUgandaPhone(buyerPhone);
    if (!phoneCheck.valid) {
      return {
        success: false,
        message: 'Please enter a valid Uganda MTN Mobile Money phone number (e.g. 0775 198 484 or +256 775 198484).',
        error: 'VALIDATION_ERROR',
      };
    }

    const { client, configError } = getSupabaseClient();
    if (!client) {
      return {
        success: false,
        message: configError || 'Database offline. Cannot reserve tickets at this time.',
        error: 'DATABASE_OFFLINE',
      };
    }

    const unitPrice = category === 'VIP' ? 50000 : 20000;
    const totalAmount = unitPrice * quantity;

    // Release any stale expired reservations first
    await this.releaseExpiredReservations();

    // Generate unique order reference (e.g. PP-MTN-1729900000-1234)
    const timestamp = Date.now();
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const orderRef = `PP-MTN-${timestamp}-${randomSuffix}`;
    const reservedUntil = new Date(timestamp + 15 * 60 * 1000).toISOString(); // 15-minute hold

    try {
      // Find and atomically lock available ONLINE tickets only (never hardcopy passes)
      let candidateRows: Array<{ id: string; ticket_number: string; ticket_channel?: string | null }> | null = null;
      let fetchErr: any = null;

      const primaryFetch = await client
        .from('tickets')
        .select('id, ticket_number, ticket_channel')
        .eq('ticket_channel', 'online')
        .eq('category', category)
        .eq('status', 'available')
        .order('ticket_number', { ascending: true })
        .limit(quantity);

      candidateRows = primaryFetch.data as any;
      fetchErr = primaryFetch.error;

      if (fetchErr && isMissingColumnError(fetchErr, 'ticket_channel')) {
        const fallbackFetch = await client
          .from('tickets')
          .select('id, ticket_number')
          .eq('category', category)
          .eq('status', 'available')
          .order('ticket_number', { ascending: true });
        candidateRows = fallbackFetch.data as any;
        fetchErr = fallbackFetch.error;
      }

      const available = (candidateRows || []).filter((t) => isOnlineTicketRow(t)).slice(0, quantity);

      if (fetchErr || available.length < quantity) {
        const count = available.length;
        return {
          success: false,
          message: `Sold out or insufficient inventory. Only ${count} ${category} ticket(s) currently available.`,
          error: 'INSUFFICIENT_INVENTORY',
        };
      }

      const allocatedIds = available.map((t) => t.id);

      // Lock tickets
      const { error: lockErr } = await client
        .from('tickets')
        .update({
          status: 'reserved',
          payment_status: 'pending',
          buyer_name: buyerName.trim(),
          buyer_email: buyerEmail.trim(),
          buyer_phone: buyerPhone.trim(),
          order_ref: orderRef,
          reserved_until: reservedUntil,
        })
        .in('id', allocatedIds)
        .eq('status', 'available');

      if (lockErr) {
        console.error('[MTN Reservation Lock Error]', lockErr);
        return {
          success: false,
          message: 'Could not lock ticket reservation in database.',
          error: 'DATABASE_ERROR',
        };
      }

      // Record pending order
      const { error: orderErr } = await client.from('orders').insert({
        order_ref: orderRef,
        category,
        quantity,
        unit_price_ugx: unitPrice,
        total_amount_ugx: totalAmount,
        status: 'pending',
        verification_status: 'unsubmitted',
        payment_method: 'mtn_momo_merchant',
        gateway: 'mtn_momo',
        network: 'MTN',
        buyer_name: buyerName.trim(),
        buyer_email: buyerEmail.trim(),
        buyer_phone: buyerPhone.trim(),
        reserved_until: reservedUntil,
      });

      if (orderErr) {
        if (!isMissingRelationError(orderErr, 'orders')) {
          console.warn('[Supabase orders insert warning]', orderErr.message);
        }
      }

      const merchantCode = MtnMoMoService.getMerchantCode();
      const merchantName = MtnMoMoService.getMerchantName();
      const isConfigured = MtnMoMoService.isConfigured();

      return {
        success: true,
        orderRef,
        reservedUntil,
        totalAmountUgx: totalAmount,
        category,
        quantity,
        merchantCode,
        merchantName,
        isConfigured,
        message: 'Pass reserved for 15 minutes. Pay to the MTN Merchant Code and submit your transaction ID.',
      };
    } catch (err: any) {
      console.error('[MTN Reservation Exception]', err?.message || err);
      return {
        success: false,
        message: 'Server error while creating ticket reservation.',
        error: 'SERVER_ERROR',
      };
    }
  },

  /**
   * Submit MTN Transaction ID for Admin Verification:
   * 1. Validates transaction ID format and checks for duplicate reuse
   * 2. Prevents duplicate transaction IDs across all orders and tickets
   * 3. Sets verification_status = 'pending_verification'
   * 4. NEVER marks as paid or issues QR codes on submission!
   */
  async submitMtnTransaction(params: {
    orderRef: string;
    mtnTransactionId: string;
    payerPhone: string;
    notes?: string;
  }): Promise<{
    success: boolean;
    message: string;
    orderRef?: string;
    verificationStatus?: VerificationStatus;
    mtnTransactionId?: string;
    error?: string;
  }> {
    const { orderRef, mtnTransactionId, payerPhone, notes } = params;

    if (!orderRef || typeof orderRef !== 'string') {
      return { success: false, message: 'Order reference is required.', error: 'INVALID_ORDER_REF' };
    }

    const txCheck = MtnMoMoService.sanitizeTransactionId(mtnTransactionId);
    if (!txCheck.valid) {
      return { success: false, message: txCheck.error || 'Invalid MTN Transaction ID.', error: 'INVALID_TRANSACTION_ID' };
    }
    const cleanTxId = txCheck.cleaned;

    const phoneCheck = MtnMoMoService.formatUgandaPhone(payerPhone);
    const cleanPhone = phoneCheck.valid ? phoneCheck.msisdn : payerPhone.trim();

    const { client, configError } = getSupabaseClient();
    if (!client) {
      return { success: false, message: configError || 'Database offline.', error: 'DATABASE_OFFLINE' };
    }

    // Try stored procedure first if available
    try {
      const { data: rpcRes, error: rpcErr } = await client.rpc('submit_mtn_payment', {
        p_order_ref: orderRef,
        p_mtn_transaction_id: cleanTxId,
        p_payer_phone: cleanPhone,
        p_notes: notes || null,
      });

      if (!rpcErr && rpcRes) {
        return rpcRes;
      }
    } catch {
      // Fallback to table queries
    }

    // Memory-level duplicate prevention (works even if migration is not yet run in remote Supabase)
    const memSub = _mtnSubmissionsByTxId.get(cleanTxId);
    if (memSub && memSub.orderRef !== orderRef && memSub.verificationStatus !== 'rejected') {
      return {
        success: false,
        error: 'DUPLICATE_TRANSACTION_ID',
        message: 'This MTN Transaction ID has already been submitted for another order. Each payment transaction ID can only be registered once.',
      };
    }

    try {
      // 1. DUPLICATE CHECK: Verify that this mtn_transaction_id has NOT been used by any other order
      const { data: existingTxOrders } = await client
        .from('orders')
        .select('order_ref, status')
        .ilike('mtn_transaction_id', cleanTxId)
        .neq('order_ref', orderRef)
        .limit(1);

      if (existingTxOrders && existingTxOrders.length > 0) {
        return {
          success: false,
          error: 'DUPLICATE_TRANSACTION_ID',
          message: 'This MTN Transaction ID has already been submitted for another order. Each payment transaction ID can only be registered once.',
        };
      }

      // Check tickets table as well
      const { data: existingTxTickets } = await client
        .from('tickets')
        .select('order_ref')
        .ilike('mtn_transaction_id', cleanTxId)
        .neq('order_ref', orderRef)
        .limit(1);

      if (existingTxTickets && existingTxTickets.length > 0) {
        return {
          success: false,
          error: 'DUPLICATE_TRANSACTION_ID',
          message: 'This MTN Transaction ID is already associated with another ticket issuance.',
        };
      }

      // 2. Fetch target order
      const { data: order, error: orderErr } = await client
        .from('orders')
        .select('*')
        .eq('order_ref', orderRef)
        .maybeSingle();

      if (orderErr && !isMissingRelationError(orderErr, 'orders')) {
        console.warn('[Submit MTN Order Fetch Error]', orderErr);
      }

      if (order && order.status === 'paid') {
        return {
          success: true,
          orderRef,
          message: 'Order is already verified and paid. Your tickets are issued.',
          verificationStatus: 'verified',
        };
      }

      // 3. Update order with pending verification state
      let updatedOrders = false;
      if (order) {
        const updatePayload: Record<string, any> = {
          mtn_transaction_id: cleanTxId,
          payer_phone: cleanPhone,
          verification_status: 'pending_verification',
        };
        if (notes) updatePayload.submission_notes = notes;

        const { error: updErr } = await client
          .from('orders')
          .update(updatePayload)
          .eq('order_ref', orderRef);

        if (!updErr) updatedOrders = true;
      }

      // 4. Update tickets with mtn_transaction_id (remains reserved, NOT paid!)
      await client
        .from('tickets')
        .update({
          mtn_transaction_id: cleanTxId,
        })
        .eq('order_ref', orderRef);

      // Record in memory tracker for instant deduplication and dashboard visibility
      const subRecord: MtnSubmissionRecord = {
        orderRef,
        mtnTransactionId: cleanTxId,
        payerPhone: cleanPhone,
        verificationStatus: 'pending_verification',
        submittedAt: new Date().toISOString(),
        notes,
      };
      _mtnSubmissionsByTxId.set(cleanTxId, subRecord);
      _mtnSubmissionsByOrderRef.set(orderRef, subRecord);

      return {
        success: true,
        orderRef,
        verificationStatus: 'pending_verification',
        mtnTransactionId: cleanTxId,
        message: 'MTN payment submitted successfully! Our event admin will verify against the MTN Merchant portal before tickets are issued.',
      };
    } catch (err: any) {
      console.error('[Submit MTN Transaction Exception]', err?.message || err);
      return {
        success: false,
        message: 'Unexpected error while submitting transaction ID. Please try again.',
        error: 'SUBMISSION_ERROR',
      };
    }
  },

  /**
   * Admin Verification of MTN Merchant Payment:
   * Only called after admin verifies transaction ID against real MTN merchant SMS/portal.
   * Atomically marks order as 'paid', issues tickets, and activates QR codes.
   */
  async verifyMtnPaymentAdmin(params: {
    orderRef: string;
    adminName?: string;
    notes?: string;
  }): Promise<{ success: boolean; message: string; orderRef?: string; tickets?: TicketRow[]; error?: string }> {
    const { orderRef, adminName = 'Admin' } = params;

    const { client, configError } = getSupabaseClient();
    if (!client) {
      return { success: false, message: configError || 'Database offline.', error: 'DATABASE_OFFLINE' };
    }

    // Try RPC first
    try {
      const { data: rpcRes, error: rpcErr } = await client.rpc('verify_mtn_payment_admin', {
        p_order_ref: orderRef,
        p_admin_name: adminName,
      });

      if (!rpcErr && rpcRes && rpcRes.success) {
        return rpcRes;
      }
    } catch {
      // Proceed to direct update
    }

    const now = new Date().toISOString();

    try {
      // Get order
      const { data: order } = await client
        .from('orders')
        .select('*')
        .eq('order_ref', orderRef)
        .maybeSingle();

      // Prevent duplicate ticket issuance if order is already verified and paid
      if (order && order.status === 'paid') {
        const { data: alreadyIssued } = await client
          .from('tickets')
          .select('*')
          .eq('order_ref', orderRef)
          .eq('status', 'issued');

        return {
          success: true,
          orderRef,
          tickets: (alreadyIssued as TicketRow[]) || [],
          message: `Order ${orderRef} is already verified and paid. Official QR tickets are active.`,
        };
      }

      const txId = order?.mtn_transaction_id || null;

      // Update order to paid
      await client
        .from('orders')
        .update({
          status: 'paid',
          verification_status: 'verified',
          paid_at: now,
          verified_at: now,
          verified_by: adminName,
        })
        .eq('order_ref', orderRef);

      // Update memory record
      const memSub = _mtnSubmissionsByOrderRef.get(orderRef);
      if (memSub) {
        memSub.verificationStatus = 'verified';
        memSub.verifiedAt = now;
        memSub.verifiedBy = adminName;
      }

      // Issue tickets atomically
      const ticketUpdate: Record<string, any> = {
        status: 'issued',
        payment_status: 'paid',
        paid_at: now,
      };
      if (txId) ticketUpdate.mtn_transaction_id = txId;

      let { error: ticketErr } = await client
        .from('tickets')
        .update(ticketUpdate)
        .eq('order_ref', orderRef);

      if (ticketErr && (ticketErr.code === 'PGRST204' || ticketErr.code === '42703')) {
        const fallback = await client
          .from('tickets')
          .update({
            status: 'issued',
            payment_status: 'paid',
            paid_at: now,
          })
          .eq('order_ref', orderRef);
        ticketErr = fallback.error;
      }

      if (ticketErr) {
        console.error('[Verify MTN Ticket Update Error]', ticketErr);
        return { success: false, message: 'Failed to update ticket records to issued in database.' };
      }

      // Fetch the activated tickets with their unique ticket_number and qr_token
      const { data: issuedTickets } = await client
        .from('tickets')
        .select('*')
        .eq('order_ref', orderRef)
        .eq('status', 'issued');

      return {
        success: true,
        orderRef,
        tickets: (issuedTickets as TicketRow[]) || [],
        message: `MTN payment verified for Order ${orderRef}. Official QR tickets have been activated and issued.`,
      };
    } catch (err: any) {
      console.error('[Verify MTN Admin Exception]', err?.message || err);
      return { success: false, message: 'Server error while verifying MTN payment.' };
    }
  },

  /**
   * Admin Rejection of MTN Merchant Payment:
   * Called if transaction ID is invalid, fake, unconfirmed, or underpaid.
   * Marks order as 'failed' and releases reserved tickets back to available capacity immediately.
   */
  async rejectMtnPaymentAdmin(params: {
    orderRef: string;
    reason: string;
    adminName?: string;
  }): Promise<{ success: boolean; message: string }> {
    const { orderRef, reason, adminName = 'Admin' } = params;

    const { client } = getSupabaseClient();
    if (!client) {
      return { success: false, message: 'Database offline.' };
    }

    try {
      // 0. Update memory tracking record
      const memSub = _mtnSubmissionsByOrderRef.get(orderRef);
      if (memSub) {
        memSub.verificationStatus = 'rejected';
        memSub.rejectionReason = reason.trim() || 'Payment not matched in MTN merchant account.';
      }

      // 1. Update order status to failed / rejected
      await client
        .from('orders')
        .update({
          status: 'failed',
          verification_status: 'rejected',
          rejection_reason: reason.trim() || 'Payment not matched in MTN merchant account.',
          verified_by: adminName,
        })
        .eq('order_ref', orderRef);

      // 2. Release reserved tickets back to inventory
      let { error: releaseErr } = await client
        .from('tickets')
        .update({
          status: 'available',
          payment_status: 'unpaid',
          buyer_name: null,
          buyer_email: null,
          buyer_phone: null,
          order_ref: null,
          reserved_until: null,
          mtn_transaction_id: null,
        })
        .eq('order_ref', orderRef)
        .eq('status', 'reserved');

      if (releaseErr && (releaseErr.code === 'PGRST204' || releaseErr.code === '42703')) {
        await client
          .from('tickets')
          .update({
            status: 'available',
            payment_status: 'unpaid',
            buyer_name: null,
            buyer_email: null,
            buyer_phone: null,
            order_ref: null,
            reserved_until: null,
          })
          .eq('order_ref', orderRef)
          .eq('status', 'reserved');
      }

      return {
        success: true,
        message: `Order ${orderRef} rejected (${reason}). Reserved tickets released back to available inventory.`,
      };
    } catch (err: any) {
      console.error('[Reject MTN Admin Exception]', err?.message || err);
      return { success: false, message: 'Error rejecting order.' };
    }
  },

  /**
   * Uganda Mobile Money Checkout Initiation (MTN MoMo & Airtel Money)
   * 1. Validates inputs & calculates trusted server price (UGX 20,000 Ordinary, UGX 50,000 VIP)
   * 2. Atomically reserves tickets in Supabase with a 10-minute expiry
   * 3. Triggers Relworx Mobile Money Request-Payment push to customer handset
   */
  async initiateRelworxPayment(params: {
    category: 'VIP' | 'ORDINARY';
    quantity: number;
    buyerName: string;
    buyerEmail: string;
    buyerPhone: string;
    network: PaymentNetwork;
    idempotencyKey?: string;
  }): Promise<InitiationResult> {
    const { category, quantity, buyerName, buyerEmail, buyerPhone, network, idempotencyKey } = params;

    if (!quantity || quantity < 1 || quantity > 10) {
      return {
        success: false,
        message: 'Invalid ticket quantity (minimum 1, maximum 10).',
        error: 'VALIDATION_ERROR',
        retryable: false,
      };
    }

    if (category !== 'VIP' && category !== 'ORDINARY') {
      return {
        success: false,
        message: 'Invalid ticket category. Must be VIP or ORDINARY.',
        error: 'VALIDATION_ERROR',
        retryable: false,
      };
    }

    if (network !== 'MTN' && network !== 'AIRTEL') {
      return {
        success: false,
        message: 'Invalid mobile money network. Must be MTN or AIRTEL.',
        error: 'VALIDATION_ERROR',
        retryable: false,
      };
    }

    if (!buyerName || buyerName.trim().length < 2) {
      return {
        success: false,
        message: 'Please provide the attendee full name.',
        error: 'VALIDATION_ERROR',
        retryable: false,
      };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!buyerEmail || !emailRegex.test(buyerEmail.trim())) {
      return {
        success: false,
        message: 'Please provide a valid email address.',
        error: 'VALIDATION_ERROR',
        retryable: false,
      };
    }

    const phoneCheck = RelworxService.formatUgandaMsisdn(buyerPhone);
    if (!phoneCheck.valid) {
      return {
        success: false,
        message: 'Please enter a valid Uganda Mobile Money phone number (e.g. 0775 198 484).',
        error: 'VALIDATION_ERROR',
        retryable: false,
      };
    }

    // 1. Check database and payment gateway configuration BEFORE locking inventory
    const { client, configError } = getSupabaseClient();
    if (!client) {
      return {
        success: false,
        message: configError || 'Ticketing database is currently unavailable. Please try again later.',
        error: 'SUPABASE_NOT_CONFIGURED',
        retryable: true,
      };
    }

    if (!RelworxService.isConfigured()) {
      return {
        success: false,
        message: CUSTOMER_PAYMENTS_UNAVAILABLE_MESSAGE,
        error: 'RELWORX_NOT_CONFIGURED',
        code: 'PROVIDER_NOT_CONFIGURED',
        retryable: true,
      };
    }

    // 2. Do NOT lock tickets or repeatedly call Relworx while API_DISABLED cooldown is active
    const disabledCooldown = RelworxService.getDisabledCooldownRemainingSeconds();
    if (disabledCooldown > 0) {
      return {
        success: false,
        message: CUSTOMER_PAYMENTS_UNAVAILABLE_MESSAGE,
        error: 'PAYMENT_PROVIDER_UNAVAILABLE',
        code: 'API_DISABLED',
        retryable: true,
        retryAfterSeconds: disabledCooldown,
      };
    }

    // 3. Deduplicate rapid/concurrent retries for the same idempotencyKey or buyer+tier+quantity
    const cleanIdempotencyKey =
      typeof idempotencyKey === 'string' && idempotencyKey.trim().length >= 8
        ? idempotencyKey.trim().slice(0, 80)
        : undefined;

    if (cleanIdempotencyKey) {
      const cached = _recentIdempotencyResults.get(cleanIdempotencyKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.result;
      }
      _recentIdempotencyResults.delete(cleanIdempotencyKey);
    }

    const dedupeLockKey = cleanIdempotencyKey || `${phoneCheck.msisdn}|${category}|${quantity}|${network}`;
    const existingInFlight = _inFlightInitiations.get(dedupeLockKey);
    if (existingInFlight) {
      return existingInFlight;
    }

    const executionPromise = this._executeRelworxInitiation({
      client,
      category,
      quantity,
      buyerName: buyerName.trim(),
      buyerEmail: buyerEmail.trim(),
      buyerPhone: buyerPhone.trim(),
      msisdn: phoneCheck.msisdn,
      localPhone: phoneCheck.local,
      network,
    });

    _inFlightInitiations.set(dedupeLockKey, executionPromise);

    try {
      const result = await executionPromise;
      // Cache successful pending order initiation briefly for idempotencyKey network retries
      if (cleanIdempotencyKey && result.success && result.orderRef) {
        _recentIdempotencyResults.set(cleanIdempotencyKey, {
          expiresAt: Date.now() + 9 * 60 * 1000,
          result: { ...result, reusedExistingOrder: true },
        });
      }
      return result;
    } finally {
      _inFlightInitiations.delete(dedupeLockKey);
    }
  },

  /**
   * Internal execution path for Relworx checkout initiation (protected by concurrency/idempotency lock)
   */
  async _executeRelworxInitiation(params: {
    client: SupabaseClient;
    category: 'VIP' | 'ORDINARY';
    quantity: number;
    buyerName: string;
    buyerEmail: string;
    buyerPhone: string;
    msisdn: string;
    localPhone: string;
    network: PaymentNetwork;
  }): Promise<InitiationResult> {
    const { client, category, quantity, buyerName, buyerEmail, buyerPhone, msisdn, localPhone, network } = params;

    // Trusted prices enforced strictly on server — never trust client submission
    const unitPrice = category === 'VIP' ? 50000 : 20000;
    const totalAmount = unitPrice * quantity;

    // Release any stale expired reservations first
    await this.releaseExpiredReservations();

    // Prevent duplicate active orders & duplicate charges if buyer retries while a prompt is already live
    const reusableOrder = await this.findReusableActivePendingOrder(client, {
      buyerPhone,
      msisdn,
      localPhone,
      category,
      quantity,
    });

    if (reusableOrder) {
      return reusableOrder;
    }

    // Generate unique order reference (8-36 alphanumeric/hyphen characters)
    const timestamp = Date.now();
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const orderRef = `PP-RWX-${timestamp}-${randomSuffix}`;
    const reservedUntil = new Date(timestamp + 10 * 60 * 1000).toISOString();

    // 1. Reserve tickets & create pending order atomically (never paid before verification)
    let reservedViaRpc = false;
    try {
      const { data: rpcRes, error: rpcErr } = await client.rpc('reserve_tickets_atomic', {
        p_category: category,
        p_quantity: quantity,
        p_buyer_name: buyerName,
        p_buyer_email: buyerEmail,
        p_buyer_phone: buyerPhone,
        p_order_ref: orderRef,
        p_reserved_until: reservedUntil,
        p_network: network,
        p_unit_price: unitPrice,
        p_total_amount: totalAmount,
      });

      if (!rpcErr && rpcRes) {
        if (!rpcRes.success) {
          return {
            success: false,
            message: rpcRes.message || `Insufficient ${category} tickets available.`,
            error: 'INSUFFICIENT_INVENTORY',
            retryable: false,
          };
        }
        reservedViaRpc = true;
      } else if (rpcErr && !isMissingRpcError(rpcErr)) {
        if (!isMissingRelationError(rpcErr, 'orders')) {
          console.error('[Supabase reserve_tickets_atomic Error]', rpcErr.code, sanitizeDiagnosticText(rpcErr.message));
          const classified = classifySchemaError(
            rpcErr,
            'Could not reserve tickets in the database. Please ensure the latest Supabase schema migration has been applied.'
          );
          return {
            success: false,
            message: classified.message,
            error: classified.error,
            retryable: true,
          };
        }
      }
    } catch (rpcException: any) {
      console.warn('[Supabase RPC Exception, falling back to direct reservation]', sanitizeDiagnosticText(rpcException?.message));
    }

    if (!reservedViaRpc) {
      const directResult = await this.reserveTicketsDirect(
        category,
        quantity,
        buyerName,
        buyerEmail,
        buyerPhone,
        orderRef,
        reservedUntil,
        network,
        unitPrice,
        totalAmount
      );
      if (!directResult.success) {
        return {
          success: false,
          message: directResult.message,
          error: directResult.error || 'DATABASE_ERROR',
          retryable: directResult.error !== 'INSUFFICIENT_INVENTORY',
        };
      }
    }

    // 2. Call Relworx Payments API once (never retries a disabled API)
    const relworxRes = await RelworxService.requestPayment({
      reference: orderRef,
      phone: buyerPhone,
      amount: totalAmount,
      description: `Pool Party 2026 - ${quantity}x ${category} Pass`,
      category,
      buyerName,
    });

    if (!relworxRes.success) {
      // Immediately release ticket reservation and mark order 'failed' so tickets are NEVER left reserved
      await this.releaseReservationByOrderRef(orderRef, 'failed');
      return {
        success: false,
        message: relworxRes.message || CUSTOMER_PAYMENTS_UNAVAILABLE_MESSAGE,
        error: relworxRes.error || 'RELWORX_REQUEST_FAILED',
        code: relworxRes.code,
        retryable: relworxRes.retryable ?? true,
        retryAfterSeconds: relworxRes.retryAfterSeconds,
      };
    }

    const internalRef = relworxRes.internal_reference || null;
    if (internalRef) {
      try {
        await client
          .from('orders')
          .update({ relworx_internal_ref: internalRef })
          .eq('order_ref', orderRef);

        await client
          .from('tickets')
          .update({ relworx_internal_ref: internalRef })
          .eq('order_ref', orderRef);
      } catch {
        console.warn('[Supabase] Could not attach relworx_internal_ref for order', orderRef);
      }
    }

    return {
      success: true,
      orderRef,
      message: relworxRes.message || 'Payment prompt initiated. Check your phone to enter PIN.',
      relworxInternalRef: internalRef,
      reservedUntil,
      totalAmountUgx: totalAmount,
      gateway: 'relworx',
    };
  },

  /**
   * Checks if the same buyer already has a non-expired pending order for the same tier & quantity.
   * Reuses an active live prompt instead of creating duplicate orders or pushing a second charge,
   * and cleans up any uninitiated/failed stale reservation automatically.
   */
  async findReusableActivePendingOrder(
    client: SupabaseClient,
    params: {
      buyerPhone: string;
      msisdn: string;
      localPhone: string;
      category: 'VIP' | 'ORDINARY';
      quantity: number;
    }
  ): Promise<InitiationResult | null> {
    const nowIso = new Date().toISOString();
    try {
      const phoneCandidates = Array.from(new Set([params.buyerPhone, params.msisdn, params.localPhone]));
      const { data: pendingOrders, error } = await client
        .from('orders')
        .select('*')
        .eq('status', 'pending')
        .eq('category', params.category)
        .eq('quantity', params.quantity)
        .in('buyer_phone', phoneCandidates)
        .gt('reserved_until', nowIso)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error || !pendingOrders || pendingOrders.length === 0) {
        return null;
      }

      const existing = pendingOrders[0];

      // If no provider reference was ever recorded, this was an incomplete initiation — release it cleanly
      if (!existing.relworx_internal_ref) {
        await this.releaseReservationByOrderRef(existing.order_ref, 'failed');
        return null;
      }

      // Verify with Relworx whether the earlier prompt is still pending or already failed
      if (RelworxService.getDisabledCooldownRemainingSeconds() === 0) {
        const statusCheck = await RelworxService.checkRequestStatus({
          internalReference: existing.relworx_internal_ref,
          reference: existing.order_ref,
        });

        if (statusCheck.status === 'failed') {
          await this.releaseReservationByOrderRef(existing.order_ref, 'failed');
          return null;
        }

        if (statusCheck.success && statusCheck.status === 'success') {
          await this.markOrderAsPaid(existing.order_ref, {
            relworx: statusCheck,
            relworx_internal_ref: statusCheck.internal_reference,
          });
        }
      }

      return {
        success: true,
        orderRef: existing.order_ref,
        message: 'Resuming your active Mobile Money payment request. Check your phone to approve.',
        relworxInternalRef: existing.relworx_internal_ref,
        reservedUntil: existing.reserved_until,
        totalAmountUgx: existing.total_amount_ugx,
        gateway: 'relworx',
        reusedExistingOrder: true,
      };
    } catch {
      return null;
    }
  },

  /**
   * Direct reservation against Supabase tables with strict rollback on partial/order failure
   */
  async reserveTicketsDirect(
    category: 'VIP' | 'ORDINARY',
    quantity: number,
    buyerName: string,
    buyerEmail: string,
    buyerPhone: string,
    orderRef: string,
    reservedUntil: string,
    network: PaymentNetwork,
    unitPrice: number,
    totalAmount: number
  ): Promise<{ success: boolean; message: string; error?: string }> {
    const { client } = getSupabaseClient();
    if (!client) {
      return {
        success: false,
        message: 'Ticketing database is not connected.',
        error: 'SUPABASE_NOT_CONFIGURED',
      };
    }

    try {
      let candidateRows: Array<{ id: string; ticket_number: string; ticket_channel?: string | null }> | null = null;
      let fetchErr: any = null;

      const primaryFetch = await client
        .from('tickets')
        .select('id, ticket_number, ticket_channel')
        .eq('ticket_channel', 'online')
        .eq('category', category)
        .eq('status', 'available')
        .order('ticket_number', { ascending: true })
        .limit(quantity);

      candidateRows = primaryFetch.data as any;
      fetchErr = primaryFetch.error;

      if (fetchErr && isMissingColumnError(fetchErr, 'ticket_channel')) {
        const fallbackFetch = await client
          .from('tickets')
          .select('id, ticket_number')
          .eq('category', category)
          .eq('status', 'available')
          .order('ticket_number', { ascending: true });
        candidateRows = fallbackFetch.data as any;
        fetchErr = fallbackFetch.error;
      }

      if (fetchErr) {
        console.error('[Supabase reserveTicketsDirect fetchErr]', fetchErr.code, sanitizeDiagnosticText(fetchErr.message));
        return {
          success: false,
          message: 'Unable to read available ticket inventory.',
          error: 'DATABASE_ERROR',
        };
      }

      const available = (candidateRows || []).filter((t) => isOnlineTicketRow(t)).slice(0, quantity);

      if (available.length < quantity) {
        return {
          success: false,
          message: `Insufficient tickets available. Only ${available.length} ${category} pass(es) currently remaining.`,
          error: 'INSUFFICIENT_INVENTORY',
        };
      }

      const allocatedTicketIds = available.map((t) => t.id);

      const { data: lockedRows, error: lockErr } = await client
        .from('tickets')
        .update({
          status: 'reserved',
          payment_status: 'pending',
          buyer_name: buyerName.trim(),
          buyer_email: buyerEmail.trim(),
          buyer_phone: buyerPhone.trim(),
          order_ref: orderRef,
          reserved_until: reservedUntil,
        })
        .in('id', allocatedTicketIds)
        .eq('status', 'available')
        .select('id');

      if (lockErr) {
        console.error('[Supabase reserveTicketsDirect lockErr]', lockErr.code, sanitizeDiagnosticText(lockErr.message));
        const classified = classifySchemaError(
          lockErr,
          'Could not lock ticket reservation in database. Ensure order_ref and reserved_until exist on public.tickets.'
        );
        return {
          success: false,
          message: classified.message,
          error: classified.error,
        };
      }

      if (!lockedRows || lockedRows.length < quantity) {
        await this.releaseReservationByOrderRef(orderRef);
        return {
          success: false,
          message: 'Those passes were just claimed by another guest. Please try again.',
          error: 'INSUFFICIENT_INVENTORY',
        };
      }

      const { error: orderErr } = await client.from('orders').insert({
        order_ref: orderRef,
        category,
        quantity,
        unit_price_ugx: unitPrice,
        total_amount_ugx: totalAmount,
        status: 'pending',
        payment_method: 'relworx_mobile_money',
        network,
        buyer_name: buyerName.trim(),
        buyer_email: buyerEmail.trim(),
        buyer_phone: buyerPhone.trim(),
        reserved_until: reservedUntil,
      });

      if (orderErr) {
        if (isMissingRelationError(orderErr, 'orders')) {
          // Safe fallback: public.tickets already holds the 10-minute reservation, order_ref, and buyer details
          console.warn(
            `[Supabase] public.orders table not found (${orderErr.code}); tracking reservation ${orderRef} via public.tickets.`
          );
        } else {
          console.error('[Supabase orders insert error]', orderErr.code, sanitizeDiagnosticText(orderErr.message));
          await this.releaseReservationByOrderRef(orderRef);
          const classified = classifySchemaError(
            orderErr,
            'Could not create order record in database. Ensure the public.orders schema is up to date.'
          );
          return {
            success: false,
            message: classified.message,
            error: classified.error,
          };
        }
      }

      return { success: true, message: 'Tickets reserved.' };
    } catch (err: any) {
      console.error('[Supabase reserveTicketsDirect Exception]', sanitizeDiagnosticText(err?.message || ''));
      await this.releaseReservationByOrderRef(orderRef);
      return {
        success: false,
        message: 'Unexpected database error while reserving tickets.',
        error: 'DATABASE_ERROR',
      };
    }
  },

  resetDeduplicationStateForTests(): void {
    _inFlightInitiations.clear();
    _recentIdempotencyResults.clear();
  },

  /**
   * Release reservation when checkout fails initiation, is cancelled, or is declined.
   * Ensures reserved tickets are immediately returned to 'available' and order is marked 'failed'/'cancelled'.
   */
  async releaseReservationByOrderRef(
    orderRef: string,
    finalOrderStatus: 'cancelled' | 'failed' = 'cancelled'
  ): Promise<boolean> {
    // Purge any cached idempotency entry referencing this released orderRef
    for (const [key, entry] of _recentIdempotencyResults.entries()) {
      if (entry.result.orderRef === orderRef) {
        _recentIdempotencyResults.delete(key);
      }
    }

    const { client } = getSupabaseClient();
    if (!client || !orderRef) return false;

    const fullResetPayload = {
      status: 'available',
      payment_status: 'unpaid',
      buyer_name: null,
      buyer_email: null,
      buyer_phone: null,
      order_ref: null,
      reserved_until: null,
      relworx_internal_ref: null,
    };

    const minimalResetPayload = {
      status: 'available',
      payment_status: 'unpaid',
      buyer_name: null,
      buyer_email: null,
      buyer_phone: null,
      order_ref: null,
      reserved_until: null,
    };

    try {
      let { error: ticketErr } = await client
        .from('tickets')
        .update(fullResetPayload)
        .eq('order_ref', orderRef)
        .eq('status', 'reserved');

      if (ticketErr && (ticketErr.code === 'PGRST204' || ticketErr.code === '42703')) {
        const fallback = await client
          .from('tickets')
          .update(minimalResetPayload)
          .eq('order_ref', orderRef)
          .eq('status', 'reserved');
        ticketErr = fallback.error;
      } else if (ticketErr) {
        // Retry once after brief pause on transient network/PostgREST error so tickets do not stay locked
        await new Promise((resolve) => setTimeout(resolve, 200));
        const retry = await client
          .from('tickets')
          .update(minimalResetPayload)
          .eq('order_ref', orderRef)
          .eq('status', 'reserved');
        ticketErr = retry.error;
      }

      if (ticketErr) {
        console.error('[Supabase] Ticket reservation release error:', {
          orderRef,
          code: ticketErr.code,
          diagnostic: sanitizeDiagnosticText(ticketErr.message),
        });
      }

      const { error: orderUpdateErr } = await client
        .from('orders')
        .update({ status: finalOrderStatus })
        .eq('order_ref', orderRef)
        .eq('status', 'pending');

      if (orderUpdateErr && !isMissingRelationError(orderUpdateErr, 'orders')) {
        console.warn('[Supabase] Order status release warning:', {
          orderRef,
          code: orderUpdateErr.code,
        });
      }

      return !ticketErr;
    } catch (err: any) {
      console.error('[Supabase] Exception releasing reservation:', {
        orderRef,
        diagnostic: sanitizeDiagnosticText(err?.message || ''),
      });
      return false;
    }
  },

  /**
   * Check Order Status & Synchronize with Relworx
   * Only returns tickets (and their secure QR tokens) IF the order status is confirmed 'paid'!
   */
  async getOrderStatus(orderRef: string): Promise<{
    success: boolean;
    orderRef: string;
    status: OrderStatus;
    message?: string;
    tickets?: TicketRow[];
    buyerName?: string;
    category?: 'VIP' | 'ORDINARY';
    quantity?: number;
    totalAmountUgx?: number;
    reservedUntil?: string;
    secondsRemaining?: number;
    verificationStatus?: 'unsubmitted' | 'pending_verification' | 'verified' | 'rejected';
    mtnTransactionId?: string | null;
    rejectionReason?: string | null;
  }> {
    const { client, configError } = getSupabaseClient();
    if (!client) {
      return {
        success: false,
        orderRef,
        status: 'failed',
        message: configError || 'Ticketing database is currently offline.',
      };
    }

    try {
      let order: any = null;
      const { data: orderData, error: orderErr } = await client
        .from('orders')
        .select('*')
        .eq('order_ref', orderRef)
        .maybeSingle();

      if (!orderErr && orderData) {
        order = orderData;
      } else if (!orderData || isMissingRelationError(orderErr, 'orders')) {
        // Fallback: synthesize order state from reserved/issued rows in public.tickets when public.orders is absent
        const { data: orderTickets, error: ticketsFallbackErr } = await client
          .from('tickets')
          .select('*')
          .eq('order_ref', orderRef);

        if (!ticketsFallbackErr && orderTickets && orderTickets.length > 0) {
          const rows = orderTickets as TicketRow[];
          const allPaid = rows.every(
            (t) => t.status === 'issued' && (t.payment_status === 'paid' || t.payment_status === 'manual_paid')
          );
          const first = rows[0];
          order = {
            order_ref: orderRef,
            status: allPaid ? 'paid' : 'pending',
            buyer_name: first.buyer_name || 'Guest',
            category: first.category,
            quantity: rows.length,
            total_amount_ugx: rows.reduce((sum, t) => sum + Number(t.price_ugx || 0), 0),
            reserved_until: first.reserved_until || new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            relworx_internal_ref: first.relworx_internal_ref || null,
            _issuedTickets: allPaid ? rows : undefined,
          };
        }
      }

      if (!order) {
        return {
          success: false,
          orderRef,
          status: 'failed',
          message: 'Order reference not found.',
        };
      }

      if (order.status === 'paid') {
        const tickets =
          order._issuedTickets ||
          (
            await client
              .from('tickets')
              .select('*')
              .eq('order_ref', orderRef)
              .eq('status', 'issued')
          ).data;

        return {
          success: true,
          orderRef,
          status: 'paid',
          verificationStatus: order.verification_status || 'verified',
          mtnTransactionId: order.mtn_transaction_id || null,
          buyerName: order.buyer_name,
          category: order.category,
          quantity: order.quantity,
          totalAmountUgx: order.total_amount_ugx,
          tickets: (tickets as TicketRow[]) || [],
        };
      }

      if (order.status === 'failed' || order.verification_status === 'rejected') {
        return {
          success: false,
          orderRef,
          status: 'failed',
          verificationStatus: 'rejected',
          rejectionReason: order.rejection_reason || 'Payment was declined or rejected.',
          message: order.rejection_reason || 'Payment was declined or rejected.',
          tickets: [],
        };
      }

      const now = Date.now();
      const expiry = order.reserved_until ? new Date(order.reserved_until).getTime() : now + 600000;
      if (order.status === 'pending' && now > expiry) {
        await this.releaseReservationByOrderRef(orderRef);
        return {
          success: false,
          orderRef,
          status: 'expired',
          verificationStatus: order.verification_status || 'unsubmitted',
          message: 'Your 15-minute reservation window has expired. The tickets have been returned to available inventory.',
          tickets: [],
        };
      }

      if (order.status === 'pending' && RelworxService.isConfigured() && order.gateway === 'relworx') {
        try {
          const relCheck = await RelworxService.checkRequestStatus({
            internalReference: order.relworx_internal_ref || undefined,
            reference: orderRef,
          });

          if (relCheck.success && relCheck.status === 'success') {
            const currencyValid = !relCheck.currency || String(relCheck.currency).toUpperCase() === 'UGX';
            const amountValid =
              relCheck.amount === undefined ||
              relCheck.amount === null ||
              Math.round(Number(relCheck.amount)) === Math.round(Number(order.total_amount_ugx));

            if (currencyValid && amountValid) {
              await this.markOrderAsPaid(orderRef, {
                relworx: relCheck,
                relworx_internal_ref: relCheck.internal_reference,
              });
              return await this.getOrderStatus(orderRef);
            }
          } else if (relCheck.status === 'failed') {
            await this.releaseReservationByOrderRef(orderRef);
            return {
              success: false,
              orderRef,
              status: 'failed',
              verificationStatus: 'rejected',
              message: relCheck.message || 'Payment prompt was cancelled or declined on handset.',
              tickets: [],
            };
          }
        } catch (err) {
          console.warn('Error polling Relworx status:', err);
        }
      }

      const secondsRemaining = Math.max(0, Math.floor((expiry - now) / 1000));
      const memSub = _mtnSubmissionsByOrderRef.get(orderRef);

      return {
        success: true,
        orderRef,
        status: order.status,
        verificationStatus: order.verification_status || memSub?.verificationStatus || 'unsubmitted',
        mtnTransactionId: order.mtn_transaction_id || memSub?.mtnTransactionId || null,
        rejectionReason: order.rejection_reason || memSub?.rejectionReason || null,
        buyerName: order.buyer_name,
        category: order.category,
        quantity: order.quantity,
        totalAmountUgx: order.total_amount_ugx,
        reservedUntil: order.reserved_until,
        secondsRemaining,
        tickets: [],
      };
    } catch {
      return {
        success: false,
        orderRef,
        status: 'failed',
        message: 'Unable to check order status right now.',
      };
    }
  },

  /**
   * Idempotently mark order and its reserved tickets as PAID and ISSUED in Supabase
   */
  async markOrderAsPaid(orderRef: string, paymentData?: any): Promise<boolean> {
    const { client } = getSupabaseClient();
    if (!client) return false;

    const flwTxId = paymentData?.id ? String(paymentData.id) : null;
    const internalRef =
      paymentData?.relworx_internal_ref ||
      paymentData?.relworx?.internal_reference ||
      paymentData?.flw_ref ||
      null;

    try {
      const { data: rpcRes, error: rpcErr } = await client.rpc('mark_order_paid_atomic', {
        p_order_ref: orderRef,
        p_relworx_internal_ref: internalRef,
        p_flw_transaction_id: flwTxId,
      });

      if (!rpcErr && rpcRes && rpcRes.success) {
        return true;
      }
    } catch {
      // Fallback to direct table updates
    }

    const now = new Date().toISOString();

    try {
      const { data: existingOrder } = await client
        .from('orders')
        .select('status')
        .eq('order_ref', orderRef)
        .maybeSingle();

      if (existingOrder && existingOrder.status === 'paid') {
        return true;
      }

      const ticketUpdate: Record<string, any> = {
        status: 'issued',
        payment_status: 'paid',
        paid_at: now,
      };
      if (internalRef) ticketUpdate.relworx_internal_ref = internalRef;

      const { error: tErr } = await client
        .from('tickets')
        .update(ticketUpdate)
        .eq('order_ref', orderRef);

      if (tErr) {
        console.error('Failed to mark tickets as paid in Supabase:', tErr.code, tErr.message);
        return false;
      }

      const orderUpdate: Record<string, any> = {
        status: 'paid',
        paid_at: now,
      };
      if (internalRef) orderUpdate.relworx_internal_ref = internalRef;

      const { error: oErr } = await client
        .from('orders')
        .update(orderUpdate)
        .eq('order_ref', orderRef);

      if (oErr) {
        console.error('Failed to mark order as paid in Supabase:', oErr.code, oErr.message);
      }

      return true;
    } catch (err) {
      console.error('Error marking order as paid in Supabase:', err);
      return false;
    }
  },

  /**
   * Fetch trusted server-side order details for payment amount/currency/reference verification.
   */
  async getOrderForPaymentVerification(orderRef: string): Promise<{
    found: boolean;
    order?: {
      order_ref: string;
      status: string;
      total_amount_ugx: number;
      currency: 'UGX';
      relworx_internal_ref: string | null;
      gateway?: string | null;
      payment_method?: string | null;
      verification_status?: string | null;
    };
    error?: string;
  }> {
    const refCheck = normalizeStrictOrderRef(orderRef);
    if (!refCheck.valid) {
      return { found: false, error: 'INVALID_ORDER_REF' };
    }

    const { client } = getSupabaseClient();
    if (!client) {
      return { found: false, error: 'SUPABASE_NOT_CONFIGURED' };
    }

    try {
      const { data: orderRow, error: orderErr } = await client
        .from('orders')
        .select('order_ref, status, total_amount_ugx, relworx_internal_ref, gateway, payment_method, verification_status')
        .eq('order_ref', refCheck.orderRef)
        .maybeSingle();

      if (!orderErr && orderRow) {
        return {
          found: true,
          order: {
            order_ref: orderRow.order_ref,
            status: orderRow.status,
            total_amount_ugx: Math.round(Number(orderRow.total_amount_ugx)),
            currency: 'UGX',
            relworx_internal_ref: orderRow.relworx_internal_ref || null,
            gateway: orderRow.gateway || null,
            payment_method: orderRow.payment_method || null,
            verification_status: orderRow.verification_status || null,
          },
        };
      }

      if (orderErr && !isMissingRelationError(orderErr, 'orders')) {
        return { found: false, error: 'DATABASE_ERROR' };
      }

      // Pre-migration fallback when public.orders table does not exist yet
      const { data: ticketRows, error: ticketErr } = await client
        .from('tickets')
        .select('ticket_number, category, price_ugx, status, payment_status, relworx_internal_ref, ticket_channel')
        .eq('order_ref', refCheck.orderRef);

      if (ticketErr || !ticketRows || ticketRows.length === 0) {
        return { found: false };
      }

      const onlineRows = ticketRows.filter((r: any) => isOnlineTicketRow(r));
      if (onlineRows.length === 0) {
        return { found: false };
      }

      const allPaid = onlineRows.every(
        (t: any) => t.status === 'issued' && (t.payment_status === 'paid' || t.payment_status === 'manual_paid')
      );
      const computedAmount = onlineRows.reduce((sum: number, t: any) => {
        const trustedUnit = t.category === 'VIP' ? 50000 : 20000;
        return sum + trustedUnit;
      }, 0);

      return {
        found: true,
        order: {
          order_ref: refCheck.orderRef,
          status: allPaid ? 'paid' : 'pending',
          total_amount_ugx: computedAmount,
          currency: 'UGX',
          relworx_internal_ref: onlineRows[0].relworx_internal_ref || null,
          gateway: 'relworx',
          payment_method: 'relworx_mobile_money',
          verification_status: allPaid ? 'verified' : 'unsubmitted',
        },
      };
    } catch {
      return { found: false, error: 'DATABASE_ERROR' };
    }
  },

  /**
   * Admin manual verification of an order with Relworx
   */
  async verifyRelworxOrderDirectly(orderRef: string): Promise<{ success: boolean; message: string }> {
    const { client, configError } = getSupabaseClient();
    if (!client) {
      return { success: false, message: configError || 'Supabase database is not connected.' };
    }

    const orderInfo = await this.getOrderForPaymentVerification(orderRef);
    if (!orderInfo.found || !orderInfo.order) {
      return { success: false, message: 'Order reference not found in database.' };
    }

    const order = orderInfo.order;
    if (order.status === 'paid') {
      return { success: true, message: 'Order is already confirmed and paid.' };
    }

    const check = await RelworxService.checkRequestStatus({
      internalReference: order.relworx_internal_ref || undefined,
      reference: order.order_ref,
    });

    if (check.success && check.status === 'success') {
      if (check.currency && String(check.currency).toUpperCase() !== 'UGX') {
        return { success: false, message: 'Provider currency mismatch; expected UGX.' };
      }
      if (
        check.amount !== undefined &&
        check.amount !== null &&
        Math.round(Number(check.amount)) !== Math.round(Number(order.total_amount_ugx))
      ) {
        return {
          success: false,
          message: 'Provider payment amount does not match the stored order total.',
        };
      }
      await this.markOrderAsPaid(order.order_ref, { relworx: check, relworx_internal_ref: check.internal_reference });
      return { success: true, message: 'Relworx confirmed payment! Tickets successfully issued.' };
    }

    return {
      success: false,
      message: `Relworx status is currently "${check.status}". ${check.message || ''}`,
    };
  },

  /**
   * Verified Customer Order Lookup:
   * - Eliminates raw string interpolation into PostgREST .or() filters.
   * - Accepts ONLY a strictly validated Uganda phone number OR exact hyphen-preserving order reference.
   * - Requires a matching second ownership factor (checkout email, phone, or order reference).
   * - Never selects or returns qr_token, buyer_email, buyer_phone, or unrelated buyers' records.
   */
  async lookupOrdersVerified(params: {
    contact: string;
    verification: string;
  }): Promise<{
    success: boolean;
    httpStatus: number;
    count: number;
    tickets: PublicLookupTicketSummary[];
    error?: string;
    message?: string;
  }> {
    const rawContact = String(params.contact || '').trim();
    const rawVerification = String(params.verification || '').trim();

    if (!rawContact) {
      return {
        success: false,
        httpStatus: 400,
        count: 0,
        tickets: [],
        error: 'VALIDATION_ERROR',
        message: 'Please enter a valid Uganda phone number or exact order reference.',
      };
    }

    // Parse primary identifier (either exact hyphenated order reference OR Uganda phone)
    const primaryOrderRef = normalizeStrictOrderRef(rawContact);
    const primaryPhone = !primaryOrderRef.valid ? RelworxService.formatUgandaMsisdn(rawContact) : null;

    if (!primaryOrderRef.valid && (!primaryPhone || !primaryPhone.valid)) {
      return {
        success: false,
        httpStatus: 400,
        count: 0,
        tickets: [],
        error: 'VALIDATION_ERROR',
        message: 'Enter a valid Uganda phone number (e.g. 0775 198 484) or exact order reference (e.g. PP-RWX-...).',
      };
    }

    if (!rawVerification) {
      return {
        success: false,
        httpStatus: 400,
        count: 0,
        tickets: [],
        error: 'OWNERSHIP_VERIFICATION_REQUIRED',
        message:
          'Ownership verification is required: enter your checkout email address (or matching order reference / phone number).',
      };
    }

    const verifEmailValid = EMAIL_STRICT_REGEX.test(rawVerification);
    const verifOrderRef = !verifEmailValid ? normalizeStrictOrderRef(rawVerification) : { valid: false, orderRef: '' };
    const verifPhone =
      !verifEmailValid && !verifOrderRef.valid ? RelworxService.formatUgandaMsisdn(rawVerification) : null;

    let resolvedOrderRef: string | null = primaryOrderRef.valid ? primaryOrderRef.orderRef : null;
    let resolvedMsisdn: string | null = primaryPhone?.valid ? primaryPhone.msisdn : null;
    let resolvedEmailLower: string | null = null;

    if (primaryOrderRef.valid) {
      // Primary is orderRef -> verification must be checkout email OR checkout phone
      if (verifEmailValid) {
        resolvedEmailLower = rawVerification.toLowerCase();
      } else if (verifPhone && verifPhone.valid) {
        resolvedMsisdn = verifPhone.msisdn;
      } else {
        return {
          success: false,
          httpStatus: 400,
          count: 0,
          tickets: [],
          error: 'OWNERSHIP_VERIFICATION_REQUIRED',
          message: 'When searching by order reference, verify ownership using the email or phone number used at checkout.',
        };
      }
    } else {
      // Primary is phone -> verification must be checkout email OR exact orderRef
      if (verifEmailValid) {
        resolvedEmailLower = rawVerification.toLowerCase();
      } else if (verifOrderRef.valid) {
        resolvedOrderRef = verifOrderRef.orderRef;
      } else {
        return {
          success: false,
          httpStatus: 400,
          count: 0,
          tickets: [],
          error: 'OWNERSHIP_VERIFICATION_REQUIRED',
          message: 'When searching by phone number, verify ownership using your checkout email address or exact order reference.',
        };
      }
    }

    const { client, configError } = getSupabaseClient();
    if (!client) {
      return {
        success: false,
        httpStatus: 503,
        count: 0,
        tickets: [],
        error: 'SUPABASE_NOT_CONFIGURED',
        message: configError || 'Ticketing database is currently offline.',
      };
    }

    // Notice: qr_token is NEVER selected from the database here
    const selectCols =
      'ticket_number, category, price_ugx, status, payment_status, buyer_name, buyer_email, buyer_phone, order_ref, paid_at, checked_in_at, ticket_channel';
    const preMigrationCols =
      'ticket_number, category, price_ugx, status, payment_status, buyer_name, buyer_email, buyer_phone, order_ref, paid_at, checked_in_at';

    try {
      let candidateRows: any[] = [];

      if (resolvedOrderRef) {
        let queryRes: { data: any[] | null; error: any } = await client
          .from('tickets')
          .select(selectCols)
          .eq('order_ref', resolvedOrderRef)
          .eq('status', 'issued')
          .in('payment_status', ['paid', 'manual_paid'])
          .eq('ticket_channel', 'online')
          .order('ticket_number', { ascending: true })
          .limit(20);

        if (queryRes.error && isMissingColumnError(queryRes.error, 'ticket_channel')) {
          queryRes = await client
            .from('tickets')
            .select(preMigrationCols)
            .eq('order_ref', resolvedOrderRef)
            .eq('status', 'issued')
            .in('payment_status', ['paid', 'manual_paid'])
            .order('ticket_number', { ascending: true })
            .limit(20);
        }

        if (queryRes.error) {
          return {
            success: false,
            httpStatus: 503,
            count: 0,
            tickets: [],
            error: 'DATABASE_ERROR',
            message: 'Unable to complete ticket lookup right now.',
          };
        }
        candidateRows = queryRes.data || [];
      } else if (resolvedEmailLower && resolvedMsisdn) {
        // Escape LIKE metacharacters so _ or % can never act as wildcards
        const escapedExactEmail = resolvedEmailLower.replace(/[\\%_]/g, '\\$&');
        let queryRes: { data: any[] | null; error: any } = await client
          .from('tickets')
          .select(selectCols)
          .ilike('buyer_email', escapedExactEmail)
          .eq('status', 'issued')
          .in('payment_status', ['paid', 'manual_paid'])
          .eq('ticket_channel', 'online')
          .order('ticket_number', { ascending: true })
          .limit(25);

        if (queryRes.error && isMissingColumnError(queryRes.error, 'ticket_channel')) {
          queryRes = await client
            .from('tickets')
            .select(preMigrationCols)
            .ilike('buyer_email', escapedExactEmail)
            .eq('status', 'issued')
            .in('payment_status', ['paid', 'manual_paid'])
            .order('ticket_number', { ascending: true })
            .limit(25);
        }

        if (queryRes.error) {
          return {
            success: false,
            httpStatus: 503,
            count: 0,
            tickets: [],
            error: 'DATABASE_ERROR',
            message: 'Unable to complete ticket lookup right now.',
          };
        }
        candidateRows = queryRes.data || [];
      }

      // Constant-time ownership verification & strict online-channel filtering per row
      const verifiedTickets: PublicLookupTicketSummary[] = [];
      for (const row of candidateRows) {
        if (!isOnlineTicketRow(row)) continue;
        if (row.status !== 'issued') continue;
        if (row.payment_status !== 'paid' && row.payment_status !== 'manual_paid') continue;

        if (resolvedOrderRef) {
          const rowRef = String(row.order_ref || '').trim().toUpperCase();
          if (!rowRef || !safeCompareSecret(rowRef, resolvedOrderRef)) continue;
        }

        if (resolvedEmailLower) {
          const rowEmail = String(row.buyer_email || '').trim().toLowerCase();
          if (!rowEmail || !safeCompareSecret(rowEmail, resolvedEmailLower)) continue;
        }

        if (resolvedMsisdn) {
          const rowPhone = RelworxService.formatUgandaMsisdn(String(row.buyer_phone || ''));
          if (!rowPhone.valid || !safeCompareSecret(rowPhone.msisdn, resolvedMsisdn)) continue;
        }

        verifiedTickets.push({
          ticket_number: row.ticket_number,
          category: row.category,
          price_ugx: Number(row.price_ugx || 0),
          status: 'issued',
          payment_status: row.payment_status,
          buyer_name: row.buyer_name || null,
          order_ref: row.order_ref || null,
          paid_at: row.paid_at || null,
          checked_in_at: row.checked_in_at || null,
        });
      }

      // Uniform non-enumerating response when no rows match or ownership check fails
      if (verifiedTickets.length === 0) {
        return {
          success: true,
          httpStatus: 200,
          count: 0,
          tickets: [],
          message: 'No confirmed tickets matched the provided details.',
        };
      }

      return {
        success: true,
        httpStatus: 200,
        count: verifiedTickets.length,
        tickets: verifiedTickets,
      };
    } catch {
      return {
        success: false,
        httpStatus: 500,
        count: 0,
        tickets: [],
        error: 'SERVER_ERROR',
        message: 'Unable to complete ticket lookup right now.',
      };
    }
  },

  /**
   * Backwards-compatible wrapper that enforces ownership verification and never returns raw QR tokens.
   */
  async lookupTicketsByContact(contact: string, verification: string = ''): Promise<PublicLookupTicketSummary[]> {
    const res = await this.lookupOrdersVerified({ contact, verification });
    return res.success ? res.tickets : [];
  },

  /**
   * Read-Only Public Ticket Validity Lookup (QR Token UUID ONLY):
   * - Accepts only a valid UUID qr_token (or ?verify=<uuid> URL).
   * - Rejects sequential ticket numbers (e.g. VIP-001, ORD-051) to prevent enumeration.
   * - Never exposes buyer_name, buyer_email, buyer_phone, order_ref, or qr_token.
   * - Strictly read-only: NEVER updates checked_in_at or mutates database state.
   */
  async getPublicTicketStatusByToken(rawToken: string): Promise<{
    success: boolean;
    valid: boolean;
    status: 'VALID_UNUSED' | 'INACTIVE' | 'ALREADY_USED' | 'CANCELLED' | 'INVALID';
    message: string;
    ticketNumber?: string;
    category?: 'VIP' | 'ORDINARY';
    channel?: 'online' | 'hardcopy';
    checkedIn?: boolean;
    httpStatus?: number;
  }> {
    const clean = extractVerificationInput(rawToken);
    if (!clean || !UUID_STRICT_REGEX.test(clean)) {
      return {
        success: false,
        valid: false,
        status: 'INVALID',
        message: 'A valid QR token UUID is required for public pass verification.',
        httpStatus: 400,
      };
    }

    const { client, configError } = getSupabaseClient();
    if (!client) {
      return {
        success: false,
        valid: false,
        status: 'INVALID',
        message: configError || 'Ticketing verification service is currently offline.',
        httpStatus: 503,
      };
    }

    const normalizedUuid = clean.toLowerCase();

    try {
      let row: {
        ticket_number: string;
        category: 'VIP' | 'ORDINARY';
        status: string;
        payment_status: string;
        checked_in_at: string | null;
        ticket_channel?: 'online' | 'hardcopy' | null;
      } | null = null;

      const primary = await client
        .from('tickets')
        .select('ticket_number, category, status, payment_status, checked_in_at, ticket_channel')
        .eq('qr_token', normalizedUuid)
        .maybeSingle();

      if (primary.error && isMissingColumnError(primary.error, 'ticket_channel')) {
        const fallback = await client
          .from('tickets')
          .select('ticket_number, category, status, payment_status, checked_in_at')
          .eq('qr_token', normalizedUuid)
          .maybeSingle();
        if (fallback.error) {
          return {
            success: false,
            valid: false,
            status: 'INVALID',
            message: 'Unable to verify pass status right now.',
            httpStatus: 503,
          };
        }
        row = fallback.data as any;
      } else if (primary.error) {
        return {
          success: false,
          valid: false,
          status: 'INVALID',
          message: 'Unable to verify pass status right now.',
          httpStatus: 503,
        };
      } else {
        row = primary.data as any;
      }

      if (!row) {
        return {
          success: true,
          valid: false,
          status: 'INVALID',
          message: 'Unrecognized QR code. This pass was not found in official Pool Party inventory.',
          httpStatus: 200,
        };
      }

      const channel: 'online' | 'hardcopy' =
        row.ticket_channel === 'hardcopy' || inferTicketChannelFromNumber(row.ticket_number) === 'hardcopy'
          ? 'hardcopy'
          : 'online';

      if (row.status === 'cancelled') {
        return {
          success: true,
          valid: false,
          status: 'CANCELLED',
          ticketNumber: row.ticket_number,
          category: row.category,
          channel,
          checkedIn: Boolean(row.checked_in_at),
          message: 'This pass has been cancelled or voided and is not valid for gate entry.',
          httpStatus: 200,
        };
      }

      const isPaidAndIssued =
        row.status === 'issued' && (row.payment_status === 'paid' || row.payment_status === 'manual_paid');

      if (!isPaidAndIssued) {
        return {
          success: true,
          valid: false,
          status: 'INACTIVE',
          ticketNumber: row.ticket_number,
          category: row.category,
          channel,
          checkedIn: false,
          message:
            channel === 'hardcopy'
              ? 'This hardcopy pass has not been activated for sale yet and is not valid for gate entry.'
              : 'This pass is not yet paid or issued.',
          httpStatus: 200,
        };
      }

      if (row.checked_in_at) {
        return {
          success: true,
          valid: false,
          status: 'ALREADY_USED',
          ticketNumber: row.ticket_number,
          category: row.category,
          channel,
          checkedIn: true,
          message: 'This pass has already been used for gate entry.',
          httpStatus: 200,
        };
      }

      return {
        success: true,
        valid: true,
        status: 'VALID_UNUSED',
        ticketNumber: row.ticket_number,
        category: row.category,
        channel,
        checkedIn: false,
        message: 'Authentic Pool Party pass — valid and unused. Present at the gate for staff check-in.',
        httpStatus: 200,
      };
    } catch {
      return {
        success: false,
        valid: false,
        status: 'INVALID',
        message: 'Unable to verify pass status right now.',
        httpStatus: 500,
      };
    }
  },

  /**
   * Atomic Gate Check-in: Checks qr_token (UUID) or ticket_number (VIP-xxx / ORD-xxx),
   * enforces issued + paid/manual_paid + unused, and prevents simultaneous duplicate admissions.
   * Never falls back to non-atomic behavior on arbitrary RPC or network errors.
   */
  async verifyAndCheckIn(tokenOrNumber: string): Promise<{
    status: 'ADMITTED' | 'ALREADY_USED' | 'UNPAID' | 'NOT_ISSUED' | 'CANCELLED' | 'INVALID';
    message: string;
    ticket?: TicketRow;
    checkedInAt?: string;
    error?: string;
    httpStatus?: number;
  }> {
    const clean = extractVerificationInput(tokenOrNumber);
    if (!clean) {
      return {
        status: 'INVALID',
        message: 'Invalid or unrecognized QR token / ticket number.',
        httpStatus: 400,
      };
    }

    const isUuid = UUID_STRICT_REGEX.test(clean);
    const isTicketNumber = !isUuid && TICKET_NUMBER_STRICT_REGEX.test(clean);

    // Strict input validation: reject malformed strings before querying PostgREST / RPC
    if (!isUuid && !isTicketNumber) {
      return {
        status: 'INVALID',
        message: 'Invalid or unrecognized QR token / ticket number.',
        httpStatus: 200,
      };
    }

    const normalizedLookup = isUuid ? clean.toLowerCase() : clean.toUpperCase();

    const { client } = getSupabaseClient();
    if (!client) {
      return {
        status: 'INVALID',
        error: 'SUPABASE_NOT_CONFIGURED',
        httpStatus: 503,
        message: 'Database offline. Check-in system requires active Supabase connection.',
      };
    }

    // In-process concurrency guard for simultaneous scans on the same server instance
    if (_inFlightTicketCheckIns.has(normalizedLookup)) {
      return {
        status: 'ALREADY_USED',
        message: 'Duplicate simultaneous scan detected. Please wait for the active scan to finish.',
        httpStatus: 200,
      };
    }

    _inFlightTicketCheckIns.add(normalizedLookup);

    try {
      let rpcMissing = false;
      try {
        const { data: rpcRes, error: rpcErr } = await client.rpc('gate_checkin_atomic', {
          p_token_or_number: normalizedLookup,
        });

        if (!rpcErr && rpcRes && rpcRes.status) {
          return {
            status: rpcRes.status,
            message: rpcRes.message,
            checkedInAt: rpcRes.checkedInAt,
            ticket: sanitizeCheckInTicket(rpcRes.ticket),
            httpStatus: 200,
          };
        }

        if (rpcErr && isMissingRpcError(rpcErr)) {
          rpcMissing = true;
        } else {
          console.error('[gate_checkin_atomic RPC Error]', rpcErr?.code, sanitizeDiagnosticText(rpcErr?.message || ''));
          return {
            status: 'INVALID',
            error: 'DATABASE_ERROR',
            httpStatus: 503,
            message: 'Unable to complete atomic gate check-in right now. Please retry.',
          };
        }
      } catch (rpcException: any) {
        console.error('[gate_checkin_atomic Network Exception]', sanitizeDiagnosticText(rpcException?.message || ''));
        return {
          status: 'INVALID',
          error: 'DATABASE_ERROR',
          httpStatus: 503,
          message: 'Network error communicating with check-in database. Please retry.',
        };
      }

      if (!rpcMissing) {
        return {
          status: 'INVALID',
          error: 'DATABASE_ERROR',
          httpStatus: 503,
          message: 'Unable to complete atomic gate check-in right now.',
        };
      }

      // Single-statement compare-and-set (`checked_in_at IS NULL`) ONLY when gate_checkin_atomic RPC does not exist yet
      const checkInCols =
        'id, ticket_number, category, price_ugx, status, payment_status, buyer_name, created_at, paid_at, checked_in_at, ticket_channel';
      const preMigrationCheckInCols =
        'id, ticket_number, category, price_ugx, status, payment_status, buyer_name, created_at, paid_at, checked_in_at';

      let primaryLookup = isUuid
        ? await client.from('tickets').select(checkInCols).eq('qr_token', normalizedLookup).maybeSingle()
        : await client.from('tickets').select(checkInCols).eq('ticket_number', normalizedLookup).maybeSingle();

      if (primaryLookup.error && isMissingColumnError(primaryLookup.error, 'ticket_channel')) {
        primaryLookup = isUuid
          ? await client.from('tickets').select(preMigrationCheckInCols).eq('qr_token', normalizedLookup).maybeSingle()
          : await client.from('tickets').select(preMigrationCheckInCols).eq('ticket_number', normalizedLookup).maybeSingle();
      }

      const { data, error } = primaryLookup;

      if (error) {
        return {
          status: 'INVALID',
          error: 'DATABASE_ERROR',
          httpStatus: 503,
          message: 'Database error while verifying ticket. Please retry.',
        };
      }

      if (!data) {
        return {
          status: 'INVALID',
          message: 'Invalid or unrecognized QR token / ticket number.',
          httpStatus: 200,
        };
      }

      const ticket = data as unknown as TicketRow;
      const safeTicket = sanitizeCheckInTicket(ticket);
      const isHardcopy =
        ticket.ticket_channel === 'hardcopy' || inferTicketChannelFromNumber(ticket.ticket_number) === 'hardcopy';

      if (ticket.status === 'cancelled') {
        return {
          status: 'CANCELLED',
          message: `Ticket ${ticket.ticket_number} has been cancelled or voided. Deny entry.`,
          ticket: safeTicket,
          httpStatus: 200,
        };
      }

      if (ticket.status !== 'issued' || (ticket.payment_status !== 'paid' && ticket.payment_status !== 'manual_paid')) {
        return {
          status: 'UNPAID',
          message: isHardcopy
            ? `Hardcopy ticket ${ticket.ticket_number} has not been activated/sold yet. Deny entry.`
            : `Ticket ${ticket.ticket_number} is unpaid (${ticket.status}). Payment required.`,
          ticket: safeTicket,
          httpStatus: 200,
        };
      }

      if (ticket.checked_in_at) {
        return {
          status: 'ALREADY_USED',
          message: `DUPLICATE: Already used at ${new Date(ticket.checked_in_at).toLocaleTimeString()}.`,
          ticket: safeTicket,
          checkedInAt: ticket.checked_in_at,
          httpStatus: 200,
        };
      }

      const now = new Date().toISOString();
      let updateRes = await client
        .from('tickets')
        .update({ checked_in_at: now })
        .eq('id', ticket.id)
        .eq('status', 'issued')
        .in('payment_status', ['paid', 'manual_paid'])
        .is('checked_in_at', null)
        .select(checkInCols)
        .maybeSingle();

      if (updateRes.error && isMissingColumnError(updateRes.error, 'ticket_channel')) {
        updateRes = await client
          .from('tickets')
          .update({ checked_in_at: now })
          .eq('id', ticket.id)
          .eq('status', 'issued')
          .in('payment_status', ['paid', 'manual_paid'])
          .is('checked_in_at', null)
          .select(preMigrationCheckInCols)
          .maybeSingle();
      }

      const { data: updated, error: updateErr } = updateRes;

      if (updateErr) {
        return {
          status: 'INVALID',
          error: 'DATABASE_ERROR',
          httpStatus: 503,
          message: 'Database error while recording check-in. Please retry.',
        };
      }

      if (!updated) {
        return {
          status: 'ALREADY_USED',
          message: 'Duplicate scan detected. This ticket was just admitted.',
          ticket: safeTicket,
          httpStatus: 200,
        };
      }

      const safeUpdated = sanitizeCheckInTicket(updated as unknown as TicketRow);
      return {
        status: 'ADMITTED',
        message: `ADMITTED: Welcome to Pool Party, ${(updated as any).buyer_name || 'Guest'}! (${(updated as any).category} Pass #${(updated as any).ticket_number})`,
        ticket: safeUpdated,
        checkedInAt: now,
        httpStatus: 200,
      };
    } catch {
      return {
        status: 'INVALID',
        error: 'DATABASE_ERROR',
        httpStatus: 503,
        message: 'Unable to complete check-in verification right now.',
      };
    } finally {
      _inFlightTicketCheckIns.delete(normalizedLookup);
    }
  },

  /**
   * Admin Operations (Secure Server-Side with Supabase)
   */
  async getAllTicketsAdmin(): Promise<{ success: boolean; tickets: TicketRow[]; error?: string }> {
    const { client, configError } = getSupabaseClient();
    if (!client) {
      return { success: false, tickets: [], error: configError || 'Database not connected.' };
    }

    try {
      const { data, error } = await client
        .from('tickets')
        .select('*')
        .order('ticket_number', { ascending: true });

      if (error) {
        return { success: false, tickets: [], error: 'Unable to fetch tickets from database.' };
      }

      return { success: true, tickets: (data as TicketRow[]) || [] };
    } catch {
      return { success: false, tickets: [], error: 'Database query failed.' };
    }
  },

  async getAllOrdersAdmin(): Promise<{ success: boolean; orders: OrderRow[]; error?: string }> {
    const { client, configError } = getSupabaseClient();
    if (!client) {
      return { success: false, orders: [], error: configError || 'Database not connected.' };
    }

    try {
      const { data, error } = await client
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (error && isMissingRelationError(error, 'orders')) {
        // Synthesize orders from tickets table and memory submissions
        const { data: ticketRows } = await client
          .from('tickets')
          .select('*')
          .not('order_ref', 'is', null);

        const orderMap = new Map<string, any>();
        if (ticketRows) {
          for (const t of ticketRows) {
            const ref = t.order_ref;
            if (!ref) continue;
            if (!orderMap.has(ref)) {
              const mtnSub = _mtnSubmissionsByOrderRef.get(ref);
              const isPaid = t.status === 'issued' && (t.payment_status === 'paid' || t.payment_status === 'manual_paid');
              orderMap.set(ref, {
                id: ref,
                order_ref: ref,
                category: t.category,
                quantity: 1,
                unit_price_ugx: t.price_ugx,
                total_amount_ugx: t.price_ugx,
                status: isPaid ? 'paid' : t.status === 'cancelled' ? 'cancelled' : 'pending',
                verification_status: mtnSub?.verificationStatus || (isPaid ? 'verified' : 'unsubmitted'),
                mtn_transaction_id: mtnSub?.mtnTransactionId || t.mtn_transaction_id || null,
                payer_phone: mtnSub?.payerPhone || t.buyer_phone || null,
                verified_at: mtnSub?.verifiedAt || t.paid_at || null,
                verified_by: mtnSub?.verifiedBy || null,
                rejection_reason: mtnSub?.rejectionReason || null,
                payment_method: 'mtn_momo',
                network: 'MTN',
                buyer_name: t.buyer_name || 'Guest',
                buyer_email: t.buyer_email || '',
                buyer_phone: t.buyer_phone || '',
                created_at: mtnSub?.submittedAt || t.created_at || new Date().toISOString(),
                reserved_until: t.reserved_until,
              });
            } else {
              const ord = orderMap.get(ref);
              ord.quantity += 1;
              ord.total_amount_ugx += t.price_ugx;
            }
          }
        }

        // Add any memory submissions not in query
        for (const [ref, sub] of _mtnSubmissionsByOrderRef.entries()) {
          if (!orderMap.has(ref)) {
            orderMap.set(ref, {
              id: ref,
              order_ref: ref,
              category: 'ORDINARY',
              quantity: 1,
              unit_price_ugx: 20000,
              total_amount_ugx: 20000,
              status: sub.verificationStatus === 'verified' ? 'paid' : 'pending',
              verification_status: sub.verificationStatus,
              mtn_transaction_id: sub.mtnTransactionId,
              payer_phone: sub.payerPhone,
              verified_at: sub.verifiedAt || null,
              verified_by: sub.verifiedBy || null,
              rejection_reason: sub.rejectionReason || null,
              payment_method: 'mtn_momo',
              network: 'MTN',
              buyer_name: 'Guest',
              buyer_email: '',
              buyer_phone: sub.payerPhone,
              created_at: sub.submittedAt,
            });
          }
        }

        const synthList = Array.from(orderMap.values()).sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        return { success: true, orders: synthList as OrderRow[] };
      }

      if (error) {
        return { success: false, orders: [], error: 'Unable to fetch orders from database.' };
      }

      // Fetch tickets that have order references to cross-reference transaction IDs and buyer details
      let ticketsByOrderRef = new Map<string, { mtn_transaction_id?: string | null; buyer_phone?: string | null }>();
      try {
        const { data: ticketRows } = await client
          .from('tickets')
          .select('order_ref, mtn_transaction_id, buyer_phone')
          .not('order_ref', 'is', null);

        if (ticketRows) {
          for (const tr of ticketRows) {
            if (tr.order_ref && !ticketsByOrderRef.has(tr.order_ref)) {
              ticketsByOrderRef.set(tr.order_ref, {
                mtn_transaction_id: tr.mtn_transaction_id,
                buyer_phone: tr.buyer_phone,
              });
            }
          }
        }
      } catch {
        // Non-fatal if tickets query fails
      }

      // Enrich orders with memory submissions and tickets if columns are null
      const orderMap = new Map<string, OrderRow>();

      for (const ord of (data as OrderRow[]) || []) {
        const sub = _mtnSubmissionsByOrderRef.get(ord.order_ref);
        const ticketInfo = ticketsByOrderRef.get(ord.order_ref);

        const mtnTxId = ord.mtn_transaction_id || sub?.mtnTransactionId || ticketInfo?.mtn_transaction_id || null;
        const payerPhone = ord.payer_phone || sub?.payerPhone || ticketInfo?.buyer_phone || ord.buyer_phone || null;

        // Normalize verification status so it is never undefined or missing
        let verificationStatus = ord.verification_status || sub?.verificationStatus;
        if (!verificationStatus) {
          if (ord.status === 'paid') {
            verificationStatus = 'verified';
          } else if (ord.status === 'failed' || ord.status === 'cancelled') {
            verificationStatus = 'rejected';
          } else if (mtnTxId) {
            verificationStatus = 'pending_verification';
          } else {
            verificationStatus = 'unsubmitted';
          }
        }

        orderMap.set(ord.order_ref, {
          ...ord,
          verification_status: verificationStatus as any,
          mtn_transaction_id: mtnTxId,
          payer_phone: payerPhone,
          verified_at: ord.verified_at || sub?.verifiedAt || null,
          verified_by: ord.verified_by || sub?.verifiedBy || null,
          rejection_reason: ord.rejection_reason || sub?.rejectionReason || null,
        });
      }

      // Also ensure any recent memory submissions are present in the list
      for (const [ref, sub] of _mtnSubmissionsByOrderRef.entries()) {
        if (!orderMap.has(ref)) {
          orderMap.set(ref, {
            id: ref,
            order_ref: ref,
            category: 'ORDINARY',
            quantity: 1,
            unit_price_ugx: 20000,
            total_amount_ugx: 20000,
            status: sub.verificationStatus === 'verified' ? 'paid' : sub.verificationStatus === 'rejected' ? 'failed' : 'pending',
            verification_status: sub.verificationStatus as any,
            mtn_transaction_id: sub.mtnTransactionId,
            payer_phone: sub.payerPhone,
            verified_at: sub.verifiedAt || null,
            verified_by: sub.verifiedBy || null,
            rejection_reason: sub.rejectionReason || null,
            payment_method: 'mtn_momo_merchant',
            network: 'MTN',
            buyer_name: 'Guest',
            buyer_email: '',
            buyer_phone: sub.payerPhone,
            created_at: sub.submittedAt || new Date().toISOString(),
          } as OrderRow);
        }
      }

      const enriched = Array.from(orderMap.values()).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      return { success: true, orders: enriched };
    } catch {
      return { success: false, orders: [], error: 'Database query failed.' };
    }
  },

  async recordPhysicalSaleAdmin(params: {
    category: 'VIP' | 'ORDINARY';
    quantity: number;
    buyerName: string;
    buyerEmail: string;
    buyerPhone: string;
  }): Promise<{ success: boolean; message: string; tickets?: TicketRow[] }> {
    const { category, quantity, buyerName, buyerEmail, buyerPhone } = params;

    const { client, configError } = getSupabaseClient();
    if (!client) {
      return { success: false, message: configError || 'Database is offline. Connect Supabase to record sales.' };
    }

    await this.releaseExpiredReservations();

    try {
      let candidateRows: TicketRow[] | null = null;
      let fetchErr: any = null;

      const primaryFetch = await client
        .from('tickets')
        .select('*')
        .eq('ticket_channel', 'online')
        .eq('category', category)
        .eq('status', 'available')
        .order('ticket_number', { ascending: true })
        .limit(quantity);

      candidateRows = primaryFetch.data as TicketRow[] | null;
      fetchErr = primaryFetch.error;

      if (fetchErr && isMissingColumnError(fetchErr, 'ticket_channel')) {
        const fallbackFetch = await client
          .from('tickets')
          .select('*')
          .eq('category', category)
          .eq('status', 'available')
          .order('ticket_number', { ascending: true });
        candidateRows = fallbackFetch.data as TicketRow[] | null;
        fetchErr = fallbackFetch.error;
      }

      const available = (candidateRows || []).filter((t) => isOnlineTicketRow(t)).slice(0, quantity);

      if (fetchErr || available.length < quantity) {
        return {
          success: false,
          message: `Sold out! Only ${available.length} ${category} ticket(s) remaining.`,
        };
      }

      const idsToUpdate = available.map((t) => t.id);
      const now = new Date().toISOString();
      const orderRef = `PP-BOX-${Date.now()}`;
      const unitPrice = category === 'VIP' ? 50000 : 20000;
      const totalAmount = unitPrice * quantity;

      const { data: updated, error: updateErr } = await client
        .from('tickets')
        .update({
          status: 'issued',
          payment_status: 'manual_paid',
          buyer_name: buyerName.trim(),
          buyer_email: buyerEmail.trim(),
          buyer_phone: buyerPhone.trim(),
          order_ref: orderRef,
          paid_at: now,
        })
        .in('id', idsToUpdate)
        .eq('status', 'available')
        .select();

      if (updateErr || !updated || updated.length < quantity) {
        return { success: false, message: 'Could not issue physical ticket(s) in database.' };
      }

      await client.from('orders').insert({
        order_ref: orderRef,
        category,
        quantity,
        unit_price_ugx: unitPrice,
        total_amount_ugx: totalAmount,
        status: 'paid',
        payment_method: 'box_office_cash',
        buyer_name: buyerName.trim(),
        buyer_email: buyerEmail.trim(),
        buyer_phone: buyerPhone.trim(),
        paid_at: now,
      });

      return {
        success: true,
        message: `Issued ${quantity} physical ${category} ticket(s).`,
        tickets: updated as TicketRow[],
      };
    } catch {
      return { success: false, message: 'Database error recording physical sale.' };
    }
  },

  /**
   * Admin-Only Atomic Hardcopy Ticket Activation (Single Ticket or Contiguous Number Range)
   * - Enforces hardcopy bounds (ORD-051..ORD-250, VIP-021..VIP-120); rejects online pool tickets.
   * - All-or-nothing atomic activation: aborts if any ticket in the range is missing or not available.
   * - Persists an immutable audit entry in public.hardcopy_audit_logs (rolls back activation if audit fails).
   */
  async activateHardcopyTicketsAdmin(params: {
    ticketNumber?: string;
    ticketNumbers?: string[];
    category?: string;
    startNumber?: string | number;
    endNumber?: string | number;
    sellerName: string;
    performedBy?: string;
    batchRef?: string;
    buyerName?: string;
    buyerPhone?: string;
    notes?: string;
  }): Promise<{
    success: boolean;
    message: string;
    error?: string;
    batchRef?: string;
    auditId?: string;
    action?: 'activate_single' | 'activate_range';
    category?: 'VIP' | 'ORDINARY';
    activatedCount?: number;
    ticketNumbers?: string[];
    unitPriceUgx?: number;
    totalAmountUgx?: number;
    sellerName?: string;
    performedBy?: string;
    activatedAt?: string;
    conflictingTickets?: string[];
  }> {
    const selection = parseHardcopySelection({
      ticketNumber: params.ticketNumber,
      ticketNumbers: params.ticketNumbers,
      category: params.category,
      startNumber: params.startNumber,
      endNumber: params.endNumber,
    });

    if (!selection.valid || !selection.category || !selection.ticketNumbers) {
      return {
        success: false,
        error: selection.error || 'VALIDATION_ERROR',
        message: selection.message || 'Invalid hardcopy ticket selection.',
        conflictingTickets: selection.conflictingTickets,
      };
    }

    const sellerName = String(params.sellerName ?? '').trim();
    if (sellerName.length < 2 || sellerName.length > 120) {
      return {
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'sellerName (assigned agent, promoter, or box office seller) is required (2–120 characters).',
      };
    }

    const performedBy = params.performedBy === undefined ? 'Admin' : String(params.performedBy).trim();
    if (performedBy.length < 2 || performedBy.length > 80) {
      return {
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'performedBy (authorizing admin identifier) must be between 2 and 80 characters.',
      };
    }

    const batchRef =
      params.batchRef === undefined
        ? `PP-HC-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`
        : String(params.batchRef).trim();

    if (batchRef.length < 4 || batchRef.length > 120 || !/^[A-Za-z0-9_-]+$/.test(batchRef)) {
      return {
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'batchRef must be 4–120 alphanumeric, hyphen, or underscore characters.',
      };
    }

    const buyerName = params.buyerName ? String(params.buyerName).trim().slice(0, 120) : undefined;
    const buyerPhone = params.buyerPhone ? String(params.buyerPhone).trim().slice(0, 40) : undefined;
    const notes = params.notes ? String(params.notes).trim().slice(0, 500) : undefined;

    const { client, configError } = getSupabaseClient();
    if (!client) {
      return {
        success: false,
        error: 'SUPABASE_NOT_CONFIGURED',
        message: configError || 'Ticketing database is offline.',
      };
    }

    const category = selection.category;
    const ticketNumbers = selection.ticketNumbers;
    const action: 'activate_single' | 'activate_range' = selection.isRange ? 'activate_range' : 'activate_single';
    const unitPriceUgx = HARDCOPY_RANGES[category].unitPriceUgx;

    return runSerializedHardcopyMutation(async () => {
      // Requires PostgreSQL transactional RPC (activate_hardcopy_tickets_atomic) so ticket updates
      // and hardcopy_audit_logs inserts commit or roll back inside a single database transaction.
      // Never performs non-atomic multi-step HTTP PATCH + compensating rollback.
      try {
        const { data: rpcRes, error: rpcErr } = await client.rpc('activate_hardcopy_tickets_atomic', {
          p_ticket_numbers: ticketNumbers,
          p_category: category,
          p_action: action,
          p_agent_or_seller: sellerName,
          p_performed_by: performedBy,
          p_batch_ref: batchRef,
          p_buyer_name: buyerName || null,
          p_buyer_phone: buyerPhone || null,
          p_notes: notes || null,
        });

        if (!rpcErr && rpcRes && typeof rpcRes.success === 'boolean') {
          return rpcRes;
        }

        if (rpcErr && isMissingRpcError(rpcErr)) {
          return {
            success: false,
            error: 'SCHEMA_MISMATCH',
            message:
              'Required PostgreSQL RPC public.activate_hardcopy_tickets_atomic is not installed. Apply the hardcopy SQL migration before activating hardcopy tickets; no tickets were modified.',
          };
        }

        const classified = classifySchemaError(
          rpcErr,
          'Database error while activating hardcopy tickets via atomic RPC. No tickets were modified.'
        );
        return {
          success: false,
          error: classified.error,
          message: classified.message,
        };
      } catch (err: any) {
        console.error('[Hardcopy Activation RPC Exception]', sanitizeDiagnosticText(err?.message || ''));
        return {
          success: false,
          error: 'DATABASE_ERROR',
          message: 'Unable to reach database RPC public.activate_hardcopy_tickets_atomic. No tickets were modified.',
        };
      }
    });
  },

  /**
   * Admin-Only Atomic Hardcopy Return / Void Status Update (Preserves Printed QR Tokens)
   * - deactivate_return: returns un-scanned activated ('issued') physical tickets to available/unpaid stock.
   * - void_cancel: permanently cancels non-cancelled physical tickets so they are denied at gate.
   * - Requires PostgreSQL RPC public.update_hardcopy_tickets_status_atomic (single database transaction).
   */
  async updateHardcopyTicketsStatusAdmin(params: {
    ticketNumber?: string;
    ticketNumbers?: string[];
    category?: string;
    startNumber?: string | number;
    endNumber?: string | number;
    action: 'deactivate_return' | 'void_cancel';
    sellerName: string;
    performedBy?: string;
    batchRef?: string;
    notes?: string;
  }): Promise<{
    success: boolean;
    message: string;
    error?: string;
    auditId?: string;
    batchRef?: string;
    action?: 'deactivate_return' | 'void_cancel';
    category?: 'VIP' | 'ORDINARY';
    updatedCount?: number;
    ticketNumbers?: string[];
    conflictingTickets?: string[];
  }> {
    if (params.action !== 'deactivate_return' && params.action !== 'void_cancel') {
      return {
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'action must be deactivate_return or void_cancel.',
      };
    }

    const selection = parseHardcopySelection({
      ticketNumber: params.ticketNumber,
      ticketNumbers: params.ticketNumbers,
      category: params.category,
      startNumber: params.startNumber,
      endNumber: params.endNumber,
    });

    if (!selection.valid || !selection.category || !selection.ticketNumbers) {
      return {
        success: false,
        error: selection.error || 'VALIDATION_ERROR',
        message: selection.message || 'Invalid hardcopy ticket selection.',
        conflictingTickets: selection.conflictingTickets,
      };
    }

    const sellerName = String(params.sellerName ?? '').trim();
    if (sellerName.length < 2 || sellerName.length > 120) {
      return {
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'sellerName (agent/seller reference) is required (2–120 characters).',
      };
    }

    const performedBy = params.performedBy === undefined ? 'Admin' : String(params.performedBy).trim();
    if (performedBy.length < 2 || performedBy.length > 80) {
      return {
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'performedBy (authorizing admin identifier) must be between 2 and 80 characters.',
      };
    }

    const batchRef =
      params.batchRef === undefined
        ? `PP-HC-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`
        : String(params.batchRef).trim();

    if (batchRef.length < 4 || batchRef.length > 120 || !/^[A-Za-z0-9_-]+$/.test(batchRef)) {
      return {
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'batchRef must be 4–120 alphanumeric, hyphen, or underscore characters.',
      };
    }

    const notes = params.notes ? String(params.notes).trim().slice(0, 500) : undefined;
    const category = selection.category;
    const ticketNumbers = selection.ticketNumbers;

    const { client, configError } = getSupabaseClient();
    if (!client) {
      return {
        success: false,
        error: 'SUPABASE_NOT_CONFIGURED',
        message: configError || 'Ticketing database is offline.',
      };
    }

    return runSerializedHardcopyMutation(async () => {
      try {
        const { data: rpcRes, error: rpcErr } = await client.rpc('update_hardcopy_tickets_status_atomic', {
          p_ticket_numbers: ticketNumbers,
          p_category: category,
          p_action: params.action,
          p_agent_or_seller: sellerName,
          p_performed_by: performedBy,
          p_batch_ref: batchRef,
          p_notes: notes || null,
        });

        if (!rpcErr && rpcRes && typeof rpcRes.success === 'boolean') {
          return rpcRes;
        }

        if (rpcErr && isMissingRpcError(rpcErr)) {
          return {
            success: false,
            error: 'SCHEMA_MISMATCH',
            message:
              'Required PostgreSQL RPC public.update_hardcopy_tickets_status_atomic is not installed. Apply the hardcopy SQL migration before updating hardcopy ticket status; no tickets were modified.',
          };
        }

        const classified = classifySchemaError(
          rpcErr,
          'Database error updating hardcopy ticket status via atomic RPC. No tickets were modified.'
        );
        return { success: false, error: classified.error, message: classified.message };
      } catch (err: any) {
        console.error('[Hardcopy Status RPC Exception]', sanitizeDiagnosticText(err?.message || ''));
        return {
          success: false,
          error: 'DATABASE_ERROR',
          message: 'Unable to reach database RPC public.update_hardcopy_tickets_status_atomic. No tickets were modified.',
        };
      }
    });
  },

  /**
   * Admin-Only Read Hardcopy Audit Logs
   */
  async getHardcopyAuditLogsAdmin(limit = 100): Promise<{
    success: boolean;
    logs: HardcopyAuditRow[];
    error?: string;
    message?: string;
  }> {
    const { client, configError } = getSupabaseClient();
    if (!client) {
      return {
        success: false,
        logs: [],
        error: 'SUPABASE_NOT_CONFIGURED',
        message: configError || 'Database not connected.',
      };
    }

    const boundedLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));

    try {
      const { data, error } = await client
        .from('hardcopy_audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(boundedLimit);

      if (error) {
        const classified = classifySchemaError(
          error,
          'Unable to load hardcopy audit logs. Ensure Stage 1 migration has been applied.'
        );
        return {
          success: false,
          logs: [],
          error: classified.error,
          message: classified.message,
        };
      }

      return {
        success: true,
        logs: (data as HardcopyAuditRow[]) || [],
      };
    } catch {
      return {
        success: false,
        logs: [],
        error: 'DATABASE_ERROR',
        message: 'Failed to query hardcopy audit logs.',
      };
    }
  },

  /**
   * Admin-Only Channel Summary (Separates Online 70 Pool vs Hardcopy 300 Pool)
   */
  async getChannelInventorySummaryAdmin(): Promise<{
    success: boolean;
    summary?: {
      online: {
        ordinary: { total: number; available: number; reserved: number; issued: number; checkedIn: number; revenueUgx: number };
        vip: { total: number; available: number; reserved: number; issued: number; checkedIn: number; revenueUgx: number };
      };
      hardcopy: {
        ordinary: { total: number; unactivated: number; activated: number; voided: number; checkedIn: number; revenueUgx: number };
        vip: { total: number; unactivated: number; activated: number; voided: number; checkedIn: number; revenueUgx: number };
      };
    };
    error?: string;
    message?: string;
  }> {
    const { client, configError } = getSupabaseClient();
    if (!client) {
      return { success: false, error: 'SUPABASE_NOT_CONFIGURED', message: configError || 'Database not connected.' };
    }

    try {
      let rows: Array<{
        ticket_number: string;
        category: 'VIP' | 'ORDINARY';
        price_ugx: number;
        status: string;
        payment_status: string;
        checked_in_at: string | null;
        ticket_channel?: string | null;
      }> | null = null;

      const primary = await client
        .from('tickets')
        .select('ticket_number, category, price_ugx, status, payment_status, checked_in_at, ticket_channel');

      if (primary.error && isMissingColumnError(primary.error, 'ticket_channel')) {
        const fallback = await client
          .from('tickets')
          .select('ticket_number, category, price_ugx, status, payment_status, checked_in_at');
        if (fallback.error) {
          return { success: false, error: 'DATABASE_ERROR', message: 'Unable to load ticket summary.' };
        }
        rows = fallback.data as any;
      } else if (primary.error) {
        return { success: false, error: 'DATABASE_ERROR', message: 'Unable to load ticket summary.' };
      } else {
        rows = primary.data as any;
      }

      const list = rows || [];
      const onlineRows = list.filter((r) => isOnlineTicketRow(r));
      const hardcopyRows = list.filter((r) => !isOnlineTicketRow(r));

      const buildOnlineTier = (cat: 'VIP' | 'ORDINARY') => {
        const subset = onlineRows.filter((r) => r.category === cat);
        const paidIssued = subset.filter(
          (r) => r.status === 'issued' && (r.payment_status === 'paid' || r.payment_status === 'manual_paid')
        );
        return {
          total: subset.length,
          available: subset.filter((r) => r.status === 'available').length,
          reserved: subset.filter((r) => r.status === 'reserved').length,
          issued: subset.filter((r) => r.status === 'issued').length,
          checkedIn: subset.filter((r) => Boolean(r.checked_in_at)).length,
          revenueUgx: paidIssued.reduce((sum, r) => sum + Number(r.price_ugx || 0), 0),
        };
      };

      const buildHardcopyTier = (cat: 'VIP' | 'ORDINARY') => {
        const subset = hardcopyRows.filter((r) => r.category === cat);
        const activated = subset.filter(
          (r) => r.status === 'issued' && (r.payment_status === 'paid' || r.payment_status === 'manual_paid')
        );
        return {
          total: subset.length,
          unactivated: subset.filter((r) => r.status === 'available').length,
          activated: activated.length,
          voided: subset.filter((r) => r.status === 'cancelled').length,
          checkedIn: subset.filter((r) => Boolean(r.checked_in_at)).length,
          revenueUgx: activated.reduce((sum, r) => sum + Number(r.price_ugx || 0), 0),
        };
      };

      return {
        success: true,
        summary: {
          online: {
            ordinary: buildOnlineTier('ORDINARY'),
            vip: buildOnlineTier('VIP'),
          },
          hardcopy: {
            ordinary: buildHardcopyTier('ORDINARY'),
            vip: buildHardcopyTier('VIP'),
          },
        },
      };
    } catch {
      return { success: false, error: 'DATABASE_ERROR', message: 'Failed to compute inventory summary.' };
    }
  },

  /**
   * Gate-Scoped Recent Check-Ins (Minimal fields only — never exposes qr_token, email, phone, or order_ref)
   */
  async getRecentCheckInsGate(limit = 10): Promise<{
    success: boolean;
    checkIns: Array<{
      ticketNumber: string;
      category: 'VIP' | 'ORDINARY';
      channel: 'online' | 'hardcopy';
      guestLabel: string;
      checkedInAt: string;
    }>;
    error?: string;
  }> {
    const { client, configError } = getSupabaseClient();
    if (!client) {
      return { success: false, checkIns: [], error: configError || 'Database offline.' };
    }

    const bounded = Math.max(1, Math.min(30, Math.floor(Number(limit) || 10)));

    try {
      let rows: Array<{
        ticket_number: string;
        category: 'VIP' | 'ORDINARY';
        buyer_name: string | null;
        checked_in_at: string | null;
        ticket_channel?: string | null;
      }> | null = null;

      const primary = await client
        .from('tickets')
        .select('ticket_number, category, buyer_name, checked_in_at, ticket_channel')
        .not('checked_in_at', 'is', null)
        .order('checked_in_at', { ascending: false })
        .limit(bounded);

      if (primary.error && isMissingColumnError(primary.error, 'ticket_channel')) {
        const fallback = await client
          .from('tickets')
          .select('ticket_number, category, buyer_name, checked_in_at')
          .not('checked_in_at', 'is', null)
          .order('checked_in_at', { ascending: false })
          .limit(bounded);
        if (fallback.error) {
          return { success: false, checkIns: [], error: 'Unable to load recent check-ins.' };
        }
        rows = fallback.data as any;
      } else if (primary.error) {
        return { success: false, checkIns: [], error: 'Unable to load recent check-ins.' };
      } else {
        rows = primary.data as any;
      }

      const checkIns = (rows || [])
        .filter((r) => Boolean(r.checked_in_at))
        .map((r) => {
          const channel: 'online' | 'hardcopy' =
            r.ticket_channel === 'hardcopy' || inferTicketChannelFromNumber(r.ticket_number) === 'hardcopy'
              ? 'hardcopy'
              : 'online';
          return {
            ticketNumber: r.ticket_number,
            category: r.category,
            channel,
            guestLabel: (r.buyer_name && r.buyer_name.trim()) || (channel === 'hardcopy' ? 'Hardcopy Pass' : 'Guest'),
            checkedInAt: r.checked_in_at!,
          };
        });

      return { success: true, checkIns };
    } catch {
      return { success: false, checkIns: [], error: 'Failed to load recent check-ins.' };
    }
  },

  async confirmPaymentAdmin(ticketId: string): Promise<{
    success: boolean;
    httpStatus: number;
    error?: string;
    message: string;
  }> {
    const cleanId = String(ticketId || '').trim();
    if (!UUID_STRICT_REGEX.test(cleanId)) {
      return {
        success: false,
        httpStatus: 400,
        error: 'VALIDATION_ERROR',
        message: 'A valid ticket UUID is required.',
      };
    }

    const { client, configError } = getSupabaseClient();
    if (!client) {
      return {
        success: false,
        httpStatus: 503,
        error: 'SUPABASE_NOT_CONFIGURED',
        message: configError || 'Database offline.',
      };
    }

    try {
      const cols =
        'id, ticket_number, category, price_ugx, status, payment_status, order_ref, relworx_internal_ref, mtn_transaction_id, ticket_channel';
      const preMigrationCols =
        'id, ticket_number, category, price_ugx, status, payment_status, order_ref, relworx_internal_ref, mtn_transaction_id';

      let fetchRes = await client.from('tickets').select(cols).eq('id', cleanId).maybeSingle();
      if (fetchRes.error && isMissingColumnError(fetchRes.error, 'ticket_channel')) {
        fetchRes = await client.from('tickets').select(preMigrationCols).eq('id', cleanId).maybeSingle();
      }

      if (fetchRes.error) {
        return {
          success: false,
          httpStatus: 503,
          error: 'DATABASE_ERROR',
          message: 'Unable to fetch ticket record from database.',
        };
      }

      const ticket = fetchRes.data as Partial<TicketRow> | null;
      if (!ticket || !ticket.ticket_number) {
        return {
          success: false,
          httpStatus: 404,
          error: 'TICKET_NOT_FOUND',
          message: 'Ticket not found.',
        };
      }

      // 1. Block hardcopy tickets strictly — hardcopy activation MUST go through /api/admin/hardcopy/activate with mandatory audit logging
      if (!isOnlineTicketRow(ticket)) {
        return {
          success: false,
          httpStatus: 400,
          error: 'HARDCOPY_TICKET_FORBIDDEN',
          message: 'Hardcopy tickets cannot be confirmed via /api/admin/confirm-payment. Use hardcopy activation with audit logging.',
        };
      }

      if (ticket.status === 'issued' && (ticket.payment_status === 'paid' || ticket.payment_status === 'manual_paid')) {
        return {
          success: true,
          httpStatus: 200,
          message: 'Ticket is already confirmed and issued.',
        };
      }

      if (!ticket.order_ref) {
        return {
          success: false,
          httpStatus: 409,
          error: 'MISSING_PAYMENT_EVIDENCE',
          message: 'Cannot confirm payment: ticket has no associated order reference or verified payment evidence.',
        };
      }

      // 2. Require verified payment evidence from the linked order or live Relworx provider status check
      const orderInfo = await this.getOrderForPaymentVerification(ticket.order_ref);
      if (!orderInfo.found || !orderInfo.order) {
        return {
          success: false,
          httpStatus: 409,
          error: 'MISSING_PAYMENT_EVIDENCE',
          message: 'Cannot confirm payment: linked order record could not be verified.',
        };
      }

      const order = orderInfo.order;
      let paymentVerified = order.status === 'paid' || order.verification_status === 'verified';

      if (!paymentVerified && (order.gateway === 'relworx' || order.payment_method === 'relworx_mobile_money')) {
        if (!RelworxService.isConfigured()) {
          return {
            success: false,
            httpStatus: 409,
            error: 'MISSING_PAYMENT_EVIDENCE',
            message: 'Cannot confirm Relworx payment: provider verification is not configured.',
          };
        }
        const relCheck = await RelworxService.checkRequestStatus({
          internalReference: order.relworx_internal_ref || ticket.relworx_internal_ref || undefined,
          reference: order.order_ref,
        });
        const currencyOk = !relCheck.currency || String(relCheck.currency).toUpperCase() === 'UGX';
        const amountOk =
          relCheck.amount !== undefined &&
          relCheck.amount !== null &&
          Math.round(Number(relCheck.amount)) === Math.round(Number(order.total_amount_ugx));

        if (relCheck.success && relCheck.status === 'success' && currencyOk && amountOk) {
          paymentVerified = true;
        }
      }

      if (!paymentVerified) {
        return {
          success: false,
          httpStatus: 409,
          error: 'MISSING_PAYMENT_EVIDENCE',
          message:
            'Payment has not been verified yet. Verify the MTN transaction via /api/admin/mtn-verify or confirm Relworx settlement first.',
        };
      }

      const now = new Date().toISOString();
      let updateRes = await client
        .from('tickets')
        .update({
          status: 'issued',
          payment_status: 'paid',
          paid_at: now,
        })
        .eq('id', cleanId)
        .eq('ticket_channel', 'online')
        .select('id')
        .maybeSingle();

      if (updateRes.error && isMissingColumnError(updateRes.error, 'ticket_channel')) {
        updateRes = await client
          .from('tickets')
          .update({
            status: 'issued',
            payment_status: 'paid',
            paid_at: now,
          })
          .eq('id', cleanId)
          .select('id')
          .maybeSingle();
      }

      if (updateRes.error || !updateRes.data) {
        return {
          success: false,
          httpStatus: 503,
          error: 'DATABASE_ERROR',
          message: 'Failed to update ticket payment status.',
        };
      }

      if (order.status !== 'paid') {
        await client
          .from('orders')
          .update({ status: 'paid', paid_at: now })
          .eq('order_ref', order.order_ref);
      }

      return {
        success: true,
        httpStatus: 200,
        message: `Ticket ${ticket.ticket_number} payment confirmed and issued.`,
      };
    } catch {
      return {
        success: false,
        httpStatus: 500,
        error: 'SERVER_ERROR',
        message: 'Unexpected error confirming ticket payment.',
      };
    }
  },

  async releaseTicketAdmin(ticketId: string): Promise<{
    success: boolean;
    httpStatus: number;
    error?: string;
    message: string;
  }> {
    const cleanId = String(ticketId || '').trim();
    if (!UUID_STRICT_REGEX.test(cleanId)) {
      return {
        success: false,
        httpStatus: 400,
        error: 'VALIDATION_ERROR',
        message: 'A valid ticket UUID is required.',
      };
    }

    const { client, configError } = getSupabaseClient();
    if (!client) {
      return {
        success: false,
        httpStatus: 503,
        error: 'SUPABASE_NOT_CONFIGURED',
        message: configError || 'Database offline.',
      };
    }

    try {
      const cols = 'id, ticket_number, status, checked_in_at, ticket_channel';
      const preMigrationCols = 'id, ticket_number, status, checked_in_at';

      let fetchRes = await client.from('tickets').select(cols).eq('id', cleanId).maybeSingle();
      if (fetchRes.error && isMissingColumnError(fetchRes.error, 'ticket_channel')) {
        fetchRes = await client.from('tickets').select(preMigrationCols).eq('id', cleanId).maybeSingle();
      }

      if (fetchRes.error) {
        return {
          success: false,
          httpStatus: 503,
          error: 'DATABASE_ERROR',
          message: 'Unable to fetch ticket record from database.',
        };
      }

      const ticket = fetchRes.data as Partial<TicketRow> | null;
      if (!ticket || !ticket.ticket_number) {
        return {
          success: false,
          httpStatus: 404,
          error: 'TICKET_NOT_FOUND',
          message: 'Ticket not found.',
        };
      }

      // 1. Block hardcopy tickets strictly — hardcopy returns/voids MUST use /api/admin/hardcopy/status with audit logging
      if (!isOnlineTicketRow(ticket)) {
        return {
          success: false,
          httpStatus: 400,
          error: 'HARDCOPY_TICKET_FORBIDDEN',
          message: 'Hardcopy tickets cannot be released via /api/admin/release-ticket. Use hardcopy return/void controls.',
        };
      }

      // 2. Never release an admitted ticket or reset checked_in_at
      if (ticket.checked_in_at) {
        return {
          success: false,
          httpStatus: 409,
          error: 'ALREADY_CHECKED_IN',
          message: `Ticket ${ticket.ticket_number} has already been checked in at the gate and cannot be released or reset.`,
        };
      }

      // Notice: checked_in_at is NEVER touched in the update payload, and .is('checked_in_at', null) enforces atomic safety
      const resetPayload = {
        status: 'available',
        payment_status: 'unpaid',
        buyer_name: null,
        buyer_email: null,
        buyer_phone: null,
        order_ref: null,
        reserved_until: null,
        paid_at: null,
      };

      let updateRes = await client
        .from('tickets')
        .update(resetPayload)
        .eq('id', cleanId)
        .eq('ticket_channel', 'online')
        .is('checked_in_at', null)
        .select('id')
        .maybeSingle();

      if (updateRes.error && isMissingColumnError(updateRes.error, 'ticket_channel')) {
        updateRes = await client
          .from('tickets')
          .update(resetPayload)
          .eq('id', cleanId)
          .is('checked_in_at', null)
          .select('id')
          .maybeSingle();
      }

      if (updateRes.error) {
        return {
          success: false,
          httpStatus: 503,
          error: 'DATABASE_ERROR',
          message: 'Failed to release ticket.',
        };
      }

      if (!updateRes.data) {
        return {
          success: false,
          httpStatus: 409,
          error: 'ALREADY_CHECKED_IN',
          message: 'Ticket was concurrently checked in and cannot be released.',
        };
      }

      return {
        success: true,
        httpStatus: 200,
        message: `Ticket ${ticket.ticket_number} released back to online inventory.`,
      };
    } catch {
      return {
        success: false,
        httpStatus: 500,
        error: 'SERVER_ERROR',
        message: 'Unexpected error releasing ticket.',
      };
    }
  },
};
