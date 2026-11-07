import * as admin from "firebase-admin";
import { CallableRequest, HttpsError } from "firebase-functions/v2/https";
import { configuredOwnerUIDs, privateOwnerAllowed } from "./privateFundedPolicy";

/** Background fulfillment has no client session; resolve the pinned identity and current trusted role. */
export async function isPrivateFundedUser(uid: string): Promise<boolean> {
  if (!uid) return false;
  const configuration = await admin.firestore().doc("funded_private_access/current").get();
  const config = configuration.data();
  if (!configuredOwnerUIDs(config).includes(uid)) return false;
  let user;
  try { user = await admin.auth().getUser(uid); }
  catch (error) { if ((error as { code?: string }).code === "auth/user-not-found") return false; throw error; }
  return privateOwnerAllowed({ uid, token: { email: user.email, email_verified: user.emailVerified, fundedOwner: user.customClaims?.fundedOwner, auth_time: Date.now() / 1000, firebase: { sign_in_provider: "password" } } }, config, user);
}

/** Fail closed. The config document and claim are provisioned by a trusted operator, never a client. */
export async function requirePrivateFundedOwner(request: Pick<CallableRequest, "auth">): Promise<string> {
  if (!request.auth) throw new HttpsError("unauthenticated", "Private owner sign-in is required.");
  const [configuration, user] = await Promise.all([
    admin.firestore().doc("funded_private_access/current").get(),
    admin.auth().getUser(request.auth.uid),
  ]);
  if (!privateOwnerAllowed(request.auth, configuration.data(), user)) throw new HttpsError("permission-denied", "FYNX Funded is currently restricted to authorized private testing.");
  return request.auth.uid;
}
