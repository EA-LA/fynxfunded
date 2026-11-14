// Local preview only: stand-ins for sign-in, account access and Firebase.
export const account = {
  accountId: "ft_preview0000000000000000000000_p1", challengeId: "ch-preview", orderId: "o-preview", platform: "FYNX Trade",
  status: "active", activationStatus: "active", currentPhase: 1, startingBalance: 50000, balance: 50000, equity: 50000,
  tradingEnabled: true, tradingHoldReason: "", accountEmailStatus: "delivered",
  rules: { profit_target_percent: "8", daily_loss_percent: "5", max_loss_percent: "10", min_trading_days: 3 },
};
export const useAuth = () => ({ user: { userId: "preview-user" }, signOut: async () => {} });
export const fundedAccessCall = async (_name: string, data: { action: string }) => (data.action === "list" ? { accounts: [account] } : account);
export const auth = null;
export const isFirebaseConfigured = false;
