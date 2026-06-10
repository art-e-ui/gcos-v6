import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useUnifiedResellers } from "@/lib/unified-hooks";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Search, MoreVertical, UserPlus, Store, MapPin, Eye, EyeOff, User, Mail, Lock, Key, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { useDbSlaAdmins, useDbSlaStaff } from "@/hooks/use-db-sla";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Reseller } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { getStorefrontUrl } from "@/lib/subdomain";
import { toast } from "sonner";
import { Star, TrendingUp, ShieldCheck, Package, Bell } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useAdminAuth } from "@/lib/admin-auth-context-hooks";
import { useTranslation } from "react-i18next";

const vipColors: Record<string, string> = {
  "VIP-0": "bg-muted text-muted-foreground",
  "VIP-1": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "VIP-2": "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  "VIP-3": "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  "VIP-4": "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  "VIP-5": "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
};

const levelToProductLimit: Record<string, number> = {
  "VIP-0": 20,
  "VIP-1": 30,
  "VIP-2": 40,
  "VIP-3": 50,
  "VIP-4": 100,
  "VIP-5": 150,
};

const PREDEFINED_MESSAGE = "Dear Reseller, you have unpicked up orders pending in your shop. Please take action as necessary and fulfill the customer order. Unless your shop's reputation and credit score may have negative impact.";

