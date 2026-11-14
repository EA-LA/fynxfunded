import { describe, expect, it } from "vitest";
import { configuredOwnerUIDs, FUNDED_OWNER_EMAILS, privateOwnerAllowed, type PrivateUser } from "../src/privateFundedPolicy";

const now = Math.floor(Date.now() / 1000);
const user = (uid: string, email: string, changes: Partial<PrivateUser> = {}): PrivateUser => ({
  uid, email, emailVerified: true, disabled: false, customClaims: { fundedOwner: true },
  tokensValidAfterTime: new Date(Date.now() - 60_000).toUTCString(), providerData: [{ providerId: "password" }], ...changes,
});
const identity = (uid: string, email: string, token: Record<string, unknown> = {}) => ({
  uid, token: { email, email_verified: true, fundedOwner: true, auth_time: now, firebase: { sign_in_provider: "password" }, ...token },
});
const config = { enabled: true, ownerUID: "team", ownerUIDs: ["elham"] };

describe("private Funded owners", () => {
  it("lists both owner emails", () => {
    expect(FUNDED_OWNER_EMAILS).toEqual(["fynxteam5@gmail.com", "ha6876122@gmail.com"]);
  });

  it("reads the pinned UIDs and ignores bad values", () => {
    expect(configuredOwnerUIDs(config)).toEqual(["team", "elham"]);
    expect(configuredOwnerUIDs({ enabled: true, ownerUID: "team" })).toEqual(["team"]);
    expect(configuredOwnerUIDs({ enabled: true, ownerUIDs: ["", " x", 5, "ok"] })).toEqual(["ok"]);
    expect(configuredOwnerUIDs({ enabled: true, ownerUIDs: ["a", "b", "c", "d", "e", "f"] })).toEqual([]);
    expect(configuredOwnerUIDs({ enabled: false, ownerUID: "team", ownerUIDs: ["elham"] })).toEqual([]);
    expect(configuredOwnerUIDs(undefined)).toEqual([]);
  });

  it("accepts each owner account with its pinned UID and claim", () => {
    expect(privateOwnerAllowed(identity("team", "fynxteam5@gmail.com"), config, user("team", "fynxteam5@gmail.com"))).toBe(true);
    expect(privateOwnerAllowed(identity("elham", "ha6876122@gmail.com"), config, user("elham", "ha6876122@gmail.com"))).toBe(true);
    expect(privateOwnerAllowed(identity("elham", "HA6876122@gmail.com"), config, user("elham", "ha6876122@gmail.com"))).toBe(true);
  });

  it("still needs the UID to be pinned by the operator", () => {
    expect(privateOwnerAllowed(identity("elham", "ha6876122@gmail.com"), { enabled: true, ownerUID: "team" }, user("elham", "ha6876122@gmail.com"))).toBe(false);
  });

  it("still needs the operator-set claim, a password session and a verified, active account", () => {
    const e = "ha6876122@gmail.com";
    expect(privateOwnerAllowed(identity("elham", e), config, user("elham", e, { customClaims: {} }))).toBe(false);
    expect(privateOwnerAllowed(identity("elham", e, { fundedOwner: undefined }), config, user("elham", e))).toBe(false);
    expect(privateOwnerAllowed(identity("elham", e, { firebase: { sign_in_provider: "google.com" } }), config, user("elham", e))).toBe(false);
    expect(privateOwnerAllowed(identity("elham", e), config, user("elham", e, { disabled: true }))).toBe(false);
    expect(privateOwnerAllowed(identity("elham", e), config, user("elham", e, { emailVerified: false }))).toBe(false);
  });

  it("rejects other emails even with a pinned UID and claim, and mismatched token emails", () => {
    expect(privateOwnerAllowed(identity("elham", "someone@example.com"), config, user("elham", "someone@example.com"))).toBe(false);
    expect(privateOwnerAllowed(identity("elham", "fynxteam5@gmail.com"), config, user("elham", "ha6876122@gmail.com"))).toBe(false);
    expect(privateOwnerAllowed(identity("team", "fynxteam5@gmail.com"), config, user("elham", "fynxteam5@gmail.com"))).toBe(false);
  });
});
