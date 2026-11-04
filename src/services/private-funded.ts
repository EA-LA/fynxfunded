import { httpsCallable } from "firebase/functions";
import { auth, functions } from "@/lib/firebase";
export interface PrivateAccess { authorized: true; ownerUID: string; expiresAt: number }
export async function checkPrivateFundedAccess(): Promise<PrivateAccess> {
  if (!functions || !auth?.currentUser) throw Error("Private owner sign-in is required.");
  const uid = auth.currentUser.uid;
  const response = await httpsCallable<Record<string, never>, PrivateAccess>(functions, "fundedPrivateAccess")({});
  const result = response.data;
  if (auth.currentUser?.uid !== uid || result.authorized !== true || result.ownerUID !== uid || !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now() || result.expiresAt > Date.now() + 301_000) throw Error("Private access could not be verified.");
  return result;
}
export async function joinFundedWaitlist(input: { email: string; name: string; consent: boolean }): Promise<void> {
  if (!functions) throw Error("Waitlist service is unavailable. Please contact support.");
  const response = await httpsCallable<typeof input & {source: string}, {status: string}>(functions, "joinFundedWaitlist")({ ...input, source: "web" });
  if (response.data.status !== "accepted") throw Error("Your submission was not confirmed. Please try again.");
}
