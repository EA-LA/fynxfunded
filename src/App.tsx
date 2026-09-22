import SearchMetadata from "./components/SearchMetadata";
import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "@/components/ThemeProvider";
import { I18nProvider } from "@/lib/i18n";

const PlatformRoutes = lazy(() => import("./PlatformRoutes"));
const queryClient = new QueryClient();
const routerBasename = import.meta.env.BASE_URL === "/" ? undefined : import.meta.env.BASE_URL.replace(/\/$/, "");

function RouteLoader() {
  return <div className="grid min-h-screen place-items-center bg-background" role="status" aria-label="Loading page"><div className="h-7 w-7 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" /></div>;
}

export default function App() {
  return <ThemeProvider><I18nProvider><QueryClientProvider client={queryClient}><TooltipProvider>
    <Toaster /><Sonner />
    <BrowserRouter basename={routerBasename}><SearchMetadata platform={true} /><Suspense fallback={<RouteLoader />}>
      <PlatformRoutes />
    </Suspense></BrowserRouter>
  </TooltipProvider></QueryClientProvider></I18nProvider></ThemeProvider>;
}
