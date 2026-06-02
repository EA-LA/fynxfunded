import { useState, useEffect, type ElementType, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Shield, ShieldCheck, ShieldAlert, Mail, Smartphone, Monitor, Key, CheckCircle2, AlertTriangle, Globe2, Trash2, LogOut, Copy, Download, X } from "lucide-react";
import { countries } from "@/lib/countries";
import { useAuth } from "@/contexts/AuthContext";
import { getUserSessions, revokeSession, revokeAllSessions, type LoginSession } from "@/services/session-tracker";
import { watchCurrentUserKyc, type KycStatus } from "@/services/kyc";
import { doc, updateDoc } from "firebase/firestore";
import { db as firebaseDb } from "@/lib/firebase";
import { toast } from "@/hooks/use-toast";
import { createTwoFactorSetup, disableTwoFactor, enableTwoFactor, generateRecoveryCodes, setLoginAlertsEnabled, watchSecuritySettings, type TwoFactorSetup } from "@/services/security";

export default function DashboardSettings() {
  const { user, updatePassword, sendEmailVerification, refreshUser } = useAuth();

  // Profile from auth context (read-only)
  const fullName = user?.fullName || "";
  const email = user?.email || "";

  // Nickname: editable only if not yet set
  const [nickname, setNickname] = useState(() => user?.nickname || "");
  const [nicknameLocked, setNicknameLocked] = useState(() => !!(user?.nickname));
  const [country, setCountry] = useState(() => user?.country || localStorage.getItem("fynx_user_country") || "");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMessage, setPwMessage] = useState("");
  const [pwError, setPwError] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [liveKycStatus, setLiveKycStatus] = useState<KycStatus | null>(null);

  // Security controls
  const [twoFA, setTwoFA] = useState(false);
  const [loginAlerts, setLoginAlerts] = useState(false);
  const [backupCodesGeneratedAt, setBackupCodesGeneratedAt] = useState("");
  const [securityLoading, setSecurityLoading] = useState<Record<string, boolean>>({});
  const [twoFactorSetup, setTwoFactorSetup] = useState<TwoFactorSetup | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [passwordPrompt, setPasswordPrompt] = useState<null | "disable2fa" | "regenCodes">(null);
  const [securityPassword, setSecurityPassword] = useState("");
  const [showSessions, setShowSessions] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  // Email verification
  const emailVerified = user?.emailVerified ?? false;
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState("");

  // Session management
  const [sessions, setSessions] = useState<LoginSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // KYC status
  const kycStatus = liveKycStatus || user?.kycStatus || "not_started";
  const isVerified = kycStatus === "verified";
  const isPending = kycStatus === "pending";
  const isRejected = kycStatus === "rejected";


  useEffect(() => {
    if (!user?.userId) return;
    return watchCurrentUserKyc(user.userId, (kyc) => {
      if (kyc.kycStatus) setLiveKycStatus(kyc.kycStatus);
    });
  }, [user?.userId]);

  // Sync nickname/country from user context
  useEffect(() => {
    if (user?.nickname) {
      setNickname(user.nickname);
      setNicknameLocked(true);
    }
    if (user?.country) {
      setCountry(user.country);
    }
  }, [user?.nickname, user?.country]);

  useEffect(() => {
    if (!user?.userId) return;
    return watchSecuritySettings(user.userId, (settings) => {
      setTwoFA(settings.twoFactorEnabled);
      setLoginAlerts(settings.loginAlertsEnabled);
      setBackupCodesGeneratedAt(settings.backupCodesGeneratedAt);
    });
  }, [user?.userId]);

  const refreshSessions = async () => {
    if (!user?.userId) return;
    setSessionsLoading(true);
    try {
      setSessions(await getUserSessions(user.userId));
    } catch (err: any) {
      toast({ title: "Could not load sessions", description: err?.message || "Try again in a moment.", variant: "destructive" });
    } finally {
      setSessionsLoading(false);
    }
  };

  useEffect(() => {
    if (showSessions) refreshSessions();
  }, [showSessions, user?.userId]);

  const handleResendVerification = async () => {
    setVerifyLoading(true);
    setVerifyMessage("");
    try {
      await sendEmailVerification();
      setVerifyMessage("Verification email sent. Check your inbox.");
    } catch (err: any) {
      setVerifyMessage(err?.message || "Failed to send verification email.");
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleRefreshVerification = async () => {
    try {
      await refreshUser();
    } catch {
      // silently
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    if (!user?.userId) return;
    try {
      await revokeSession(user.userId, sessionId);
      await refreshSessions();
      toast({ title: "Session logged out", description: "That device no longer has an active dashboard session." });
    } catch (err: any) {
      toast({ title: "Could not log out device", description: err?.message || "Please try again.", variant: "destructive" });
    }
  };

  const handleRevokeAll = async () => {
    if (!user?.userId) return;
    try {
      await revokeAllSessions(user.userId);
      await refreshSessions();
      toast({ title: "Other devices logged out", description: "Only this browser session remains active." });
    } catch (err: any) {
      toast({ title: "Could not log out sessions", description: err?.message || "Please try again.", variant: "destructive" });
    }
  };

  const setToggleLoading = (key: string, value: boolean) => {
    setSecurityLoading((prev) => ({ ...prev, [key]: value }));
  };

  const handleTwoFactorToggle = async () => {
    if (!user?.userId) return;
    if (twoFA) {
      setPasswordPrompt("disable2fa");
      return;
    }
    setTwoFactorSetup(createTwoFactorSetup(user.email));
    setTwoFactorCode("");
  };

  const handleConfirmTwoFactor = async () => {
    if (!user?.userId || !twoFactorSetup) return;
    setToggleLoading("2fa", true);
    try {
      await enableTwoFactor(user.userId, twoFactorSetup.secret, twoFactorCode);
      setTwoFactorSetup(null);
      setTwoFactorCode("");
      toast({ title: "2FA enabled", description: "Authenticator verification is now required when you log in." });
    } catch (err: any) {
      toast({ title: "Could not enable 2FA", description: err?.message || "Check the code and try again.", variant: "destructive" });
    } finally {
      setToggleLoading("2fa", false);
    }
  };

  const handlePasswordConfirmedAction = async () => {
    if (!user?.userId || !passwordPrompt) return;
    const action = passwordPrompt;
    setToggleLoading(action, true);
    try {
      if (action === "disable2fa") {
        await disableTwoFactor(user.userId, securityPassword);
        toast({ title: "2FA disabled", description: "Authenticator verification has been turned off." });
      } else {
        const codes = await generateRecoveryCodes(user.userId, securityPassword);
        setRecoveryCodes(codes);
        toast({ title: "Recovery codes regenerated", description: "Save these codes now. They will only be shown once." });
      }
      setPasswordPrompt(null);
      setSecurityPassword("");
    } catch (err: any) {
      toast({ title: "Password confirmation failed", description: err?.message || "Please verify your password and try again.", variant: "destructive" });
    } finally {
      setToggleLoading(action, false);
    }
  };

  const handleLoginAlertsToggle = async () => {
    if (!user?.userId) return;
    const next = !loginAlerts;
    setLoginAlerts(next);
    setToggleLoading("alerts", true);
    try {
      await setLoginAlertsEnabled(user.userId, next);
      toast({ title: next ? "Login alerts enabled" : "Login alerts disabled", description: next ? "We will email you after new sign-ins." : "New-login email alerts are turned off." });
    } catch (err: any) {
      setLoginAlerts(!next);
      toast({ title: "Could not update login alerts", description: err?.message || "Please try again.", variant: "destructive" });
    } finally {
      setToggleLoading("alerts", false);
    }
  };

  const handleRecoveryCodes = async () => {
    if (!user?.userId) return;
    if (backupCodesGeneratedAt) {
      setPasswordPrompt("regenCodes");
      return;
    }
    setToggleLoading("codes", true);
    try {
      const codes = await generateRecoveryCodes(user.userId);
      setRecoveryCodes(codes);
      toast({ title: "Recovery codes generated", description: "Save these codes now. They will only be shown once." });
    } catch (err: any) {
      toast({ title: "Could not generate codes", description: err?.message || "Please try again.", variant: "destructive" });
    } finally {
      setToggleLoading("codes", false);
    }
  };

  const copyRecoveryCodes = async () => {
    await navigator.clipboard.writeText(recoveryCodes.join("\n"));
    toast({ title: "Recovery codes copied", description: "Store them somewhere safe." });
  };

  const downloadRecoveryCodes = () => {
    const blob = new Blob([recoveryCodes.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fynx-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveProfile = async () => {
    setProfileMessage("");
    if (!user?.userId) return;

    // Save nickname to Firestore (set-once rule)
    if (nickname.trim() && !nicknameLocked && firebaseDb) {
      try {
        const userRef = doc(firebaseDb, "users", user.userId);
        await updateDoc(userRef, {
          nickname: nickname.trim(),
          country: country,
        });
        setNicknameLocked(true);
        setProfileMessage("Profile saved successfully.");
      } catch (err: any) {
        setProfileMessage(err?.message || "Failed to save profile.");
        return;
      }
    } else if (firebaseDb) {
      // Just save country
      try {
        const userRef = doc(firebaseDb, "users", user.userId);
        await updateDoc(userRef, { country });
        setProfileMessage("Profile saved successfully.");
      } catch (err: any) {
        setProfileMessage(err?.message || "Failed to save profile.");
        return;
      }
    }

    localStorage.setItem("fynx_user_country", country);
  };

  const Toggle = ({ enabled, onToggle, loading = false }: { enabled: boolean; onToggle: () => void; loading?: boolean }) => (
    <button
      type="button"
      onClick={onToggle}
      disabled={loading}
      aria-pressed={enabled}
      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 disabled:opacity-60 ${enabled ? "bg-foreground" : "bg-secondary"}`}
    >
      <div
        className={`w-5 h-5 rounded-full bg-background absolute top-0.5 transition-all grid place-items-center ${loading ? "animate-pulse" : ""}`}
        style={{ left: enabled ? "calc(100% - 22px)" : "2px" }}
      />
    </button>
  );

  const SecurityRow = ({
    icon: Icon,
    title,
    description,
    enabled,
    onToggle,
    badge,
    loading,
    actionLabel,
  }: {
    icon: ElementType;
    title: string;
    description: string;
    enabled: boolean;
    onToggle: () => void;
    badge?: ReactNode;
    loading?: boolean;
    actionLabel?: string;
  }) => (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex items-start gap-3">
        <Icon size={16} className="text-muted-foreground mt-0.5 shrink-0" />
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{title}</p>
            {badge}
          </div>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {actionLabel && <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground hidden sm:inline">{actionLabel}</span>}
        <Toggle enabled={enabled} onToggle={onToggle} loading={loading} />
      </div>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your account preferences.</p>
      </div>

      {/* Identity Verification (KYC) Status */}
      <div className={`premium-card border ${isVerified ? "border-foreground/20" : "border-border"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isVerified ? (
              <div className="w-10 h-10 rounded-full bg-foreground/10 flex items-center justify-center">
                <ShieldCheck size={20} className="text-foreground" />
              </div>
            ) : (
              <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
                <ShieldAlert size={20} className="text-muted-foreground" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Identity Verification</h3>
                {isVerified ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-foreground/10 text-foreground px-2 py-0.5 rounded-full">
                    <CheckCircle2 size={10} /> Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-secondary text-muted-foreground px-2 py-0.5 rounded-full">
                    <AlertTriangle size={10} /> Not Verified
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isVerified
                  ? "Your identity has been verified. You are eligible for payouts."
                  : "Verification is required before payout. Complete KYC to become eligible."}
              </p>
            </div>
          </div>
          {isVerified ? (
            <span className="inline-flex items-center gap-2 bg-emerald-500/15 text-emerald-400 px-3 py-2 rounded-md text-xs font-medium">Verified Account</span>
          ) : (
            <Link to="/verification" className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-xs font-medium hover:bg-primary/90 transition-colors shrink-0">
              {isPending ? "Verification Pending" : isRejected ? "Verification Failed — Retry" : "Start Verification"}
            </Link>
          )}
        </div>
      </div>

      {/* Profile */}
      <div className="premium-card">
        <h3 className="text-sm font-semibold mb-4">Profile Information</h3>
        {profileMessage && <p className="text-xs text-muted-foreground mb-3">{profileMessage}</p>}
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Full Name</label>
            <input type="text" value={fullName} disabled className="w-full bg-secondary/50 border border-border rounded-md px-3 py-2.5 text-sm text-muted-foreground cursor-not-allowed" />
            <p className="text-[10px] text-muted-foreground mt-1">Name cannot be changed after registration.</p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Email</label>
            <input type="email" value={email} disabled className="w-full bg-secondary/50 border border-border rounded-md px-3 py-2.5 text-sm text-muted-foreground cursor-not-allowed" />
            <p className="text-[10px] text-muted-foreground mt-1">Contact support to change email.</p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Display Name (Username)</label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Choose a username"
              disabled={nicknameLocked}
              className={`w-full border border-border rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/30 ${nicknameLocked ? "bg-secondary/50 text-muted-foreground cursor-not-allowed" : "bg-background"}`}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              {nicknameLocked ? "Username cannot be changed once set." : "Choose carefully — this cannot be changed later."}
            </p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5 flex items-center gap-1">
              <Globe2 size={12} /> Country of Trading
            </label>
            <select value={country} onChange={(e) => setCountry(e.target.value)} className="w-full bg-background border border-border rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/30 appearance-none">
              <option value="">Select country...</option>
              {countries.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
            <p className="text-[10px] text-muted-foreground mt-1">Your country of trading residence.</p>
          </div>
        </div>
        <button onClick={handleSaveProfile} className="mt-4 bg-primary text-primary-foreground px-6 py-2.5 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors">
          Save Changes
        </button>
      </div>

      {/* Security Options */}
      <div className="premium-card">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold">Security</h3>
        </div>
        <div className="divide-y divide-border">
          {/* Email Verification */}
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex items-start gap-3">
              <Mail size={16} className="text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">Email Verification</p>
                  {emailVerified ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-foreground/10 text-foreground px-2 py-0.5 rounded-full">
                      <CheckCircle2 size={10} /> Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-secondary text-muted-foreground px-2 py-0.5 rounded-full">
                      <AlertTriangle size={10} /> Not Verified
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {emailVerified ? "Your email address is verified." : "Verify your email to unlock payouts."}
                </p>
                {verifyMessage && <p className="text-xs text-muted-foreground mt-1">{verifyMessage}</p>}
              </div>
            </div>
            {!emailVerified && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleResendVerification}
                  disabled={verifyLoading}
                  className="text-xs font-medium border border-border px-3 py-1.5 rounded-md hover:bg-secondary transition-colors disabled:opacity-50"
                >
                  {verifyLoading ? "Sending..." : "Resend"}
                </button>
                <button
                  onClick={handleRefreshVerification}
                  className="text-xs font-medium border border-border px-3 py-1.5 rounded-md hover:bg-secondary transition-colors"
                >
                  Refresh
                </button>
              </div>
            )}
          </div>

          <SecurityRow icon={Smartphone} title="Two-Factor Authentication (2FA)" description="Use an authenticator app for additional login security." enabled={twoFA} onToggle={handleTwoFactorToggle} loading={securityLoading["2fa"] || securityLoading.disable2fa} badge={twoFA ? <span className="text-[10px] font-medium bg-foreground/10 text-foreground px-2 py-0.5 rounded-full">Active</span> : undefined} />
          <SecurityRow icon={Mail} title="Login Alerts" description="Receive email notifications with browser, device, IP/location, and time after new sign-ins." enabled={loginAlerts} onToggle={handleLoginAlertsToggle} loading={securityLoading.alerts} />
          <SecurityRow icon={Monitor} title="Device & Session Management" description="Open active sessions, review devices, and log out sessions." enabled={showSessions} onToggle={() => setShowSessions((value) => !value)} actionLabel="Open" />
          <SecurityRow icon={Key} title="Backup Recovery Codes" description={backupCodesGeneratedAt ? `Generated ${new Date(backupCodesGeneratedAt).toLocaleString()}. Regenerate after password confirmation.` : "Generate one-time account recovery codes."} enabled={!!backupCodesGeneratedAt} onToggle={handleRecoveryCodes} loading={securityLoading.codes || securityLoading.regenCodes} actionLabel={backupCodesGeneratedAt ? "Regenerate" : "Generate"} />
        </div>
      </div>

      {/* Session Management Panel */}
      {showSessions && (
        <div className="premium-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">Active Sessions</h3>
            {sessions.length > 1 && (
              <button onClick={handleRevokeAll} className="text-xs font-medium text-destructive hover:underline flex items-center gap-1">
                <LogOut size={12} /> Log out all other devices
              </button>
            )}
          </div>
          {sessionsLoading ? (
            <p className="text-sm text-muted-foreground">Loading sessions...</p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sessions recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between bg-secondary/40 rounded-lg p-3">
                  <div className="flex items-start gap-3">
                    <Monitor size={16} className="text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{s.browser} · {s.device}</p>
                        {s.isCurrent && (
                          <span className="text-[10px] font-medium bg-foreground/10 text-foreground px-2 py-0.5 rounded-full">Current</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {s.location ? `${s.location} · ` : ""}IP: {s.ip} · Last active: {new Date(s.lastActive).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  {!s.isCurrent && (
                    <button
                      onClick={() => s.id && handleRevokeSession(s.id)}
                      className="text-xs text-muted-foreground hover:text-destructive transition-colors inline-flex items-center gap-1"
                      title="Log out this device"
                    >
                      <Trash2 size={14} /> Log out this device
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}


      {twoFactorSetup && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="premium-card w-full max-w-md border border-border shadow-2xl">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-sm font-semibold">Set up two-factor authentication</h3>
                <p className="text-xs text-muted-foreground mt-1">Scan the QR code with Google Authenticator, 1Password, Authy, or any TOTP app.</p>
              </div>
              <button onClick={() => setTwoFactorSetup(null)} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
            </div>
            <div className="grid place-items-center bg-white rounded-xl p-4 mb-4">
              <img src={twoFactorSetup.qrCodeUrl} alt="Authenticator QR code" className="w-52 h-52" />
            </div>
            <div className="bg-secondary/50 rounded-lg p-3 mb-4">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1">Secret key</p>
              <p className="font-mono text-sm break-all">{twoFactorSetup.secret}</p>
            </div>
            <label className="text-xs text-muted-foreground block mb-1.5">Enter 6-digit code</label>
            <input value={twoFactorCode} onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" maxLength={6} className="w-full bg-background border border-border rounded-md px-3 py-2.5 text-sm tracking-[0.35em] text-center focus:outline-none focus:ring-1 focus:ring-foreground/30" placeholder="000000" />
            <button disabled={securityLoading["2fa"] || twoFactorCode.length !== 6} onClick={handleConfirmTwoFactor} className="mt-4 w-full bg-primary text-primary-foreground px-4 py-2.5 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
              {securityLoading["2fa"] ? "Verifying..." : "Verify & Enable 2FA"}
            </button>
          </div>
        </div>
      )}

      {passwordPrompt && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="premium-card w-full max-w-sm border border-border shadow-2xl">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-sm font-semibold">Confirm your password</h3>
                <p className="text-xs text-muted-foreground mt-1">Required before {passwordPrompt === "disable2fa" ? "turning off 2FA" : "regenerating recovery codes"}.</p>
              </div>
              <button onClick={() => setPasswordPrompt(null)} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
            </div>
            <input type="password" value={securityPassword} onChange={(e) => setSecurityPassword(e.target.value)} className="w-full bg-background border border-border rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/30" placeholder="Current password" />
            <button disabled={!securityPassword || securityLoading[passwordPrompt]} onClick={handlePasswordConfirmedAction} className="mt-4 w-full bg-primary text-primary-foreground px-4 py-2.5 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
              {securityLoading[passwordPrompt] ? "Confirming..." : "Confirm"}
            </button>
          </div>
        </div>
      )}

      {recoveryCodes.length > 0 && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="premium-card w-full max-w-md border border-border shadow-2xl">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-sm font-semibold">Backup recovery codes</h3>
                <p className="text-xs text-muted-foreground mt-1">These one-time codes are shown only once. Copy or download them now.</p>
              </div>
              <button onClick={() => setRecoveryCodes([])} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2 bg-secondary/40 rounded-xl p-3 font-mono text-sm">
              {recoveryCodes.map((code) => <span key={code}>{code}</span>)}
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <button onClick={copyRecoveryCodes} className="border border-border px-4 py-2.5 rounded-md text-sm font-medium hover:bg-secondary transition-colors flex items-center justify-center gap-2"><Copy size={14} /> Copy</button>
              <button onClick={downloadRecoveryCodes} className="bg-primary text-primary-foreground px-4 py-2.5 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"><Download size={14} /> Download</button>
            </div>
          </div>
        </div>
      )}

      {/* Change Password */}
      <div className="premium-card">
        <h3 className="text-sm font-semibold mb-4">Change Password</h3>
        {pwMessage && (
          <p className={`text-xs mb-3 ${pwError ? "text-destructive" : "text-muted-foreground"}`}>{pwMessage}</p>
        )}
        <div className="grid sm:grid-cols-2 gap-4">
          <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="Current password" className="w-full bg-background border border-border rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/30" />
          <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="New password" className="w-full bg-background border border-border rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/30" />
        </div>
        <button
          disabled={pwLoading || !currentPw || !newPw}
          onClick={async () => {
            setPwLoading(true);
            setPwMessage("");
            setPwError(false);
            try {
              await updatePassword(currentPw, newPw);
              setPwMessage("Password updated successfully.");
              setCurrentPw("");
              setNewPw("");
            } catch (err: any) {
              setPwError(true);
              setPwMessage(err?.message || "Failed to update password.");
            } finally {
              setPwLoading(false);
            }
          }}
          className="mt-4 border border-border px-6 py-2.5 rounded-md text-sm font-medium hover:bg-secondary transition-colors disabled:opacity-50"
        >
          {pwLoading ? "Updating..." : "Update Password"}
        </button>
      </div>
    </div>
  );
}
