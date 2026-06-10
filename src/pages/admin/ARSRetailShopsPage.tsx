import { useState, useMemo, useEffect } from "react";
import { Store, Search, MoreHorizontal, Filter, Snowflake, ShieldCheck, Bell, Edit, Trash2, Star, Key } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { useAdminLogger } from "@/hooks/use-admin-logger";
import { useUnifiedResellers } from "@/lib/unified-hooks";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

/* ── VIP tier config ── */
const VIP_PRODUCT_LIMITS: Record<number, number> = {
  0: 20, 1: 30, 2: 40, 3: 50, 4: 100, 5: 150,
};

const vipBadgeColors: Record<number, string> = {
  0: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  1: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  2: "bg-green-500/15 text-green-400 border-green-500/30",
  3: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  4: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  5: "bg-purple-500/15 text-purple-400 border-purple-500/30",
};

interface RetailShop {
  id: string;
  resellerId: string;
  rawResellerId: number | null;
  resellerName: string;
  shopName: string;
  vipLevel: number;
  productsLimit: number;
  starRating: number;
  avgVisitors: number;
  creditScore: number;
  status: "Active" | "Frozen";
  referralId?: string;
  referredBy?: string;
  memberOfAdminId?: string;
  email: string;
}

function creditScoreColor(score: number) {
  if (score >= 85) return "text-emerald-400";
  if (score >= 70) return "text-amber-400";
  return "text-destructive";
}

