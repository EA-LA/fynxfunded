import { httpsCallable } from "firebase/functions";
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { db, functions, isFirebaseConfigured } from "@/lib/firebase";

export type KycStatus = "not_started" | "pending" | "verified" | "rejected";
export type KycProvider = "stripe_identity" | "sumsub" | "persona" | "veriff" | "onfido";

export type KycDocumentType = "passport" | "drivers_license" | "national_id";

export interface KycProfileInput {
  legalFullName: string;
  dateOfBirth: string;
  countryOfResidence: string;
  address: string;
  documentType: KycDocumentType;
}

export interface KycRecord extends KycProfileInput {
  userId: string;
  email?: string;
  kycStatus: KycStatus;
  kycProvider: KycProvider;
  kycSessionId?: string;
  kycSubmittedAt?: string;
  kycVerifiedAt?: string;
  kycRejectionReason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface KycSessionResult {
  sessionId: string;
  provider: KycProvider;
  redirectUrl?: string;
  clientSecret?: string;
}

interface KycProviderAdapter {
  provider: KycProvider;
  createSession(input: KycProfileInput & { userId: string; email?: string }): Promise<KycSessionResult>;
}

class StripeIdentityAdapter implements KycProviderAdapter {
  provider: KycProvider = "stripe_identity";

  async createSession(input: KycProfileInput & { userId: string; email?: string }): Promise<KycSessionResult> {
    if (!isFirebaseConfigured || !functions) {
      throw new Error("Firebase Functions must be configured before starting identity verification.");
    }

    const createSession = httpsCallable(functions, "createKycSession");
    const result = await createSession({ provider: this.provider, ...input });
    const data = result.data as Partial<KycSessionResult>;

    if (!data.sessionId) {
      throw new Error("KYC provider did not return a verification session.");
    }

    return {
      sessionId: data.sessionId,
      provider: (data.provider as KycProvider) || this.provider,
      redirectUrl: data.redirectUrl,
      clientSecret: data.clientSecret,
    };
  }
}

class UnsupportedProviderAdapter implements KycProviderAdapter {
  constructor(public provider: KycProvider) {}

  async createSession(): Promise<KycSessionResult> {
    throw new Error(`${this.provider} KYC adapter is not enabled yet.`);
  }
}

const providers: Record<KycProvider, KycProviderAdapter> = {
  stripe_identity: new StripeIdentityAdapter(),
  sumsub: new UnsupportedProviderAdapter("sumsub"),
  persona: new UnsupportedProviderAdapter("persona"),
  veriff: new UnsupportedProviderAdapter("veriff"),
  onfido: new UnsupportedProviderAdapter("onfido"),
};

const DEFAULT_PROVIDER: KycProvider = "stripe_identity";

export async function submitKycProfile(userId: string, email: string | undefined, payload: KycProfileInput) {
  const adapter = providers[DEFAULT_PROVIDER];
  return adapter.createSession({ userId, email, ...payload });
}

export function watchCurrentUserKyc(userId: string, cb: (kyc: Partial<KycRecord>) => void): Unsubscribe {
  if (!db) return () => undefined;
  return onSnapshot(doc(db, "users", userId), (snap) => cb((snap.data() || {}) as Partial<KycRecord>));
}

export async function getAllKycProfiles(status?: KycStatus) {
  if (!db) return [] as KycRecord[];
  const base = collection(db, "kyc_profiles");
  const q = status
    ? query(base, where("kycStatus", "==", status), orderBy("kycSubmittedAt", "desc"), limit(500))
    : query(base, orderBy("kycSubmittedAt", "desc"), limit(500));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ ...(d.data() as KycRecord), userId: d.id }));
}
