import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/components/ThemeProvider";
import { I18nProvider } from "@/lib/i18n";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import HowItWorks from "./pages/HowItWorks";
import ChallengesPricing from "./pages/ChallengesPricing";
import RulesPage from "./pages/Rules";
import PayoutsPage from "./pages/PayoutsPage";
import FAQ from "./pages/FAQ";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import RiskDisclosure from "./pages/RiskDisclosure";
import RefundPolicy from "./pages/RefundPolicy";
import DashboardLayout from "./components/DashboardLayout";
import DashboardOverview from "./pages/dashboard/Overview";
import MyAccounts from "./pages/dashboard/MyAccounts";
import Objectives from "./pages/dashboard/Objectives";
import Trades from "./pages/dashboard/Trades";
import Analytics from "./pages/dashboard/Analytics";
import DashboardPayouts from "./pages/dashboard/DashboardPayouts";
import Certificates from "./pages/dashboard/Certificates";
import Learning from "./pages/dashboard/Learning";
import DashboardSettings from "./pages/dashboard/DashboardSettings";
import Support from "./pages/dashboard/Support";
import ChallengeBuilder from "./pages/ChallengeBuilder";
import AmlKyc from "./pages/AmlKyc";
import AdminDashboard from "./pages/dashboard/AdminDashboard";
import NotFound from "./pages/NotFound";
import Checkout from "./pages/Checkout";
import CheckoutSuccess from "./pages/CheckoutSuccess";
import CheckoutFailure from "./pages/CheckoutFailure";
import OrderStatus from "./pages/OrderStatus";
import Verification from "./pages/Verification";
import CertificateVerification from "./pages/CertificateVerification";
import WaitlistLanding from "./pages/WaitlistLanding";

const queryClient = new QueryClient();

const platformPreviewKey = import.meta.env.VITE_PLATFORM_PREVIEW_KEY || (import.meta.env.DEV ? "fynx-preview" : "");
const publicSiteMode = import.meta.env.VITE_PUBLIC_SITE_MODE ?? "waitlist";
const routerBasename = import.meta.env.BASE_URL === "/" ? undefined : import.meta.env.BASE_URL.replace(/\/$/, "");

const isPlatformPreviewEnabled = () => {
  if (typeof window === "undefined") {
    return false;
  }

  if (publicSiteMode === "platform") {
    return true;
  }

  const params = new URLSearchParams(window.location.search);
  return (
    (Boolean(platformPreviewKey) && params.get("preview") === platformPreviewKey) ||
    window.sessionStorage.getItem("fynx-platform-preview") === "enabled"
  );
};

const App = () => (
  <ThemeProvider>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter basename={routerBasename}>
            <AuthProvider>
              {isPlatformPreviewEnabled() ? (
                <Routes>
                  {/* Public routes */}
                  <Route path="/" element={<Index />} />
                <Route path="/how-it-works" element={<HowItWorks />} />
                <Route path="/challenges" element={<ChallengesPricing />} />
                <Route path="/rules" element={<RulesPage />} />
                <Route path="/payouts" element={<PayoutsPage />} />
                <Route path="/faq" element={<FAQ />} />
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/risk-disclosure" element={<RiskDisclosure />} />
                <Route path="/refund-policy" element={<RefundPolicy />} />
                <Route path="/challenge-builder" element={<ChallengeBuilder />} />
                <Route path="/aml-kyc" element={<AmlKyc />} />
                <Route path="/checkout" element={<ProtectedRoute><Checkout /></ProtectedRoute>} />
                <Route path="/checkout/success" element={<ProtectedRoute><CheckoutSuccess /></ProtectedRoute>} />
                <Route path="/checkout/failure" element={<CheckoutFailure />} />
                <Route path="/order-status" element={<OrderStatus />} />
                <Route path="/verification" element={<ProtectedRoute><Verification /></ProtectedRoute>} />
                <Route path="/certificates/verify/:certificateId" element={<CertificateVerification />} />

                {/* Protected routes */}
                <Route path="/admin" element={<ProtectedRoute adminOnly><AdminDashboard /></ProtectedRoute>} />
                <Route path="/dashboard" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
                  <Route index element={<DashboardOverview />} />
                  <Route path="accounts" element={<MyAccounts />} />
                  <Route path="objectives" element={<Objectives />} />
                  <Route path="trades" element={<Trades />} />
                  <Route path="analytics" element={<Analytics />} />
                  <Route path="payouts" element={<DashboardPayouts />} />
                  <Route path="certificates" element={<Certificates />} />
                  <Route path="learning" element={<Learning />} />
                  <Route path="settings" element={<DashboardSettings />} />
                  <Route path="support" element={<Support />} />
                </Route>
                  <Route path="*" element={<NotFound />} />
                </Routes>
              ) : (
                <Routes>
                  <Route path="*" element={<WaitlistLanding />} />
                </Routes>
              )}
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </I18nProvider>
  </ThemeProvider>
);

export default App;