export default function ARSRetailShopsPage() {
  const queryClient = useQueryClient();
  const resellers = useUnifiedResellers();
  const { canSeeAll, allowedReferralIds, allowedAdminIds, allowedStaffIds, allowedStaffDocIds } = useAdminAccess();
  const { logActivity } = useAdminLogger();

  const [shops, setShops] = useState<RetailShop[]>([]);

  // Initialize shops with data from resellers
  useEffect(() => {
    if (!resellers || resellers.length === 0) {
      setShops([]);
      return;
    }
    
    setShops(resellers.map(r => ({
      id: r.id,
      resellerId: r.resellerId ? `GRS${r.resellerId}` : r.id.substring(0, 8).toUpperCase(),
      rawResellerId: r.resellerId,
      resellerName: `${r.firstName} ${r.lastName}`,
      shopName: r.shopName || `${r.firstName} ${r.lastName}'s Shop`,
      vipLevel: parseInt(String(r.level).match(/\d+/)?.[0] || '0', 10),
      productsLimit: r.productLimit || 20,
      starRating: r.starRating || 2.0,
      avgVisitors: 1000, 
      creditScore: r.creditScore || 100,
      status: r.isSuspended ? "Frozen" : "Active", 
      referralId: r.referralId,
      referredBy: r.referredBy,
      memberOfAdminId: r.memberOfAdminId,
      email: r.email
    })));
  }, [resellers]);

  const [search, setSearch] = useState("");
  const [editShop, setEditShop] = useState<RetailShop | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RetailShop | null>(null);
  const [notifyDialogOpen, setNotifyDialogOpen] = useState(false);
  const [notifyTarget, setNotifyTarget] = useState<RetailShop | null>(null);
  const [notifyMessage, setNotifyMessage] = useState("");

  const filtered = useMemo(() => {
    const base = shops.filter((s) => {
      if (canSeeAll) return true;
      return (s.referralId && allowedReferralIds.includes(s.referralId)) ||
             (s.referredBy && (allowedStaffIds.includes(s.referredBy) || allowedStaffDocIds.includes(s.referredBy))) ||
             (s.memberOfAdminId && allowedAdminIds.includes(s.memberOfAdminId));
    });

    return base.filter(
      (s) =>
        s.shopName.toLowerCase().includes(search.toLowerCase()) ||
        s.resellerId.toLowerCase().includes(search.toLowerCase()) ||
        s.resellerName.toLowerCase().includes(search.toLowerCase()) ||
        s.id.toLowerCase().includes(search.toLowerCase()) ||
        (s.referralId && s.referralId.toLowerCase().includes(search.toLowerCase()))
    );
  }, [shops, search, canSeeAll, allowedReferralIds, allowedAdminIds, allowedStaffIds, allowedStaffDocIds]);

  /* ── actions ── */
  const handleFreeze = async (shop: RetailShop) => {
    try {
      const { data, error } = await supabase.from('retail_shops').update({ 
        is_suspended: true 
      }).eq('id', shop.id).select();
      
      if (error) throw error;
      
      if ((!data || data.length === 0) && shop.rawResellerId) {
        const { error: fallbackError } = await supabase.from('retail_shops').update({
          is_suspended: true
        }).eq('reseller_id', shop.rawResellerId);
        
        if (fallbackError) throw fallbackError;
      }
      
      setShops((prev) => prev.map((s) => (s.id === shop.id ? { ...s, status: "Frozen" } : s)));
      queryClient.invalidateQueries({ queryKey: ["resellers"] });
      logActivity("DATA_UPDATE", "Retail Shops", `Deactivated shop ${shop.id} (${shop.shopName})`);
      toast.success(`${shop.shopName} has been deactivated. The reseller will see a restriction notice.`);
    } catch (e) {
      console.error(e);
      logActivity("ERROR", "Retail Shops", `Failed to deactivate shop ${shop.id}`);
      toast.error("Failed to deactivate shop");
    }
  };

  const handleUnfreeze = async (shop: RetailShop) => {
    try {
      const { data, error } = await supabase.from('retail_shops').update({ 
        is_suspended: false 
      }).eq('id', shop.id).select();
      
      if (error) throw error;

      if ((!data || data.length === 0) && shop.rawResellerId) {
        const { error: fallbackError } = await supabase.from('retail_shops').update({
          is_suspended: false
        }).eq('reseller_id', shop.rawResellerId);
        
        if (fallbackError) throw fallbackError;
      }

      setShops((prev) => prev.map((s) => (s.id === shop.id ? { ...s, status: "Active" } : s)));
      queryClient.invalidateQueries({ queryKey: ["resellers"] });
      logActivity("DATA_UPDATE", "Retail Shops", `Reactivated shop ${shop.id} (${shop.shopName})`);
      toast.success(`${shop.shopName} has been reactivated and restored to active status.`);
    } catch (e) {
      console.error(e);
      logActivity("ERROR", "Retail Shops", `Failed to reactivate shop ${shop.id}`);
      toast.error("Failed to reactivate shop");
    }
  };

  const handleResetPassword = async (shop: RetailShop) => {
    if (!window.confirm(`Are you sure you want to reset password for ${shop.resellerName} to "12345678"?`)) return;
    
    try {
      const response = await fetch('/api/admin/reset-reseller-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resellerId: shop.id }),
      });
      
      if (response.ok) {
        toast.success(`Password reset to 12345678 for ${shop.resellerName}`);
      } else {
        const data = await response.json();
        toast.error(data.error || "Failed to reset password");
      }
    } catch (e) {
      console.error(e);
      toast.error("An error occurred during password reset");
    }
  };

  const handleNotify = async () => {
    if (!notifyTarget || !notifyMessage.trim()) return;
    
    try {
      const gId = notifyTarget.resellerId ? `GRS-${notifyTarget.resellerId}` : "GRS";
      const { error } = await supabase.from('reseller_notifications').insert({
        reseller_id: notifyTarget.id,
        content: notifyMessage,
        title: `System Notification for ${notifyTarget.shopName} (${gId})`,
        created_at: new Date().toISOString(),
        read: false,
        type: 'admin_alert'
      });
      
      if (error) throw error;
      
      logActivity("DATA_CREATE", "Retail Shops", `Sent notification to shop ${notifyTarget.id}`);
      toast.success(`System notification sent to ${notifyTarget.shopName}`);
      setNotifyDialogOpen(false);
      setNotifyMessage("");
    } catch (error) {
      console.error("Error sending notification:", error);
      logActivity("ERROR", "Retail Shops", `Failed to send notification to shop ${notifyTarget.id}`);
      toast.error("Failed to send notification");
    }
  };

  const handleEditSave = async () => {
    if (!editShop) return;
    
    try {
      // 1. Upsert retail_shops
      const { error: shopError } = await supabase.from('retail_shops').upsert({
        id: editShop.id,
        shop_name: editShop.shopName,
        level: `VIP-${editShop.vipLevel}`,
        star_rating: editShop.starRating,
        credit_score: editShop.creditScore,
        product_limit: VIP_PRODUCT_LIMITS[editShop.vipLevel] ?? editShop.productsLimit,
        is_suspended: editShop.status === "Frozen"
      }, { onConflict: 'id' });

      if (shopError) throw shopError;

      // 2. Update reseller_profiles
      const { error: profileError } = await supabase.from('reseller_profiles').update({
        shop_name: editShop.shopName,
        level: `VIP-${editShop.vipLevel}`,
        updated_at: new Date().toISOString()
      }).eq('id', editShop.id);

      if (profileError) throw profileError;

      logActivity("DATA_UPDATE", "Retail Shops", `Updated shop details for ${editShop.id} (${editShop.shopName})`);
      toast.success(`${editShop.shopName} updated successfully`);
      setEditDialogOpen(false);
    } catch (error) {
      console.error("Error updating shop:", error);
      logActivity("ERROR", "Retail Shops", `Failed to update shop details for ${editShop.id}`);
      toast.error("Failed to update shop details");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    
    try {
      const { error } = await supabase.from('retail_shops').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      
      setShops((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      setDeleteDialogOpen(false);
      logActivity("DATA_DELETE", "Retail Shops", `Deleted shop ${deleteTarget.id} (${deleteTarget.shopName})`);
      toast.success(`${deleteTarget.shopName} deleted`);
    } catch (error) {
      console.error("Error deleting shop:", error);
      logActivity("ERROR", "Retail Shops", `Failed to delete shop ${deleteTarget.id}`);
      toast.error("Failed to delete shop");
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground">Retail Shops</h1>
          <p className="text-sm text-muted-foreground mt-1">
            ARS Management &gt; Retail Shops — {shops.length} shops registered
          </p>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-border bg-card p-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by shop name or reseller ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Filter className="h-4 w-4 mr-1" /> Filter
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="font-semibold">Reseller ID</TableHead>
              <TableHead className="font-semibold">Shop Name</TableHead>
              <TableHead className="font-semibold">Shop Level</TableHead>
              <TableHead className="font-semibold text-center">Products Limit</TableHead>
              <TableHead className="font-semibold text-center">Star Rating</TableHead>
              <TableHead className="font-semibold text-center">Credit Score</TableHead>
              <TableHead className="font-semibold text-center">Avg. Visitors</TableHead>
              <TableHead className="font-semibold text-center">Status</TableHead>
              <TableHead className="font-semibold text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((shop) => (
              <TableRow key={shop.id} className={`group hover:bg-muted/50 transition-colors ${shop.status === 'Frozen' ? 'opacity-50 grayscale' : ''}`}>
                <TableCell className="font-mono text-xs">{shop.resellerId}</TableCell>
                <TableCell className="font-medium">
                  {shop.shopName}
                  {shop.status === 'Frozen' && (
                    <span className="ml-2 inline-flex items-center rounded border border-destructive/50 bg-destructive/10 px-1 py-0.5 text-[9px] font-bold text-destructive uppercase tracking-wider">
                      Suspended
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${vipBadgeColors[shop.vipLevel] || ""}`}>
                    VIP-{shop.vipLevel}
                  </span>
                </TableCell>
                <TableCell className="text-center font-medium">{shop.productsLimit}</TableCell>
                <TableCell className="text-center">
                  <div className="flex items-center justify-center gap-1">
                    <span className="font-bold text-sm text-yellow-500">{shop.starRating || 0}</span>
                    <Star className="h-3 w-3 fill-yellow-500 text-yellow-500" />
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <span className={`font-bold text-sm ${creditScoreColor(shop.creditScore)}`}>
                    {shop.creditScore}
                  </span>
                </TableCell>
                <TableCell className="text-center">{shop.avgVisitors.toLocaleString()}</TableCell>
                <TableCell className="text-center">
                  <Badge
                    variant={shop.status === "Active" ? "default" : "destructive"}
                    className="text-xs"
                  >
                    {shop.status === "Frozen" ? "Suspended" : shop.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault();
                          setEditShop({ ...shop });
                          setEditDialogOpen(true);
                        }}
                      >
                        <Edit className="h-4 w-4 mr-2" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {shop.status === "Active" ? (
                        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); handleFreeze(shop); }} className="text-destructive focus:text-destructive">
                          <Snowflake className="h-4 w-4 mr-2" /> Deactivate
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); handleUnfreeze(shop); }} className="text-success focus:text-success">
                          <ShieldCheck className="h-4 w-4 mr-2" /> Reactivate
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault();
                          setNotifyTarget(shop);
                          setNotifyDialogOpen(true);
                        }}
                      >
                        <Bell className="h-4 w-4 mr-2" /> Notify
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault();
                          handleResetPassword(shop);
                        }}
                      >
                        <Key className="h-4 w-4 mr-2" /> Reset Password (12345678)
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={(e) => {
                          e.preventDefault();
                          setDeleteTarget(shop);
                          setDeleteDialogOpen(true);
                        }}
                      >
                        <Trash2 className="h-4 w-4 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                  No shops found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Edit Retail Shop</DialogTitle>
          <DialogHeader>
            <DialogDescription>Update the shop details below.</DialogDescription>
          </DialogHeader>
          {editShop && (
            <div className="space-y-4 py-2">
              <div>
                <label className="text-sm font-medium text-foreground">Shop Name</label>
                <Input
                  value={editShop.shopName}
                  onChange={(e) => setEditShop({ ...editShop, shopName: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">VIP Level (0–5)</label>
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={editShop.vipLevel}
                  onChange={(e) => {
                    const level = parseInt(e.target.value);
                    setEditShop({
                      ...editShop,
                      vipLevel: level,
                      productsLimit: VIP_PRODUCT_LIMITS[level] ?? editShop.productsLimit,
                    });
                  }}
                >
                  {[0, 1, 2, 3, 4, 5].map((l) => (
                    <option key={l} value={l}>VIP-{l} ({VIP_PRODUCT_LIMITS[l]} products)</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Star Rating (0–5)</label>
                <Input
                  type="number"
                  step="0.1"
                  min={0}
                  max={5}
                  value={editShop.starRating || 0}
                  onChange={(e) =>
                    setEditShop({ ...editShop, starRating: Math.min(5, Math.max(0, parseFloat(e.target.value) || 0)) })
                  }
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Credit Score (0–100)</label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={editShop.creditScore}
                  onChange={(e) =>
                    setEditShop({ ...editShop, creditScore: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)) })
                  }
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Below 70 triggers auto-freeze recommendation
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Avg. Visitors</label>
                <Input
                  type="number"
                  value={editShop.avgVisitors}
                  onChange={(e) =>
                    setEditShop({ ...editShop, avgVisitors: parseInt(e.target.value) || 0 })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleEditSave}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Notify Dialog */}
      <Dialog open={notifyDialogOpen} onOpenChange={setNotifyDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Send Notification</DialogTitle>
          <DialogHeader>
            <DialogDescription>
              Send a system notification to <strong>{notifyTarget?.shopName}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Textarea
              placeholder="Type your notification message here..."
              value={notifyMessage}
              onChange={(e) => setNotifyMessage(e.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setNotifyDialogOpen(false); setNotifyMessage(""); }}>Cancel</Button>
            <Button onClick={handleNotify} disabled={!notifyMessage.trim()}>Send Notification</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogTitle>Delete Shop</DialogTitle>
          <DialogHeader>
            <DialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.shopName}</strong>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
