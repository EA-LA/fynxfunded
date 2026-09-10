import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "@/components/ThemeProvider";
import { I18nProvider } from "@/lib/i18n";

const PlatformRoutes = lazy(() => import("./PlatformRoutes"));
const WaitlistLanding = lazy(() => import("./pages/WaitlistLanding"));
const queryClient = new QueryClient();
const platformPreviewKey = import.meta.env.VITE_PLATFORM_PREVIEW_KEY || (import.meta.env.DEV ? "fynx-preview" : "");
const publicSiteMode = import.meta.env.VITE_PUBLIC_SITE_MODE ?? "waitlist";
const routerBasename = import.meta.env.BASE_URL === "/" ? undefined : import.meta.env.BASE_URL.replace(/\/$/, "");

function showPlatform() {
  if (typeof window === "undefined") return false;
  if (publicSiteMode === "platform") return true;
  if (window.location.pathname.startsWith("/certificates/verify/")) return true;
  if (window.location.pathname === "/checkout/success" && new URLSearchParams(window.location.search).get("session_id")?.startsWith("cs_")) return true;
  const params = new URLSearchParams(window.location.search);
  return (Boolean(platformPreviewKey) && params.get("preview") === platformPreviewKey) || window.sessionStorage.getItem("fynx-platform-preview") === "enabled";
}

function RouteLoader() {
  return <div className="grid min-h-screen place-items-center bg-background" role="status" aria-label="Loading page"><div className="h-7 w-7 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" /></div>;
}

export default function App() {
  const platform = showPlatform();
  return <ThemeProvider><I18nProvider><QueryClientProvider client={queryClient}><TooltipProvider>
    <Toaster /><Sonner />
    <BrowserRouter basename={routerBasename}><Suspense fallback={<RouteLoader />}>
      {platform ? <PlatformRoutes /> : <Routes><Route path="*" element={<WaitlistLanding />} /></Routes>}
    </Suspense></BrowserRouter>
  </TooltipProvider></QueryClientProvider></I18nProvider></ThemeProvider>;
}