export default function AdminResellersPage() {
  const { t } = useTranslation();
  const { session } = useAdminAuth();
  const resellers = useUnifiedResellers();
  const { data: dbAdmins } = useDbSlaAdmins();
  const { data: dbStaff } = useDbSlaStaff();
  const { canSeeAll, hasAccessToReseller } = useAdminAccess();
  const [search, setSearch] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [notificationDialogOpen, setNotificationDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", password: "", shopName: "" });
  const [editForm, setEditForm] = useState({ 
    id: "", 
    shopName: "", 
    level: "VIP-0", 
    productLimit: 20, 
    starRating: 2.0, 
    creditScore: 100 
  });
  const [notificationForm, setNotificationForm] = useState({
    resellerId: "",
    resellerIdNum: "" as string | number,
    resellerName: "",
    message: PREDEFINED_MESSAGE
  });

  const queryClient = useQueryClient();

  const filtered = useMemo(() => {
    let list = resellers || [];
    if (!canSeeAll) {
      list = list.filter((r) => hasAccessToReseller(r));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.firstName.toLowerCase().includes(q) ||
          r.lastName.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q) ||
          r.shopName.toLowerCase().includes(q) ||
          r.resellerId?.toString().includes(q)
      );
    }
    return list;
  }, [resellers, canSeeAll, hasAccessToReseller, search]);

  const handleResetUnpickedBalance = async (resellerId: string) => {
    if (!window.confirm("Are you sure you want to reset this reseller's Unpicked Balance to 0?")) return;
    
    setLoading(true);
    try {
      const { error } = await supabase.from('reseller_profiles').update({
        unpicked_balance: 0,
        updated_at: new Date().toISOString()
      }).eq('id', resellerId);

      if (error) throw error;

      toast.success("Unpicked balance reset to 0");
      queryClient.invalidateQueries({ queryKey: ["resellers"] });
    } catch (error) {
      console.error("Error resetting unpicked balance:", error);
      toast.error("Failed to reset unpicked balance");
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivate = async (resellerId: string, resellerNumId: number, currentStatus: boolean) => {
    if (!window.confirm(`Are you sure you want to ${currentStatus ? 'reactivate' : 'suspend'} this shop?`)) return;
    
    setLoading(true);
    try {
      // First try to update by UUID (id)
      const { data, error } = await supabase.from('retail_shops').update({
        is_suspended: !currentStatus
      }).eq('id', resellerId).select();
      
      if (error) throw error;
      
      // Fallback: if no row updated, try by sequential reseller_id
      if (!data || data.length === 0) {
        const { error: fallbackError } = await supabase.from('retail_shops').update({
          is_suspended: !currentStatus
        }).eq('reseller_id', resellerNumId);
        
        if (fallbackError) throw fallbackError;
      }
      
      toast.success(`Shop ${currentStatus ? 'reactivated' : 'suspended'} successfully`);
      queryClient.invalidateQueries({ queryKey: ["resellers"] });
    } catch (error) {
      console.error("Error updating shop status:", error);
      toast.error("Failed to update shop status");
    } finally {
      setLoading(false);
    }
  };

  const handleSyncBalances = async (resellerId: string, numericId: string | number | undefined) => {
    if (!window.confirm("Are you sure you want to recalculate and sync pending/unpicked balances based on actual orders for this reseller?")) return;
    
    setLoading(true);
    try {
      const { data: orders, error: ordersError } = await supabase.from('orders').select('*');
      if (ordersError) throw ordersError;
      
      const targetUid = resellerId.toLowerCase();
      const targetNumId = String(numericId || "").replace(/\D/g, "");
      
      const filteredOrders = orders.filter((data) => {
        const oResellerUid = String(data.reseller_id || "").toLowerCase();
        
        // 1. Exact UID match
        if (oResellerUid === targetUid) return true;
        
        // 2. Numeric match (extract digits from whatever is stored)
        if (targetNumId) {
          const oDigitsUid = oResellerUid.replace(/\D/g, "");
          if (oDigitsUid === targetNumId) return true;
        }
        
        // 3. String variations match
        const variants = [
          targetNumId,
          `grs${targetNumId}`,
          `grs-${targetNumId}`,
          `gsr${targetNumId}`,
          `gsr-${targetNumId}`
        ].filter(Boolean);
        
        return variants.includes(oResellerUid);
      });
      
      let sumUnpicked = 0;
      let sumPending = 0;
      
      filteredOrders.forEach(order => {
        const total = Number(order.total_amount || 0);
        const status = (order.status || "Pending").toLowerCase();
        
        if (status === "pending" || status === "processing") {
           sumUnpicked += total;
        } else if (status === "ongoing" || status === "shipped") {
           sumPending += total;
        }
      });
      
      const { error } = await supabase.from('reseller_profiles').update({
        unpicked_balance: Math.max(0, Number(sumUnpicked.toFixed(2))),
        pending_balance: Math.max(0, Number(sumPending.toFixed(2))),
        updated_at: new Date().toISOString()
      }).eq('id', resellerId);

      if (error) throw error;
      
      toast.success(`Balances synced: Unpicked ${sumUnpicked.toFixed(2)}, Pending ${sumPending.toFixed(2)}`);
      queryClient.invalidateQueries({ queryKey: ["resellers"] });
    } catch (error) {
       console.error("Error syncing balances:", error);
       toast.error("Failed to sync balances");
    } finally {
      setLoading(false);
    }
  };

  const handleAddReseller = async () => {
    if (!form.firstName || !form.lastName || !form.email || !form.password || !form.shopName) {
      toast.error("All fields are required");
      return;
    }
    setLoading(true);
    
    try {
      const response = await fetch('/api/admin/create-reseller', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          password: form.password,
          shopName: form.shopName,
          session: session // Pass session for ownership logic if needed, or server can derive it
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to create reseller");
      }

      toast.success("Reseller created successfully");
      queryClient.invalidateQueries({ queryKey: ["resellers"] });
      setAddDialogOpen(false);
      setForm({ firstName: "", lastName: "", email: "", password: "", shopName: "" });
    } catch (e) {
      console.error("Error creating reseller:", e);
      toast.error(e instanceof Error ? e.message : "Failed to create reseller");
    } finally {
      setLoading(false);
    }
  };

  const handleEditReseller = async () => {
    setLoading(true);
    try {
      const { error: shopError } = await supabase.from('retail_shops').upsert({
        id: editForm.id,
        shop_name: editForm.shopName,
        level: editForm.level,
        product_limit: editForm.productLimit,
        star_rating: editForm.starRating,
        credit_score: editForm.creditScore
      }, { onConflict: 'id' });

      if (shopError) throw shopError;
      
      const { error: profileError } = await supabase.from('reseller_profiles').update({
        shop_name: editForm.shopName,
        level: editForm.level,
        updated_at: new Date().toISOString()
      }).eq('id', editForm.id);

      if (profileError) throw profileError;

      toast.success("Reseller updated successfully");
      queryClient.invalidateQueries({ queryKey: ["resellers"] });
      setEditDialogOpen(false);
    } catch (e) {
      console.error("Error updating reseller:", e);
      toast.error("Failed to update reseller");
    } finally {
      setLoading(false);
    }
  };

  const handleSendNotification = async () => {
    if (!notificationForm.message.trim()) {
      toast.error("Message cannot be empty");
      return;
    }
    setLoading(true);
    try {
      const gId = notificationForm.resellerIdNum ? `GRS-${notificationForm.resellerIdNum}` : "GRS";
      const { error } = await supabase.from('reseller_notifications').insert({
        reseller_id: notificationForm.resellerId,
        content: notificationForm.message,
        title: `System Notification for ${notificationForm.resellerName} (${gId})`,
        created_at: new Date().toISOString(),
        read: false,
        type: 'admin_alert'
      });
      
      if (error) throw error;

      toast.success(`Notification sent to ${notificationForm.resellerName}`);
      setNotificationDialogOpen(false);
    } catch (error) {
      console.error("[NOTIFICATION] Error sending notification:", error);
      toast.error("Failed to send notification");
    } finally {
      setLoading(false);
    }
  };

  const openEditDialog = (reseller: Reseller) => {
    setEditForm({
      id: reseller.id,
      shopName: reseller.shopName,
      level: reseller.level,
      productLimit: reseller.productLimit,
      starRating: reseller.starRating,
      creditScore: reseller.creditScore
    });
    setEditDialogOpen(true);
  };

  const handleResetPassword = async (reseller: Reseller) => {
    if (!window.confirm(`Are you sure you want to reset password for ${reseller.firstName} ${reseller.lastName} to "12345678"?`)) return;
    
    setLoading(true);
    try {
      const response = await fetch('/api/admin/reset-reseller-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resellerId: reseller.id }),
      });
      
      if (response.ok) {
        toast.success(`Password reset to 12345678 for ${reseller.firstName}`);
      } else {
        const data = await response.json();
        toast.error(data.error || "Failed to reset password");
      }
    } catch (e) {
      console.error(e);
      toast.error("An error occurred during password reset");
    } finally {
      setLoading(false);
    }
  };

  const handleFixMissingEmails = async () => {
    if (!confirm("Check and fix missing reseller emails based on users collection?")) return;
    setLoading(true);
    try {
      // Logic for Supabase
      const { data: profiles, error: profilesError } = await supabase.from('reseller_profiles').select('id, email');
      if (profilesError) throw profilesError;

      let count = 0;
      for (const profile of profiles) {
        if (!profile.email) {
          const { data: user, error: userError } = await supabase.from('users').select('email').eq('id', profile.id).single();
          if (!userError && user?.email) {
            await supabase.from('reseller_profiles').update({ email: user.email }).eq('id', profile.id);
            count++;
          }
        }
      }
      
      toast.success(`Fixed emails for ${count} resellers!`);
      queryClient.invalidateQueries({ queryKey: ["resellers"] });
    } catch (e) {
      console.error(e);
      toast.error("Failed to fix missing emails");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Retail-shops</h1>
          <p className="text-sm text-muted-foreground">
            Manage your network of resellers and retail partners.
          </p>
          {session?.role === 'Owner' && (
            <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-100 dark:border-blue-800 text-[10px] font-mono text-blue-700 dark:text-blue-300">
              DEBUG: Total Resellers: {resellers.length} | Filtered: {filtered.length} | CanSeeAll: {canSeeAll ? 'YES' : 'NO'}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button 
            variant="outline" 
            size="sm" 
            className="gap-1.5 h-8" 
            onClick={handleFixMissingEmails}
            disabled={loading}
          >
            Fix Emails
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            className="gap-1.5 h-8" 
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["resellers"] });
              toast.success("Refreshing data...");
            }}
          >
            <TrendingUp className="h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            className="gap-1.5 h-8" 
            onClick={async () => {
              if (!confirm("Are you sure you want to verify all unverified resellers?")) return;
              setLoading(true);
              try {
                const response = await fetch('/api/admin/verify-all', { method: 'POST' });
                if (!response.ok) throw new Error("Failed to verify all");
                const data = await response.json();
                toast.success(`Successfully verified ${data.count} resellers`);
                queryClient.invalidateQueries({ queryKey: ["resellers"] });
              } catch (e) {
                console.error(e);
                toast.error("An error occurred during verification");
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Verify All
          </Button>
          <Button size="sm" className="gap-1.5 h-8" onClick={() => setAddDialogOpen(true)}>
            <UserPlus className="h-3.5 w-3.5" />
            Add Reseller
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 w-full sm:w-72">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input 
          placeholder="Search resellers..." 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-transparent border-none outline-none text-sm w-full h-6 focus-visible:ring-0 p-0" 
        />
      </div>

      <Card className="border-none shadow-theme-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                {["Reseller", "Contact", "Shop Details", "Admin Member", "Referral ID", "Shop Level", "Product Limit", "Star Rating", "Credit Score", "Actions"].map((h) => (
                  <th key={h} className="text-left p-3.5 text-xs font-bold text-muted-foreground uppercase tracking-wider first:pl-5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-muted-foreground">No resellers found.</td>
                </tr>
              ) : (
                filtered.map((reseller) => (
                  <tr key={reseller.id} className={`hover:bg-accent/50 transition-colors ${reseller.isSuspended ? 'opacity-50 grayscale' : ''}`}>
                    <td className="p-3.5 pl-5">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs shrink-0">
                          {reseller.firstName[0]}{reseller.lastName[0]}
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-foreground">
                            {reseller.firstName} {reseller.lastName}
                            {reseller.isSuspended && (
                              <span className="ml-2 inline-flex items-center rounded border border-destructive/50 bg-destructive/10 px-1 py-0.5 text-[9px] font-bold text-destructive uppercase">
                                Suspended
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">GRS{reseller.resellerId}</span>
                        </div>
                      </div>
                    </td>
                    <td className="p-3.5">
                      <div className="flex flex-col gap-1">
                        {reseller.email && (
                          <div className="flex items-center gap-1.5 text-xs text-foreground">
                            <Mail className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="truncate max-w-[120px]" title={reseller.email}>{reseller.email}</span>
                          </div>
                        )}
                        {reseller.phone && (
                          <div className="flex items-center gap-1.5 text-xs text-foreground">
                            <Phone className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span>{reseller.phone}</span>
                          </div>
                        )}
                        {!reseller.email && !reseller.phone && (
                          <span className="text-xs text-muted-foreground italic">No contact</span>
                        )}
                      </div>
                    </td>
                    <td className="p-3.5">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 text-xs text-foreground font-medium">
                          <Store className="h-3 w-3 text-muted-foreground" />
                          {reseller.shopName}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          Main Office
                        </div>
                      </div>
                    </td>
                    <td className="p-3.5">
                      {(() => {
                        const admin = dbAdmins?.find(a => a.account_id === reseller.memberOfAdminId);
                        const staff = dbStaff?.find(s => s.id === reseller.referredBy || s.staff_id === reseller.referredBy);
                        const name = admin?.name || staff?.name || reseller.memberOfAdminId || t("admin.directRegistration");
                        return (
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-foreground">{name}</span>
                            {reseller.memberOfAdminId && (
                              <span className="text-[10px] text-muted-foreground font-mono">{reseller.memberOfAdminId}</span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="p-3.5">
                      <span className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono font-medium text-muted-foreground">
                        {reseller.referralId}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${vipColors[reseller.level] || vipColors["VIP-0"]}`}>
                        {reseller.level}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <div className="flex items-center gap-1.5 text-xs text-foreground">
                        <Package className="h-3 w-3 text-muted-foreground" />
                        {reseller.productLimit}
                      </div>
                    </td>
                    <td className="p-3.5">
                      <div className="flex items-center gap-1.5 text-xs text-foreground">
                        <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                        {reseller.starRating}
                      </div>
                    </td>
                    <td className="p-3.5">
                      <div className="flex items-center gap-1.5 text-xs text-foreground">
                        <ShieldCheck className="h-3 w-3 text-emerald-500" />
                        {reseller.creditScore}
                      </div>
                    </td>
                    <td className="p-3.5 pr-5">
                      <div className="flex items-center gap-1.5">
                        {reseller.hasRequestedPasswordReset && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-amber-500 bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/20 dark:hover:bg-amber-900/30 animate-pulse border border-amber-200 dark:border-amber-800"
                            onClick={() => handleResetPassword(reseller)}
                            title="Reset Password to 12345678"
                          >
                            <Key className="h-4 w-4" />
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="p-1.5 rounded-md hover:bg-accent transition-colors">
                              <MoreVertical className="h-4 w-4 text-muted-foreground" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem className="gap-2" onClick={() => openEditDialog(reseller)}>
                              Edit Shop
                            </DropdownMenuItem>
                            <DropdownMenuItem className="gap-2" onClick={() => handleResetPassword(reseller)}>
                              <Key className="h-4 w-4" />
                              Reset Password (12345678)
                            </DropdownMenuItem>
                            <DropdownMenuItem className="gap-2" onClick={() => {
                            setNotificationForm({
                              resellerId: reseller.id,
                              resellerIdNum: reseller.resellerId || "",
                              resellerName: `${reseller.firstName} ${reseller.lastName}`,
                              message: PREDEFINED_MESSAGE
                            });
                            setNotificationDialogOpen(true);
                          }}>
                            <Bell className="h-4 w-4" />
                            Send Notification
                          </DropdownMenuItem>
                          <DropdownMenuItem className="gap-2" onClick={() => window.open(getStorefrontUrl(reseller.shopSlug), "_blank")}>
                            View Shop
                          </DropdownMenuItem>
                          <DropdownMenuItem className="gap-2" onClick={() => handleResetUnpickedBalance(reseller.id)}>
                            <TrendingUp className="h-4 w-4" />
                            Reset Unpicked Balance
                          </DropdownMenuItem>
                          <DropdownMenuItem className="gap-2" onClick={() => handleSyncBalances(reseller.id, reseller.resellerId)}>
                            <TrendingUp className="h-4 w-4" />
                            Sync Order Balances
                          </DropdownMenuItem>
                          <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive" onClick={() => handleDeactivate(reseller.id, reseller.resellerId, !!reseller.isSuspended)}>
                            {reseller.isSuspended ? 'Reactivate' : 'Deactivate'}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Retail Shop</DialogTitle>
            <DialogDescription>Adjust shop settings and limits.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">Shop Name</label>
              <div className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-background">
                <Store className="h-4 w-4 text-muted-foreground" />
                <Input className="border-none p-0 h-auto" value={editForm.shopName} onChange={e => setEditForm({...editForm, shopName: e.target.value})} />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Shop Level</label>
                <select 
                  className="w-full flex items-center gap-2 border rounded-lg px-3 py-2 bg-background text-sm outline-none focus:ring-2 focus:ring-ring"
                  value={editForm.level}
                  onChange={(e) => {
                    const newLevel = e.target.value;
                    setEditForm({
                      ...editForm, 
                      level: newLevel,
                      productLimit: levelToProductLimit[newLevel] || editForm.productLimit
                    });
                  }}
                >
                  {Object.keys(vipColors).map(lvl => (
                    <option key={lvl} value={lvl}>{lvl}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Product Limit</label>
                <div className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-background">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <Input type="number" className="border-none p-0 h-auto" value={editForm.productLimit} onChange={e => setEditForm({...editForm, productLimit: parseInt(e.target.value) || 0})} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Star Rating</label>
                <div className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-background">
                  <Star className="h-4 w-4 text-amber-500" />
                  <Input type="number" step="0.1" min="0" max="5" className="border-none p-0 h-auto" value={editForm.starRating} onChange={e => setEditForm({...editForm, starRating: parseFloat(e.target.value) || 0})} />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Credit Score</label>
                <div className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-background">
                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                  <Input type="number" className="border-none p-0 h-auto" value={editForm.creditScore} onChange={e => setEditForm({...editForm, creditScore: parseInt(e.target.value) || 0})} />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleEditReseller} disabled={loading}>{loading ? "Updating..." : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Reseller</DialogTitle>
            <DialogDescription>Register a new reseller and their retail shop.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">First Name</label>
                <div className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-background">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <Input className="border-none p-0 h-auto" value={form.firstName} onChange={e => setForm({...form, firstName: e.target.value})} placeholder="John" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Last Name</label>
                <div className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-background">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <Input className="border-none p-0 h-auto" value={form.lastName} onChange={e => setForm({...form, lastName: e.target.value})} placeholder="Doe" />
                </div>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Email</label>
              <div className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-background">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <Input type="email" className="border-none p-0 h-auto" value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="you@example.com" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Password</label>
              <div className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-background">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <Input type="password" className="border-none p-0 h-auto" value={form.password} onChange={e => setForm({...form, password: e.target.value})} placeholder="••••••••" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Shop Name</label>
              <div className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-background">
                <Store className="h-4 w-4 text-muted-foreground" />
                <Input className="border-none p-0 h-auto" value={form.shopName} onChange={e => setForm({...form, shopName: e.target.value})} placeholder="My Awesome Store" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAddReseller} disabled={loading}>{loading ? "Creating..." : "Create Reseller"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={notificationDialogOpen} onOpenChange={setNotificationDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send Notification</DialogTitle>
            <DialogDescription>
              Send a direct notification to {notificationForm.resellerName}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">Message</label>
              <Textarea 
                className="mt-1.5 min-h-[120px]" 
                value={notificationForm.message} 
                onChange={e => setNotificationForm({...notificationForm, message: e.target.value})} 
                placeholder="Type your notification message here..."
              />
              <p className="text-xs text-muted-foreground mt-2">
                This will be sent directly to the reseller's notification center. They cannot reply to this message.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotificationDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSendNotification} disabled={loading}>
              {loading ? "Sending..." : "Send Notification"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
