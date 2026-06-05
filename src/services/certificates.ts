import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/lib/firebase";
import { challengeConfigs } from "@/lib/challengeConfig";
import type { Certificate, CertificateType } from "./types";

export const CERTIFICATE_TYPE_LABELS: Record<CertificateType, string> = {
  challenge_passed: "Challenge Passed Certificate",
  verification_passed: "Verification Passed Certificate",
  funded_trader: "Funded Trader Certificate",
  first_payout: "First Payout Certificate",
  milestone: "Milestone Certificate",
  consistency: "Consistency Certificate",
  top_trader: "Top Trader Certificate",
  scaling_plan: "Scaling Plan Certificate",
  profit_split: "Profit Split Certificate",
  account_completion: "Account Completion Certificate",
};

export const CERTIFICATE_TYPE_GROUP: Record<CertificateType, "Passed" | "Funded" | "Payouts" | "Milestones"> = {
  challenge_passed: "Passed",
  verification_passed: "Passed",
  funded_trader: "Funded",
  first_payout: "Payouts",
  profit_split: "Payouts",
  milestone: "Milestones",
  consistency: "Milestones",
  top_trader: "Milestones",
  scaling_plan: "Milestones",
  account_completion: "Milestones",
};

export function getCertificateTitle(type: CertificateType) {
  return CERTIFICATE_TYPE_LABELS[type] || "FYNX Funded Certificate";
}

export function getCertificateVerificationUrl(certificateId: string) {
  const root = typeof window !== "undefined" ? window.location.origin : "https://www.fynxfunded.com";
  const base = import.meta.env.BASE_URL || "/";
  return `${root}${base.replace(/\/$/, "")}/certificates/verify/${encodeURIComponent(certificateId)}`;
}

export function getChallengeRules(accountSize: number, phase: string) {
  const config = challengeConfigs.find((item) => item.accountSize === Number(accountSize));
  const normalizedPhase = String(phase || "2-phase").toLowerCase().includes("1")
    ? "1-phase"
    : String(phase || "2-phase").toLowerCase().includes("3")
      ? "3-phase"
      : "2-phase";
  return config?.phases[normalizedPhase] || null;
}

export async function getUserCertificates(userId: string): Promise<Certificate[]> {
  if (!isFirebaseConfigured || !db) return [];
  const certQuery = query(collection(db, "certificates"), where("userId", "==", userId));
  const snap = await getDocs(certQuery);
  return snap.docs
    .map((item) => ({ certificateId: item.id, ...item.data() } as Certificate))
    .sort((a, b) => toMillis(b.issuedAt) - toMillis(a.issuedAt));
}

export async function getCertificateByPublicId(certificateId: string): Promise<Certificate | null> {
  if (!isFirebaseConfigured || !db) return null;
  const exact = await getDoc(doc(db, "certificates", certificateId));
  if (exact.exists()) return { certificateId: exact.id, ...exact.data() } as Certificate;

  const certQuery = query(collection(db, "certificates"), where("publicVerificationId", "==", certificateId));
  const snap = await getDocs(certQuery);
  const first = snap.docs[0];
  return first ? ({ certificateId: first.id, ...first.data() } as Certificate) : null;
}

function toMillis(value: unknown) {
  if (!value) return 0;
  if (typeof value === "object" && value !== null && "toDate" in value) return (value as { toDate: () => Date }).toDate().getTime();
  return new Date(value as string).getTime() || 0;
}
