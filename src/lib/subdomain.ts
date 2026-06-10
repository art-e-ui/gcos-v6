/**
 * Portal detection utilities for multi-portal routing.
 *
 * Supports two detection methods:
 * 1. Environment variable: VITE_PORTAL (for separate Cloud Run/container deployments)
 *    - "customer"  → customer portal (myshop.com)
 *    - "reseller"  → reseller portal (reseller.myshop.com)
 *    - "admin"     → admin portal (admin.myshop.com)
 *
 * 2. Subdomain detection (unified deployment / dev):
 *    - myshop.com              → customer
 *    - reseller.myshop.com     → reseller
 *    - admin.myshop.com        → admin
 */

export type PortalType = "customer" | "reseller" | "admin";

/**
 * Returns true when portal identity is determined by VITE_PORTAL env var
 * or dev override. In this mode, routes are served at root "/" with no prefix.
 */
export function isAppModeDriven(): boolean {
  try {
    const host = window.location.hostname;
    
    // 0. Manual override from staging (highest priority)
    if (typeof window !== 'undefined' && localStorage.getItem("dev_portal_override")) {
      return true;
    }

    // 1. Subdomain presence
    if (host.startsWith("admin.") || host.startsWith("administration.") || 
        host.startsWith("reseller.") || host.startsWith("retailshops.")) {
      return true;
    }

    // 2. Explicit environment lock
    const portalEnv = import.meta.env.VITE_PORTAL || import.meta.env.VITE_APP_MODE;
    if (portalEnv) {
      const isSharedPreview = host.includes('ais-pre-') || host.includes('run.app');
      const isLocal = host === 'localhost' || host === '127.0.0.1' || host.includes('ais-dev-');
      
      if (!isSharedPreview && !isLocal) {
        return true;
      }
    }
  } catch (e) { /* ignore */ }
  
  return false;
}

/**
 * Returns true if the portal switcher should be visible.
 */
export function shouldShowPortalSwitcher(): boolean {
  try {
    const host = window.location.hostname;
    const isDev = host.includes('ais-dev-') || host === 'localhost' || host === '127.0.0.1';
    
    if (isDev) return true;
    
    // Explicitly hide in production builds unless it's a dev/preview environment
    if (import.meta.env.PROD) {
      return false;
    }
    
    if (import.meta.env.DEV) return true;
  } catch (e) { /* ignore */ }
  return false;
}

export function detectPortal(): PortalType {
  // 0. Manual override (Highest priority for dev)
  try {
    const override = typeof window !== 'undefined' ? localStorage.getItem("dev_portal_override") as PortalType : null;
    if (override === "admin" || override === "reseller" || override === "customer") {
      return override;
    }
  } catch (e) { /* ignore */ }

  // 1. Env vars (Hard lock for production deployments)
  const mode = import.meta.env.VITE_PORTAL || import.meta.env.VITE_APP_MODE;
  if (mode === "admin") return "admin";
  if (mode === "reseller") return "reseller";
  if (mode === "site" || mode === "customer") return "customer";

  // 2. Subdomain detection
  try {
    const host = window.location.hostname;
    if (host.startsWith("admin.") || host.startsWith("administration.")) return "admin";
    if (host.startsWith("reseller.") || host.startsWith("retailshops.")) return "reseller";
  } catch (e) { /* ignore */ }

  // 3. Path-based detection (Fallback for unified mode)
  try {
    const path = window.location.pathname;
    if (path.startsWith("/admin")) return "admin";
    if (path.startsWith("/reseller")) return "reseller";
  } catch (e) { /* ignore */ }

  return "customer";
}

/** @deprecated Use detectPortal() === "admin" instead */
export function isAdminSubdomain(): boolean {
  return detectPortal() === "admin";
}

export function isResellerSubdomain(): boolean {
  return detectPortal() === "reseller";
}

/**
 * Returns the route prefix for admin pages.
 * When locked to admin portal, returns "" (root-level).
 */
export function adminPrefix(): string {
  return isAppModeDriven() && detectPortal() === "admin" ? "" : "/admin";
}

/**
 * Returns the route prefix for reseller pages.
 * When locked to reseller portal, returns "" (root-level).
 */
export function resellerPrefix(): string {
  return isAppModeDriven() && detectPortal() === "reseller" ? "" : "/reseller";
}

function normalizeCanonicalPath(canonicalPath: string, basePath: "/admin" | "/reseller"): string {
  const normalized = canonicalPath.replace(/\/$/, "") || basePath;
  return normalized.startsWith(basePath) ? normalized : `${basePath}${normalized.startsWith("/") ? "" : "/"}${normalized}`;
}

export function adminPath(canonicalPath: string): string {
  const normalized = normalizeCanonicalPath(canonicalPath, "/admin");

  if (isAppModeDriven() && detectPortal() === "admin") {
    const stripped = normalized.replace(/^\/admin(?=\/|$)/, "") || "/";
    return stripped;
  }

  return normalized;
}

export function resellerPath(canonicalPath: string): string {
  const normalized = normalizeCanonicalPath(canonicalPath, "/reseller");

  if (isAppModeDriven() && detectPortal() === "reseller") {
    const stripped = normalized.replace(/^\/reseller(?=\/|$)/, "") || "/";
    return stripped;
  }

  return normalized;
}

/**
 * Returns the absolute URL for a reseller's storefront.
 * Handles subdomain vs path-based routing correctly.
 */
export function getStorefrontUrl(shopSlug: string): string {
  if (!shopSlug) return "/";
  
  try {
    const host = window.location.hostname;
    const protocol = window.location.protocol;
    
    // If we're on a dev/preview host, use path-based routing
    if (host.includes('ais-dev-') || host.includes('ais-pre-') || host === 'localhost' || host === '127.0.0.1') {
      return `/store/${shopSlug}`;
    }
    
    // In production, we might be on reseller.myshop.com or admin.myshop.com
    // We want to go to myshop.com/store/slug
    const baseHost = host.replace(/^(admin|reseller|administration|retailshops)\./, "");
    return `${protocol}//${baseHost}/store/${shopSlug}`;
  } catch (e) {
    return `/store/${shopSlug}`;
  }
}
