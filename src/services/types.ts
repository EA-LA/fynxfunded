// ═══════════════════════════════════════════════════════════
// SHARED DATA TYPES — used across all services
// ═══════════════════════════════════════════════════════════

// ── User ──────────────────────────────────────────────────
export interface User {
  userId: string;
  email: string;
  fullName: string;
  nickname: string;
  country: string;
  createdAt: string;
  emailVerified: boolean;
  kycStatus: KycStatus;
  kycProvider?: string;
  kycSessionId?: string;
  kycSubmittedAt?: string;
  kycVerifiedAt?: string;
  kycRejectionReason?: string;
  twoFactorEnabled?: boolean;
  loginAlertsEnabled?: boolean;
  backupCodesGeneratedAt?: string;
  activeSessions?: number;
  lastSecurityUpdate?: string;
  provider: "email" | "google" | "apple" | "oauth";
}

export type KycStatus = "not_started" | "pending" | "verified" | "rejected";

// ── Orders ────────────────────────────────────────────────
export interface Order {
  orderId: string;
  userId: string;
  challengeId: string;
  amount: number;
  currency: string;
  paymentMethod: PaymentMethodType;
  status: OrderStatus;
  createdAt: string;
  paidAt?: string;
  challenge: string;
  accountSize: number;
  phase: string;
  style: string;
}

export type OrderStatus = "pending" | "paid" | "failed" | "refunded";
export type PaymentMethodType = "card" | "paypal" | "apple" | "crypto";

// ── Challenges ────────────────────────────────────────────
export interface Challenge {
  challengeId: string;
  userId: string;
  orderId: string;
  name: string;
  phase: string;
  accountSize: number;
  style: string;
  status: ChallengeStatus;
  startDate: string;
  endDate?: string;
  brokerAccountId?: string | null;
  currency?: string;
}

export type ChallengeStatus = "active" | "passed" | "failed" | "funded" | "expired";

// ── Accounts / Credentials ────────────────────────────────
export interface TradingAccount {
  accountId: string;
  userId: string;
  challengeId: string;
  platform: string;
  server: string;
  login: string;
  password: string;
  balance: number;
  equity: number;
  status: "active" | "suspended" | "closed";
}

// ── Rules / Audit ─────────────────────────────────────────
export interface RuleEvaluation {
  accountId: string;
  timestamp: string;
  rule: string;
  result: "pass" | "fail" | "warning";
  value: number;
  threshold: number;
  details: string;
}

export interface AuditLog {
  id: string;
  accountId: string;
  action: string;
  result: string;
  timestamp: string;
  details: Record<string, unknown>;
}

// ── Tickets ───────────────────────────────────────────────
export interface Ticket {
  ticketId: string;
  userId: string;
  subject: string;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  messages: TicketMessage[];
}

export type TicketStatus = "open" | "waiting" | "closed";
export type TicketPriority = "low" | "medium" | "high" | "urgent";

export interface TicketMessage {
  id: string;
  sender: "user" | "admin";
  content: string;
  timestamp: string;
}

// ── Payouts ───────────────────────────────────────────────
export interface PayoutRequest {
  payoutId: string;
  userId: string;
  accountId: string;
  amount: number;
  method: string;
  status: PayoutStatus;
  requestedAt: string;
  processedAt?: string;
  blockedReason?: string;
  blockedBy?: string;
  blockedAt?: string;
}

export type PayoutStatus = "requested" | "approved" | "paid" | "denied" | "blocked";


// ── Certificates ─────────────────────────────────────────
export type CertificateType =
  | "challenge_passed"
  | "verification_passed"
  | "funded_trader"
  | "first_payout"
  | "milestone"
  | "consistency"
  | "top_trader"
  | "scaling_plan"
  | "profit_split"
  | "account_completion";

export type CertificateStatus = "issued" | "pending_approval" | "approved" | "revoked";

export interface CertificateRulesSnapshot {
  profitTargets: string[];
  dailyLoss: string;
  maxLoss: string;
  minDays: number;
  profitSplit: string;
}

export interface Certificate {
  certificateId: string;
  publicVerificationId: string;
  type: CertificateType;
  status: CertificateStatus;
  userId: string;
  traderName: string;
  accountId: string;
  challengeId?: string;
  orderId?: string;
  payoutId?: string;
  challengeType: string;
  accountSize: number;
  phase: string;
  passedDate?: string;
  fundedDate?: string;
  issuedAt: string;
  approvedAt?: string;
  revokedAt?: string;
  revokedReason?: string;
  regeneratedAt?: string;
  profitSplit?: string;
  payoutAmount?: number;
  milestoneName?: string;
  rulesSnapshot?: CertificateRulesSnapshot;
  verificationUrl: string;
  generatedFrom?: {
    challengeStatus?: string;
    accountStatus?: string;
    payoutStatus?: string;
    source: "backend_trigger" | "admin_regeneration" | "local_readonly_preview";
  };
}

// ── Async state wrapper ───────────────────────────────────
export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}
