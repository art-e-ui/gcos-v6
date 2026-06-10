import React from "react";
import { 
  ShoppingBag, Settings, RefreshCw, Terminal, 
  Database, Zap, ToggleLeft, Sliders, CalendarDays, ArrowRightRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

interface ShopifySyncPanelProps {
  shopifyDomain: string;
  setShopifyDomain: (val: string) => void;
  shopifyToken: string;
  setShopifyToken: (val: string) => void;
  shopifyClientId: string;
  setShopifyClientId: (val: string) => void;
  shopifyClientSecret: string;
  setShopifyClientSecret: (val: string) => void;
  shopifySyncLimit: string;
  setShopifySyncLimit: (val: string) => void;
  shopifyCategory: string;
  setShopifyCategory: (val: string) => void;
  
  // Policies & Settings
  useGraphQL: boolean;
  setUseGraphQL: (val: boolean) => void;
  autoCategory: boolean;
  setAutoCategory: (val: boolean) => void;
  overwritePrice: boolean;
  setOverwritePrice: (val: boolean) => void;
  overwriteStock: boolean;
  setOverwriteStock: (val: boolean) => void;
  defaultRating: string;
  setDefaultRating: (val: string) => void;
  shopifyBadge: string;
  setShopifyBadge: (val: string) => void;
  
  // Background Syncer
  backgroundSync: boolean;
  setBackgroundSync: (val: boolean) => void;
  syncInterval: string;
  setSyncInterval: (val: string) => void;
  syncLogs: string[];
  setSyncLogs: React.Dispatch<React.SetStateAction<string[]>>;
  nextSyncTime: string | null;
  isShopifySyncing: boolean;
  onSync: () => Promise<void>;
}

export function ShopifySyncPanel({
  shopifyDomain,
  setShopifyDomain,
  shopifyToken,
  setShopifyToken,
  shopifyClientId,
  setShopifyClientId,
  shopifyClientSecret,
  setShopifyClientSecret,
  shopifySyncLimit,
  setShopifySyncLimit,
  shopifyCategory,
  setShopifyCategory,
  useGraphQL,
  setUseGraphQL,
  autoCategory,
  setAutoCategory,
  overwritePrice,
  setOverwritePrice,
  overwriteStock,
  setOverwriteStock,
  defaultRating,
  setDefaultRating,
  shopifyBadge,
  setShopifyBadge,
  backgroundSync,
  setBackgroundSync,
  syncInterval,
  setSyncInterval,
  syncLogs,
  setSyncLogs,
  nextSyncTime,
  isShopifySyncing,
  onSync
}: ShopifySyncPanelProps) {
  
  const consoleBottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    // Scroll console log to bottom whenever logs change
    if (consoleBottomRef.current) {
      consoleBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [syncLogs]);

  const clearLogs = () => {
    setSyncLogs([
      `[${new Date().toLocaleTimeString('en-US', { hour12: false })}] System: Log trace wiped by operator.`
    ]);
  };

  return (
    <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-1 pb-4">
      {/* Overview Card */}
      <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-emerald-600 flex items-center gap-1.5">
            <ShoppingBag className="h-4 w-4" /> Automated Shopify Syncer
          </h4>
          {backgroundSync && (
            <span className="text-[9px] Purchase-badge bg-emerald-500 text-white font-mono px-1.5 py-0.5 rounded animate-pulse">
              ● ACTIVE DEEMON
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Robust, high-performance, background service for automatic syncing of products, images, and inventory. Offers customizable database policies and smart category keyword-routing.
        </p>
      </div>

      {/* Connection Credentials */}
      <div className="space-y-2 border-b pb-3">
        <h5 className="text-xs font-bold text-foreground flex items-center gap-1.5 uppercase tracking-wider text-muted-foreground">
          <Zap className="h-3.5 w-3.5 text-primary" /> Shopify API Server API Access
        </h5>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="shopify-domain-component" className="text-[11px] font-semibold">Store Domain</Label>
            <Input 
              id="shopify-domain-component" 
              placeholder="e.g. shop-name.myshopify.com" 
              value={shopifyDomain}
              onChange={(e) => setShopifyDomain(e.target.value)}
              className="text-xs h-8"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="shopify-token-component" className="text-[11px] font-semibold">Admin Token</Label>
            <Input 
              id="shopify-token-component" 
              type="password"
              placeholder="shpat_xxxxxxxxxxxxxxxxxxxxxx" 
              value={shopifyToken}
              onChange={(e) => setShopifyToken(e.target.value)}
              className="text-xs h-8"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          <div className="space-y-1">
            <Label htmlFor="shopify-client-id-component" className="text-[11px] font-semibold">Client ID (Dev App)</Label>
            <Input 
              id="shopify-client-id-component" 
              placeholder="Client / App ID" 
              value={shopifyClientId}
              onChange={(e) => setShopifyClientId(e.target.value)}
              className="text-xs h-8"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="shopify-client-secret-component" className="text-[11px] font-semibold">Client Secret (Dev App)</Label>
            <Input 
              id="shopify-client-secret-component" 
              type="password"
              placeholder="Client Secret key" 
              value={shopifyClientSecret}
              onChange={(e) => setShopifyClientSecret(e.target.value)}
              className="text-xs h-8"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="shopify-sync-limit-component" className="text-[11px] font-semibold">Max Products per Sync</Label>
            <Input 
              id="shopify-sync-limit-component" 
              placeholder="50" 
              value={shopifySyncLimit}
              onChange={(e) => setShopifySyncLimit(e.target.value)}
              className="text-xs h-8"
            />
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground italic leading-relaxed pt-1">
          * Configure the Admin Token (starts with `shpat_`), or input the Client ID & Client Secret to let the background rotator manage temporary credentials (for Shopify Dev Dashboard Apps).
        </p>
      </div>

      {/* Sync Method & Policies Grid */}
      <div className="space-y-3 pt-1 border-b pb-4">
        <h5 className="text-xs font-bold text-foreground flex items-center gap-1.5 uppercase tracking-wider text-muted-foreground">
          <Sliders className="h-3.5 w-3.5 text-primary" /> Database Sync Guidelines & Policies
        </h5>
        
        {/* Toggle Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 bg-muted/30 p-3 rounded-lg border">
          {/* Protocol Row */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-[11px] font-bold block cursor-pointer" htmlFor="toggle-graphql">
                Use GraphQL Protocol
              </Label>
              <span className="text-[10px] text-muted-foreground block">
                Up to 10x faster compilation & less server calls
              </span>
            </div>
            <input 
              type="checkbox" 
              id="toggle-graphql"
              checked={useGraphQL} 
              onChange={(e) => setUseGraphQL(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer accent-primary"
            />
          </div>

          {/* Smart Category Matching Row */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-[11px] font-bold block cursor-pointer" htmlFor="toggle-autocat">
                Smart Category Routing
              </Label>
              <span className="text-[10px] text-muted-foreground block">
                Tags & types keyword-matched to sections
              </span>
            </div>
            <input 
              type="checkbox" 
              id="toggle-autocat"
              checked={autoCategory} 
              onChange={(e) => setAutoCategory(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer accent-primary"
            />
          </div>

          {/* Overwrite Price */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-[11px] font-bold block cursor-pointer" htmlFor="toggle-price">
                Overwrite Price List
              </Label>
              <span className="text-[10px] text-muted-foreground block">
                Apply Shopify cost adjustments directly
              </span>
            </div>
            <input 
              type="checkbox" 
              id="toggle-price"
              checked={overwritePrice} 
              onChange={(e) => setOverwritePrice(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer accent-primary"
            />
          </div>

          {/* Overwrite Stock */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-[11px] font-bold block cursor-pointer" htmlFor="toggle-stock">
                Overwrite Stock Levels
              </Label>
              <span className="text-[10px] text-muted-foreground block">
                Synchronize stock count on every pull
              </span>
            </div>
            <input 
              type="checkbox" 
              id="toggle-stock"
              checked={overwriteStock} 
              onChange={(e) => setOverwriteStock(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer accent-primary"
            />
          </div>
        </div>

        {/* Inline Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label htmlFor="shopify-col-cat" className="text-[11px] font-semibold">Fallback Category</Label>
            <Input 
              id="shopify-col-cat" 
              placeholder="Shopify Catalog" 
              value={shopifyCategory}
              onChange={(e) => setShopifyCategory(e.target.value)}
              className="text-xs h-8"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="shopify-col-badge" className="text-[11px] font-semibold">Item Badge label</Label>
            <Input 
              id="shopify-col-badge" 
              placeholder="Shopify" 
              value={shopifyBadge}
              onChange={(e) => setShopifyBadge(e.target.value)}
              className="text-xs h-8"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="shopify-col-rating" className="text-[11px] font-semibold">Default Initial Rating</Label>
            <Input 
              id="shopify-col-rating" 
              placeholder="4.5" 
              value={defaultRating}
              onChange={(e) => setDefaultRating(e.target.value)}
              className="text-xs h-8"
            />
          </div>
        </div>
      </div>

      {/* Background Scheduler */}
      <div className="space-y-2 border-b pb-4 pt-1">
        <h5 className="text-xs font-bold text-foreground flex items-center gap-1.5 uppercase tracking-wider text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5 text-primary" /> GraphQL Autonomic Background Scheduler
        </h5>
        <div className="flex items-center justify-between bg-emerald-500/5 dark:bg-emerald-500/5 p-3 rounded-lg border border-emerald-500/10 gap-4">
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold">Autonomic Daemon Active?</span>
              <input 
                type="checkbox" 
                id="toggle-scheduling"
                checked={backgroundSync} 
                onChange={(e) => setBackgroundSync(e.target.checked)}
                className="h-4 w-4 cursor-pointer accent-primary"
              />
            </div>
            {backgroundSync && nextSyncTime ? (
              <span className="text-[10px] text-emerald-600 block font-semibold">
                ● Connected to background queue daemon — Next lookup scheduled at: <code className="bg-emerald-50 px-1 py-0.5 rounded text-xs select-all text-emerald-700">{nextSyncTime}</code> (browser-session interval runner).
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground block">
                Synchronizes automatically in background during admin checkout session without lockouts.
              </span>
            )}
          </div>
          {backgroundSync && (
            <div className="space-y-1 shrink-0 w-32">
              <Label htmlFor="bg-interval-sel" className="text-[10px] font-semibold">Duty Interval</Label>
              <select 
                id="bg-interval-sel" 
                value={syncInterval} 
                onChange={(e) => setSyncInterval(e.target.value)}
                className="w-full text-xs h-8 p-1 rounded border bg-card text-foreground"
              >
                <option value="1">Every 1 min</option>
                <option value="3">Every 3 mins</option>
                <option value="5">Every 5 mins</option>
                <option value="15">Every 15 mins</option>
                <option value="60">Every 1 hour</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Syncer Term console logs */}
      <div className="space-y-1.5 pt-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-bold text-foreground flex items-center gap-1.5">
            <Terminal className="h-3.5 w-3.5 text-primary" /> Autonomic Syncer Trace logs Console
          </Label>
          <button 
            onClick={clearLogs} 
            className="text-[10px] text-muted-foreground hover:text-foreground underline"
          >
            Wipe Console Monitor
          </button>
        </div>
        <div className="bg-zinc-950 text-emerald-400 font-mono text-[10px] p-3 rounded-xl border border-zinc-800 h-36 overflow-y-auto leading-relaxed overflow-x-hidden space-y-1 shadow-inner antialiased">
          {syncLogs.map((log, index) => (
            <div key={index} className="whitespace-pre-wrap leading-normal break-words border-l-2 border-emerald-500/25 pl-1.5 py-0.5 hover:bg-emerald-500/5 transition-colors">
              {log}
            </div>
          ))}
          <div ref={consoleBottomRef} />
        </div>
      </div>

      {/* Manual Action Banner */}
      <Button 
        onClick={onSync} 
        disabled={isShopifySyncing} 
        className="w-full bg-emerald-600 hover:bg-emerald-750 text-white gap-2 font-medium h-10 mt-2 shadow-lg hover:shadow-emerald-900/10 transition-all"
        id="trigger-shopify-sync-button"
      >
        {isShopifySyncing ? (
          <>
            <LoadingSpinner size={16} /> Connecting & Transacting Shopify Graph Catalog...
          </>
        ) : (
          <>
            <RefreshCw className="h-4 w-4 animate-spin-slow" /> Trigger Manual GraphQL catalog Sync Mode
          </>
        )}
      </Button>
    </div>
  );
}
