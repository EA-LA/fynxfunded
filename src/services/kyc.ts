import { httpsCallable } from "firebase/functions";
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where, type Unsubscribe } from "firebase/firestore";
import { db, functions, isFirebaseConfigured } from "@/lib/firebase";

export type KycStatus = "not_started" | "pending" | "verified" | "rejected";
export type KycProvider = "stripe_identity" | "sumsub" | "persona" | "veriff" | "onfido";

export interface KycProfileInput {
  legalFullName: string;
  dateOfBirth: string;
  countryOfResidence: string;
  address: string;
  documentType: "passport" | "drivers_license" | "national_id";
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

const DEFAULT_PROVIDER: KycProvider = "stripe_identity";

export async function submitKycProfile(userId: string, email: string | undefined, payload: KycProfileInput) {
  if (!db) throw new Error("Firestore not configured");
  const kycRef = doc(db, "kyc_profiles", userId);
  const nowIso = new Date().toISOString();

  await setDoc(kycRef, {
    ...payload,
    userId,
    email: email || "",
    kycStatus: "pending",
    kycProvider: DEFAULT_PROVIDER,
    kycSubmittedAt: nowIso,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  }, { merge: true });

  let kycSessionId = `local_${Date.now()}`;

  if (isFirebaseConfigured && functions) {
    try {
      const createSession = httpsCallable(functions, "createKycSession");
      const result = await createSession({ userId, provider: DEFAULT_PROVIDER, ...payload }) as any;
      if (result?.data?.sessionId) {
        kycSessionId = result.data.sessionId;
      }
    } catch (error) {
      console.error("[KYC] createKycSession failed, falling back to placeholder", error);
    }
  }

  await updateDoc(doc(db, "users", userId), {
    kycStatus: "pending",
    kycProvider: DEFAULT_PROVIDER,
    kycSessionId,
    kycSubmittedAt: nowIso,
    kycVerifiedAt: null,
    kycRejectionReason: null,
    updatedAt: serverTimestamp(),
  });

  await setDoc(kycRef, { kycSessionId }, { merge: true });
  return { kycSessionId };
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
