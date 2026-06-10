import { useEffect, useMemo, useRef } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { CartProvider } from "@/lib/cart-context";
import { WishlistProvider } from "@/lib/wishlist-context";
import { ResellerProvider } from "@/lib/reseller-context";
import { CustomerAuthProvider } from "@/lib/customer-auth-context";
import { AdminAuthProvider } from "@/lib/admin-auth-context";
import { detectPortal, isAppModeDriven } from "@/lib/subdomain";
import { ProductsProvider } from "@/lib/products-context";
import { ProductSyncProvider } from "@/context/ProductSyncContext";
import { SeasonalThemeProvider } from "@/lib/seasonal-theme-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { supabase } from "@/lib/supabase";

import PrivacyPolicy from "@/pages/PrivacyPolicy";
import TermsOfService from "@/pages/TermsOfService";
import ContactUs from "@/pages/ContactUs";
import AboutUs from "@/pages/AboutUs";
import Staging from "@/pages/Staging";

// Portals
import { AdminPortal } from "./portals/AdminPortal";
import { ResellerPortal } from "./portals/ResellerPortal";
import { CustomerPortal } from "./portals/CustomerPortal";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 5 * 60 * 1000,
    },
  },
});

const App = () => {
  const portal = detectPortal();
  const locked = isAppModeDriven();

  // DEBUG: Track portal stability
  const lastPortal = useRef(portal);
  useEffect(() => {
    if (lastPortal.current !== portal) {
      console.log(`[APP] Portal switched: ${lastPortal.current} -> ${portal} (Locked: ${locked})`);
      lastPortal.current = portal;
    }
  }, [portal, locked]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        console.log("[APP] Auth state change:", event, "User:", session.user.email);
      } else {
        console.log("[APP] Auth state change:", event, "Logged out");
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  /**
   * When VITE_PORTAL is set (separate deployment), only the target portal
   * is mounted at root "/". All paths are handled by that single portal.
   *
   * When not set (unified / dev), all portals mount at their prefixed paths.
   */
  const routes = useMemo(() => {
    if (locked) {
      switch (portal) {
        case "admin":
          return (
            <Routes>
              <Route path="/*" element={<AdminAuthProvider><AdminPortal /></AdminAuthProvider>} />
            </Routes>
          );
        case "reseller":
          return (
            <Routes>
              <Route path="/*" element={<ResellerPortal />} />
            </Routes>
          );
        case "customer":
        default:
          return (
            <Routes>
              <Route path="/*" element={<CustomerAuthProvider><CustomerPortal /></CustomerAuthProvider>} />
            </Routes>
          );
      }
    }

    // Unified deployment: all portals at their prefixed paths
    return (
      <Routes>
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<TermsOfService />} />
        <Route path="/contact" element={<ContactUs />} />
        <Route path="/about" element={<AboutUs />} />
        <Route path="/admin/*" element={<AdminAuthProvider><AdminPortal /></AdminAuthProvider>} />
        <Route path="/reseller/*" element={<ResellerPortal />} />
        <Route path="/*" element={<CustomerAuthProvider><CustomerPortal /></CustomerAuthProvider>} />
      </Routes>
    );
  }, [locked, portal]);

  return (
    <ErrorBoundary>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <BrowserRouter>
              <ProductsProvider>
                <ProductSyncProvider>
                  <CartProvider>
                    <WishlistProvider>
                      <ResellerProvider>
                        <SeasonalThemeProvider>
                          <Toaster />
                          <Sonner />
                          {routes}
                        </SeasonalThemeProvider>
                      </ResellerProvider>
                    </WishlistProvider>
                  </CartProvider>
                </ProductSyncProvider>
              </ProductsProvider>
            </BrowserRouter>
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
};

export default App;
