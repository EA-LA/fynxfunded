import { loginPath } from "@/lib/auth-destination";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { isOwnerAdminEmail } from "@/lib/admin";

export default function ProtectedRoute({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const destination = loginPath(location.pathname + location.search);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-6 h-6 border-2 border-muted-foreground/30 border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to={destination} replace />;
  }

  if (adminOnly && !isOwnerAdminEmail(user.email)) {
    return <Navigate to="/dashboard" replace />;
  }

  // Block unverified email/password users (OAuth users are typically auto-verified)
  if (user.provider === "email" && !user.emailVerified) {
    return <Navigate to={destination} replace state={{ message: "Please verify your email before accessing the dashboard." }} />;
  }

  return <>{children}</>;
}
