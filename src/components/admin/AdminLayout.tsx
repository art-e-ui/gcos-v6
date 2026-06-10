import { AppSidebar } from "@/components/admin/AppSidebar";
import { Search, ChevronRight, Moon, Sun, PinOff, LogOut, PanelLeft } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { adminPath } from "@/lib/subdomain";
import { useAdminAuth, isPathAllowed } from "@/lib/admin-auth-context-hooks";
import { useAdminLogger } from "@/hooks/use-admin-logger";
import { toast } from "sonner";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AdminGlobalNotifications } from "@/components/admin/AdminGlobalNotifications";
import { AdminErrorBoundary } from "@/components/admin/AdminErrorBoundary";

/** Canonical page titles keyed by /admin/... paths */
const canonicalPageTitles: Record<string, { title: string; breadcrumb: React.ReactNode }> = {

  "/admin": { title: "Dashboard", breadcrumb: <><span className="text-brand-green">Global</span><span className="text-brand-gold">Cart</span></> },
  "/admin/inventory": { title: "Inventory", breadcrumb: <><span className="text-brand-green">Global</span><span className="text-brand-gold">Cart</span></> },
  "/admin/orders": { title: "Orders", breadcrumb: <><span className="text-brand-green">Global</span><span className="text-brand-gold">Cart</span></> },
  "/admin/customers": { title: "Customers", breadcrumb: <><span className="text-brand-green">Global</span><span className="text-brand-gold">Cart</span></> },
  "/admin/resellers": { title: "Retail-shops", breadcrumb: <><span className="text-brand-green">Global</span><span className="text-brand-gold">Cart</span></> },
  "/admin/customer-service": { title: "Customer Service", breadcrumb: <><span className="text-brand-green">Global</span><span className="text-brand-gold">Cart</span></> },
  "/admin/content": { title: "Content", breadcrumb: <><span className="text-brand-green">Global</span><span className="text-brand-gold">Cart</span></> },
  "/admin/admins": { title: "Admins", breadcrumb: "Management & Financing" },
  "/admin/messenger": { title: "Messenger", breadcrumb: "Management & Financing" },
  "/admin/roles": { title: "Roles & Permissions", breadcrumb: "Management & Financing" },
  "/admin/audit-logs": { title: "Audit Logs", breadcrumb: "Management & Financing" },
  "/admin/security": { title: "Security", breadcrumb: "Management & Financing" },
  "/admin/sla/ownership": { title: "Ownership", breadcrumb: "Management & Financing" },
  "/admin/sla/administrator": { title: "Administrator", breadcrumb: "Management & Financing" },
  "/admin/sla/staff": { title: "Staff", breadcrumb: "Management & Financing" },
  "/admin/sla/site-advertising": { title: "Site Front Advertising", breadcrumb: "Management & Financing" },
  "/admin/sla/broadcast-news": { title: "Broadcast News & Updates", breadcrumb: "Management & Financing" },
  "/admin/sla/reseller-2-admin": { title: "Reseller Customer Service", breadcrumb: "Management & Financing" },
  "/admin/sla/sqc": { title: "VP for SQC", breadcrumb: "Management & Financing" },
  "/admin/sla/sqc-orders": { title: "SQC", breadcrumb: "Management & Financing" },
  "/admin/ach/customers": { title: "Customers", breadcrumb: "ACH" },
  "/admin/ach/financial": { title: "Financial", breadcrumb: "ACH" },
  "/admin/ars/retail-shops": { title: "Retail Shops", breadcrumb: "Management & Financing" },
  "/admin/ars/orders": { title: "Track & Manage Orders", breadcrumb: "Management & Financing" },
  "/admin/ars/payment-info": { title: "Payment Info's & Balance", breadcrumb: "Management & Financing" },
  "/admin/system": { title: "System Configuration", breadcrumb: "System" },
  "/admin/alerts": { title: "Active Alerts", breadcrumb: "System" },
  "/admin/system-logs": { title: "System Logs", breadcrumb: "System" },
  "/admin/migration": { title: "Database Migration", breadcrumb: "System" },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { session, signOut, loading } = useAdminAuth();
  const { logActivity } = useAdminLogger();

  const clicksRef = useRef<string[]>([]);

  // Custom click tracker for tracing malfunctions
  useEffect(() => {
    if (!session) return;
    
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target || !target.tagName) return;

      let interactiveElement: HTMLElement | null = null;
      let current: HTMLElement | null = target;
      while (current) {
        const tag = current.tagName.toLowerCase();
        if (tag === 'button' || tag === 'input' || tag === 'a' || current.getAttribute('role') === 'button') {
          interactiveElement = current;
          break;
        }
        current = current.parentElement;
      }

      if (!interactiveElement) return;

      const tag = interactiveElement.tagName.toLowerCase();
      let clickPath = tag;
      if (interactiveElement.id) clickPath += `#${interactiveElement.id}`;
      
      let label = interactiveElement.innerText || interactiveElement.getAttribute('aria-label') || interactiveElement.getAttribute('placeholder') || '';
      label = label.trim().substring(0, 50);
      if (tag === 'input') {
        const inputVal = (interactiveElement as HTMLInputElement).value || '';
        label = inputVal ? `value: ${inputVal}` : (interactiveElement.getAttribute('placeholder') || '');
      }
      
      const targetPath = `${clickPath}${label ? ' ("' + label + '")' : ''}`;

      clicksRef.current.push(targetPath);
      if (clicksRef.current.length > 8) clicksRef.current.shift();

      // Log BUTTON_CLICK globally using useAdminLogger hook
      logActivity('BUTTON_CLICK', targetPath, { lastClicks: [...clicksRef.current] });
    };

    const handleGlobalError = (event: ErrorEvent) => {
      logActivity('ERROR', 'System Malfunction', {
        type: 'Uncaught Error',
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        lastClicks: [...clicksRef.current]
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      let reason = event.reason;
      if (reason instanceof Error) reason = reason.message;
      else if (typeof reason === 'object') reason = JSON.stringify(reason);
      logActivity('ERROR', 'System Malfunction', {
        type: 'Unhandled Rejection',
        reason: String(reason),
        lastClicks: [...clicksRef.current]
      });
    };

    document.addEventListener('click', handleGlobalClick, true);
    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      document.removeEventListener('click', handleGlobalClick, true);
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [session, logActivity]);

  // Build subdomain-aware page title lookup
  const pageTitles = useMemo(() => {
    const map: Record<string, { title: string; breadcrumb: React.ReactNode }> = {};
    for (const [canonical, info] of Object.entries(canonicalPageTitles)) {
      map[adminPath(canonical)] = info;
    }
    return map;
  }, []);

  // SECURITY: enforce role-based access — auto-logout on violation
  useEffect(() => {
    if (loading) return; // Wait for auth check to complete

    if (!session) {
      const isAuthPath = location.pathname.toLowerCase().includes("/auth/");
      if (!isAuthPath) {
        const target = adminPath("/admin/auth/sign-in");
        console.log("[ADMIN_LAYOUT] No session, redirecting to login from:", location.pathname, "Target:", target);
        navigate(target, { replace: true });
      }
      return;
    }

    // Role-based access control
    const role = session.role;
    // Canonical path resolution for route checking
    const path = location.pathname.replace(/\/$/, "") || "/admin";
    let canonical = path;
    
    // In dev: /admin -> /admin
    // In locked: / -> /admin
    if (!canonical.startsWith("/admin")) {
      canonical = canonical === "/" ? "/admin" : `/admin${canonical}`;
    }

    if (!isPathAllowed(role, canonical)) {
      console.warn(`[ADMIN_LAYOUT] Path not allowed: ${canonical} for role: ${role}. Signing out.`);
      toast.error("Access denied — you do not have permission to view this page.");
      signOut().then(() => navigate(adminPath("/admin/auth/sign-in"), { replace: true }));
    }
  }, [location.pathname, session, navigate, signOut, loading]);

  useEffect(() => {
    // Disabled VIEW_PAGE logging to prevent spam
    // if (session) {
    //   logActivity('VIEW_PAGE', location.pathname);
    // }
  }, [location.pathname, session]);

  const pageInfo = pageTitles[location.pathname] || { title: "Page", breadcrumb: "—" };
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  // Get initials from session name
  const initials = session?.name
    ? session.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
    : "??";

  return (
    <SidebarProvider defaultOpen={false}>
      <AdminGlobalNotifications />
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />

        <SidebarInset>
          {/* Header */}
          <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-sidebar-border bg-sidebar px-4 lg:px-6 shadow-theme-xs transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 h-4" />
              <div className="hidden sm:flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground">{pageInfo.breadcrumb}</span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                <span className="font-semibold text-foreground">{pageInfo.title}</span>
              </div>
              <h1 className="sm:hidden font-semibold text-foreground">{pageInfo.title}</h1>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden md:flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search or type command..."
                  className="bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground w-48"
                />
                <kbd className="hidden lg:inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  ⌘K
                </kbd>
              </div>

              <button
                onClick={() => setDark(!dark)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border hover:bg-accent transition-colors"
              >
                {dark ? <Sun className="h-4 w-4 text-muted-foreground" /> : <Moon className="h-4 w-4 text-muted-foreground" />}
              </button>

              <button
                onClick={async () => { 
                  logActivity('LOGOUT', 'AdminLayout');
                  await signOut(); 
                  navigate(adminPath("/admin/auth/sign-in")); 
                }}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border hover:bg-destructive/10 hover:text-destructive transition-colors"
                title="Sign Out"
              >
                <LogOut className="h-4 w-4 text-muted-foreground" />
              </button>

              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold text-sm cursor-pointer">
                {initials}
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-auto p-4 lg:p-6">
            <AdminErrorBoundary>
              {children}
            </AdminErrorBoundary>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
