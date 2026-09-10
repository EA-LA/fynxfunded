import { lazy } from "react";
import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";

const Index = lazy(() => import("./pages/Index"));
const HowItWorks = lazy(() => import("./pages/HowItWorks"));
const ChallengesPricing = lazy(() => import("./pages/ChallengesPricing"));
const RulesPage = lazy(() => import("./pages/Rules"));
const PayoutsPage = lazy(() => import("./pages/PayoutsPage"));
const FAQ = lazy(() => import("./pages/FAQ"));
const Login = lazy(() => import("./pages/Login"));
const Signup = lazy(() => import("./pages/Signup"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const RiskDisclosure = lazy(() => import("./pages/RiskDisclosure"));
const RefundPolicy = lazy(() => import("./pages/RefundPolicy"));
const DashboardLayout = lazy(() => import("./components/DashboardLayout"));
const DashboardOverview = lazy(() => import("./pages/dashboard/Overview"));
const MyAccounts = lazy(() => import("./pages/dashboard/MyAccounts"));
const Objectives = lazy(() => import("./pages/dashboard/Objectives"));
const Trades = lazy(() => import("./pages/dashboard/Trades"));
const Analytics = lazy(() => import("./pages/dashboard/Analytics"));
const DashboardPayouts = lazy(() => import("./pages/dashboard/DashboardPayouts"));
const Billing = lazy(() => import("./pages/dashboard/Billing"));
const Certificates = lazy(() => import("./pages/dashboard/Certificates"));
const Learning = lazy(() => import("./pages/dashboard/Learning"));
const DashboardSettings = lazy(() => import("./pages/dashboard/DashboardSettings"));
const Support = lazy(() => import("./pages/dashboard/Support"));
const AccountWorkspace = lazy(() => import("./pages/dashboard/AccountWorkspace"));
const Resources = lazy(() => import("./pages/dashboard/Resources"));
const ChallengeBuilder = lazy(() => import("./pages/ChallengeBuilder"));
const AmlKyc = lazy(() => import("./pages/AmlKyc"));
const AdminDashboard = lazy(() => import("./pages/dashboard/AdminDashboard"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Checkout = lazy(() => import("./pages/Checkout"));
const CheckoutSuccess = lazy(() => import("./pages/CheckoutSuccess"));
const CheckoutFailure = lazy(() => import("./pages/CheckoutFailure"));
const OrderStatus = lazy(() => import("./pages/OrderStatus"));
const Verification = lazy(() => import("./pages/Verification"));
const CertificateVerification = lazy(() => import("./pages/CertificateVerification"));

export default function PlatformRoutes() {
  return <AuthProvider><Routes>
    <Route path="/" element={<Index />} /><Route path="/how-it-works" element={<HowItWorks />} /><Route path="/challenges" element={<ChallengesPricing />} /><Route path="/rules" element={<RulesPage />} /><Route path="/payouts" element={<PayoutsPage />} /><Route path="/faq" element={<FAQ />} />
    <Route path="/login" element={<Login />} /><Route path="/signup" element={<Signup />} /><Route path="/forgot-password" element={<ForgotPassword />} /><Route path="/reset-password" element={<ResetPassword />} />
    <Route path="/terms" element={<Terms />} /><Route path="/privacy" element={<Privacy />} /><Route path="/risk-disclosure" element={<RiskDisclosure />} /><Route path="/refund-policy" element={<RefundPolicy />} /><Route path="/aml-kyc" element={<AmlKyc />} />
    <Route path="/challenge-builder" element={<ChallengeBuilder />} /><Route path="/checkout" element={<ProtectedRoute><Checkout /></ProtectedRoute>} /><Route path="/checkout/success" element={<ProtectedRoute><CheckoutSuccess /></ProtectedRoute>} /><Route path="/checkout/failure" element={<CheckoutFailure />} /><Route path="/order-status" element={<OrderStatus />} />
    <Route path="/verification" element={<ProtectedRoute><Verification /></ProtectedRoute>} /><Route path="/certificates/verify/:certificateId" element={<CertificateVerification />} /><Route path="/admin" element={<ProtectedRoute adminOnly><AdminDashboard /></ProtectedRoute>} />
    <Route path="/dashboard" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}><Route index element={<DashboardOverview />} /><Route path="accounts" element={<MyAccounts />} /><Route path="accounts/:challengeId" element={<AccountWorkspace />} /><Route path="objectives" element={<Objectives />} /><Route path="trades" element={<Trades />} /><Route path="analytics" element={<Analytics />} /><Route path="billing" element={<Billing />} /><Route path="payouts" element={<DashboardPayouts />} /><Route path="certificates" element={<Certificates />} /><Route path="learning" element={<Learning />} /><Route path="resources" element={<Resources />} /><Route path="settings" element={<DashboardSettings />} /><Route path="support" element={<Support />} /></Route>
    <Route path="*" element={<NotFound />} />
  </Routes></AuthProvider>;
}
