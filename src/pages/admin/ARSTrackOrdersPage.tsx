import { useState, useMemo, useEffect, useCallback } from "react";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { useAdminLogger } from "@/hooks/use-admin-logger";
import { useUnifiedResellers } from "@/lib/unified-hooks";
import { supabase } from "@/lib/supabase";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  MoreHorizontal, Search, Archive, Trash2, Eye, CheckCircle,
  Star, Filter, ChevronLeft, ChevronRight, Clock, Truck
} from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useToast } from "@/hooks/use-toast";

/* ─── Types ─── */
import { OrderStatus } from "@/lib/types";

interface OrderRecord {
  id: string;
  orderId: string;
  resellerName: string;
  resellerId: string;
  resellerNumericId?: number;
  humanResellerId?: string;
  staffUsername: string;
  adminName: string;
  productCount: number;
  itemCount: number;
  totalCost: number;
  serviceCost: number;
  profit: number;
  status: OrderStatus;
  focused: boolean;
  createdAt: string;
  pickedUpAt?: string;
  completedAt?: string;
  referralId?: string;
  referredBy?: string;
  memberOfAdminId?: string;
}

/* ─── Status badge colors ─── */
function statusVariant(s: string) {
  switch (s) {
    case "Pending": return "outline" as const;
    case "Processing": return "secondary" as const;
    case "Ongoing": return "default" as const;
    case "Shipped": return "default" as const;
    case "Completed": return "default" as const;
    case "Cancelled": return "destructive" as const;
    default: return "outline" as const;
  }
}

function statusClass(s: string) {
  switch (s) {
    case "Completed": return "bg-emerald-600/20 text-emerald-400 border-emerald-600/30";
    case "Ongoing": return "bg-blue-600/20 text-blue-400 border-blue-600/30";
    case "Pending": return "bg-amber-600/20 text-amber-400 border-amber-600/30";
    case "Processing": return "bg-purple-600/20 text-purple-400 border-purple-600/30";
    case "Shipped": return "bg-indigo-600/20 text-indigo-400 border-indigo-600/30";
    case "Cancelled": return "bg-destructive/20 text-destructive border-destructive/30";
    default: return "bg-muted/50 text-muted-foreground/60";
  }
}

/* ─── Page size ─── */
const PAGE_SIZE = 15;
const PAGE_SIZE_FETCH = 50;

export default function ARSTrackOrdersPage() {
  const { toast } = useToast();
  const { canSeeAll, hasAccessToReseller } = useAdminAccess();
  const { logActivity } = useAdminLogger();
  const rawResellers = useUnifiedResellers();

  const allowedResellers = useMemo(() => {
    if (canSeeAll) return rawResellers;
    return rawResellers.filter(r => hasAccessToReseller(r));
  }, [rawResellers, canSeeAll, hasAccessToReseller]);

  const allowedResellerIds = useMemo(() => {
    const ids = new Set<string>();
    allowedResellers.forEach(r => {
      ids.add(String(r.id));
      if (r.resellerId) ids.add(`GRS${r.resellerId}`);
      ids.add(String(r.resellerId));
    });
    return ids;
  }, [allowedResellers]);

  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [fetchLimit, setFetchLimit] = useState(PAGE_SIZE_FETCH);

  const mapOrderData = (data: Record<string, unknown>) => {
    let statusStr = String(data.status || "Pending");
    statusStr = statusStr.charAt(0).toUpperCase() + statusStr.slice(1).toLowerCase();
    
    return {
      id: data.id,
      orderId: (data.order_id as string) || (data.order_number as string) || (data.orderId as string) || "N/A",
      resellerName: data.resellerName || "",
      resellerId: (data.resellerId as string) || (data.reseller_id as string) || "",
      resellerNumericId: data.resellerNumericId as number || data.reseller_numeric_id as number || (Array.isArray(data.reseller_profiles) ? data.reseller_profiles[0]?.reseller_id : data.reseller_profiles?.reseller_id) as number,
      humanResellerId: (data.human_reseller_id as string) || "",
      staffUsername: data.staffUsername || data.staff_username || "System",
      adminName: data.adminName || data.admin_username || "System",
      productCount: Number(data.products_count || 0),
      itemCount: Number(data.items_count || 0),
      totalCost: data.totalCost || data.total_cost || data.total_amount || 0,
      serviceCost: data.serviceCost || data.service_cost || 0,
      profit: data.profit || data.profits || 0,
      status: statusStr as OrderStatus,
      focused: data.focused || false,
      createdAt: data.createdAt || data.created_at,
      pickedUpAt: data.picked_up_at || data.pickedUpAt,
      completedAt: data.completed_at || data.completedAt,
      referralId: data.referralId || data.referral_id,
      referredBy: data.referredBy || data.referred_by_staff_id,
      memberOfAdminId: data.memberOfAdminId || data.member_of_admin_id,
    };
  };

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select("*, reseller_profiles(reseller_id)")
      .order("created_at", { ascending: false })
      .limit(fetchLimit);
    
    if (error) {
      console.error("Error fetching orders:", error);
    } else {
      const ordersData = data || [];
      
      // If reseller_profiles relationship didn't work (PostgREST issue without FK), fetch manually
      const missingNumericIds = ordersData.filter(o => 
        !o.resellerNumericId && !o.reseller_numeric_id && !(o.reseller_profiles?.reseller_id) && 
        (o.reseller_id || o.resellerId)
      );
      
      if (missingNumericIds.length > 0) {
        const uuids = missingNumericIds.map(o => o.reseller_id || o.resellerId);
        const { data: profiles } = await supabase
          .from('reseller_profiles')
          .select('id, reseller_id')
          .in('id', uuids);
          
        if (profiles && profiles.length > 0) {
          ordersData.forEach(o => {
            const uuid = o.reseller_id || o.resellerId;
            const profile = profiles.find(p => p.id === uuid);
            if (profile && profile.reseller_id) {
              o.reseller_numeric_id = profile.reseller_id;
            }
          });
        }
      }

      setOrders(ordersData.map(mapOrderData));
      setHasMore(ordersData.length >= fetchLimit);
    }
    setLoading(false);
  }, [fetchLimit]);

  useEffect(() => {
    fetchOrders();

    const channel = supabase
      .channel('orders_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        fetchOrders();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchOrders]);

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    setFetchLimit(prev => prev + PAGE_SIZE_FETCH);
    setTimeout(() => setLoadingMore(false), 500);
  }, [hasMore, loadingMore]);

  const [search, setSearch] = useState("");
  const [resellerSearch, setResellerSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [viewOrder, setViewOrder] = useState<OrderRecord | null>(null);

  /* ─── Filtering ─── */
  const filtered = useMemo(() => {
    let list = orders.filter((o) => {
      if (canSeeAll) return true;
      return allowedResellerIds.has(o.resellerId);
    });

    if (statusFilter !== "all") list = list.filter((o) => o.status === statusFilter);
    if (resellerSearch.trim()) {
      const q = resellerSearch.toLowerCase();
      list = list.filter((o) => 
        (o.resellerId || "").toLowerCase().includes(q) || 
        (o.resellerNumericId && String(o.resellerNumericId).toLowerCase().includes(q))
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (o) =>
          (o.orderId || "").toLowerCase().includes(q) ||
          (o.resellerName || "").toLowerCase().includes(q) ||
          (o.staffUsername || "").toLowerCase().includes(q) ||
          (o.adminName || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [orders, search, resellerSearch, statusFilter, canSeeAll, allowedResellerIds]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  /* ─── Bulk selections ─── */
  const allPageSelected = paged.length > 0 && paged.every((o) => selectedIds.has(o.id));
  const toggleAll = () => {
    const next = new Set(selectedIds);
    if (allPageSelected) paged.forEach((o) => next.delete(o.id));
    else paged.forEach((o) => next.add(o.id));
    setSelectedIds(next);
  };
  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  /* ─── Actions ─── */
  const archiveOrder = async (id: string) => {
    try {
      await supabase.from("orders").update({ status: "Archived", updated_at: new Date().toISOString() }).eq("id", id);
      logActivity("DATA_UPDATE", "Track & Manage Orders", `Archived order ${id}`);
      toast({ title: "Order archived" });
    } catch (error) {
      logActivity("ERROR", "Track & Manage Orders", `Failed to archive order ${id}`);
      toast({ title: "Failed to archive order", variant: "destructive" });
    }
  };

  const deleteOrder = async (id: string) => {
    try {
      const { data: orderData, error: fetchError } = await supabase.from("orders").select("*").eq("id", id).single();
      if (fetchError || !orderData) throw new Error("Order not found");

      const resellerId = orderData.reseller_id || orderData.resellerId;
      const totalCost = Number(orderData.total_cost || orderData.total_amount || 0);
      const status = (orderData.status || "Pending").toLowerCase();
      
      if (resellerId) {
        const { data: profile } = await supabase.from('reseller_profiles').select('*').eq('id', resellerId).single();
        if (profile) {
          const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
          if (status === "pending" || status === "processing") {
            updatePayload.unpicked_balance = (profile.unpicked_balance || 0) - totalCost;
          } else if (status === "ongoing" || status === "shipped") {
            updatePayload.pending_balance = (profile.pending_balance || 0) - totalCost;
          }
          if (Object.keys(updatePayload).length > 1) {
            await supabase.from('reseller_profiles').update(updatePayload).eq('id', resellerId);
          }
        }
      }

      await supabase.from("orders").delete().eq("id", id);
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      logActivity("DATA_DELETE", "Track & Manage Orders", `Deleted order ${id}`);
      toast({ title: "Order deleted and pending balance updated" });
    } catch (error) {
      console.error("Error deleting order:", error);
      logActivity("ERROR", "Track & Manage Orders", `Failed to delete order ${id}`);
      toast({ title: "Failed to delete order", variant: "destructive" });
    }
  };

  const toggleFocus = async (id: string, current: boolean) => {
    try {
      await supabase.from("orders").update({ focused: !current, updated_at: new Date().toISOString() }).eq("id", id);
      toast({ title: "Focus toggled" });
    } catch (error) {
      toast({ title: "Failed to toggle focus", variant: "destructive" });
    }
  };

  const updateStatus = async (id: string, status: OrderStatus) => {
    const originalOrders = [...orders];
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status } : o));

    try {
      const { data: orderData, error: fetchError } = await supabase.from("orders").select("*").eq("id", id).single();
      if (fetchError || !orderData) {
        logActivity("ERROR", "Track & Manage Orders", `Order not found when updating status for ${id}`);
        toast({ title: "Order not found", variant: "destructive" });
        setOrders(originalOrders);
        return;
      }
      
      const oldStatus = String(orderData.status || "Pending").toLowerCase();
      const newStatus = status;
      const resellerId = orderData.reseller_id || orderData.resellerId;
      const totalCost = Number(orderData.total_cost || orderData.total_amount || 0);
      const profit = Number(orderData.profits || 0);
      const serviceCost = Number(orderData.service_cost || 0);

      if (resellerId) {
        const { data: profile } = await supabase.from('reseller_profiles').select('*').eq('id', resellerId).single();
        if (profile) {
          const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };

          if ((newStatus === "Ongoing" || newStatus === "Shipped") && (oldStatus === "pending" || oldStatus === "processing")) {
            updatePayload.unpicked_balance = (profile.unpicked_balance || 0) - totalCost;
            updatePayload.pending_balance = (profile.pending_balance || 0) + totalCost;
            updatePayload.balance = (profile.balance || 0) - serviceCost;
          } 
          else if (newStatus === "Completed" && (oldStatus === "ongoing" || oldStatus === "shipped" || oldStatus === "processing" || oldStatus === "pending")) {
            if (oldStatus === "ongoing" || oldStatus === "shipped") {
              updatePayload.pending_balance = (profile.pending_balance || 0) - totalCost;
              updatePayload.balance = (profile.balance || 0) + totalCost;
            } else {
              updatePayload.unpicked_balance = (profile.unpicked_balance || 0) - totalCost;
              updatePayload.balance = (profile.balance || 0) + profit;
            }
            updatePayload.total_earnings = (profile.total_earnings || 0) + profit;
          }
          else if (newStatus === "Cancelled" && oldStatus !== "cancelled") {
            if (oldStatus === "pending" || oldStatus === "processing") {
              updatePayload.unpicked_balance = (profile.unpicked_balance || 0) - totalCost;
            } else if (oldStatus === "ongoing" || oldStatus === "shipped") {
              updatePayload.pending_balance = (profile.pending_balance || 0) - totalCost;
              updatePayload.balance = (profile.balance || 0) + serviceCost;
            }
          }

          if (Object.keys(updatePayload).length > 1) {
            await supabase.from('reseller_profiles').update(updatePayload).eq('id', resellerId);
          }
        }
      }

      const updateData: Record<string, unknown> = { status: newStatus, updated_at: new Date().toISOString() };
      if (newStatus === "Completed" && oldStatus !== "completed") {
        updateData.completed_at = new Date().toISOString();
      } else if (newStatus === "Ongoing" && (oldStatus === "pending" || oldStatus === "processing")) {
        updateData.picked_up_at = new Date().toISOString();
      }

      await supabase.from("orders").update(updateData).eq("id", id);
      logActivity("DATA_UPDATE", "Track & Manage Orders", `Updated order ${id} status to ${newStatus}`);
      toast({ title: `Order marked as ${(newStatus || "").toLowerCase()}` });
    } catch (error) {
      console.error("Error updating status:", error);
      logActivity("ERROR", "Track & Manage Orders", `Failed to update status for order ${id}`);
      toast({ title: "Failed to update status", variant: "destructive" });
      setOrders(originalOrders);
    }
  };

  /* Bulk actions */
  const bulkArchive = async () => {
    try {
      const promises = Array.from(selectedIds).map(id => 
        supabase.from("orders").update({ status: "Archived", updated_at: new Date().toISOString() }).eq("id", id)
      );
      await Promise.all(promises);
      logActivity("DATA_UPDATE", "Track & Manage Orders", `Bulk archived orders`);
      toast({ title: `${selectedIds.size} orders archived` });
      setSelectedIds(new Set());
    } catch (e) {
      console.error(e);
      logActivity("ERROR", "Track & Manage Orders", `Failed to bulk archive orders`);
      toast({ title: "Failed to archive orders", variant: "destructive" });
    }
  };

  const bulkDelete = async () => {
    try {
      const batchPromises = Array.from(selectedIds).map(async (id) => {
        const { data: orderData, error: fetchError } = await supabase.from("orders").select("*").eq("id", id).single();
        if (fetchError || !orderData) return;

        const resellerId = orderData.reseller_id || orderData.resellerId;
        const totalCost = Number(orderData.total_cost || orderData.total_amount || 0);
        const status = (orderData.status || "Pending").toLowerCase();

        if (resellerId) {
          const { data: profile } = await supabase.from('reseller_profiles').select('*').eq('id', resellerId).single();
          if (profile) {
            const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
            if (status === "pending" || status === "processing") {
              updatePayload.unpicked_balance = (profile.unpicked_balance || 0) - totalCost;
            } else if (status === "ongoing" || status === "shipped") {
              updatePayload.pending_balance = (profile.pending_balance || 0) - totalCost;
            }
            if (Object.keys(updatePayload).length > 1) {
              await supabase.from('reseller_profiles').update(updatePayload).eq('id', resellerId);
            }
          }
        }
        await supabase.from("orders").delete().eq("id", id);
      });
      await Promise.all(batchPromises);
      logActivity("DATA_DELETE", "Track & Manage Orders", `Bulk deleted orders`);
      toast({ title: `${selectedIds.size} orders deleted and balances adjusted` });
      setSelectedIds(new Set());
    } catch (e) {
      console.error(e);
      logActivity("ERROR", "Track & Manage Orders", `Failed to bulk delete orders`);
      toast({ title: "Failed to delete orders", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      {/* Breadcrumb / Header */}
      <div>
        <p className="text-xs text-muted-foreground mb-1">ARS Management &gt; Track &amp; Manage Orders</p>
        <h1 className="text-2xl font-bold text-foreground">Track &amp; Manage Orders</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monitor reseller orders, follow up on pending items, and manage the order lifecycle.
        </p>
      </div>

      {/* Order Status Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 flex flex-col items-start justify-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-amber-600 mb-1">Pending</span>
          <span className="text-2xl font-bold text-amber-600">
            {orders.filter((o) => o.status === "Pending").length}
          </span>
        </div>
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 flex flex-col items-start justify-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-blue-600 mb-1">Ongoing</span>
          <span className="text-2xl font-bold text-blue-600">
            {orders.filter((o) => o.status === "Ongoing").length}
          </span>
        </div>
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 flex flex-col items-start justify-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 mb-1">Completed</span>
          <span className="text-2xl font-bold text-emerald-600">
            {orders.filter((o) => o.status === "Completed").length}
          </span>
        </div>
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 flex flex-col items-start justify-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-destructive mb-1">Cancelled</span>
          <span className="text-2xl font-bold text-destructive">
            {orders.filter((o) => o.status === "Cancelled").length}
          </span>
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by Order ID, Staff or Admin..."
            className="pl-9 bg-background"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>

        {/* Reseller Search */}
        <div className="relative w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Reseller ID (e.g. GRS25031)"
            className="pl-9 bg-background"
            value={resellerSearch}
            onChange={(e) => { setResellerSearch(e.target.value); setPage(1); }}
          />
        </div>

        {/* Status filter */}
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[170px] bg-background">
            <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="Pending">Pending</SelectItem>
            <SelectItem value="Processing">Processing</SelectItem>
            <SelectItem value="Ongoing">Ongoing</SelectItem>
            <SelectItem value="Shipped">Shipped</SelectItem>
            <SelectItem value="Completed">Completed</SelectItem>
            <SelectItem value="Cancelled">Cancelled</SelectItem>
            <SelectItem value="Archived">Archived</SelectItem>
          </SelectContent>
        </Select>

        {/* Bulk actions */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-muted-foreground">{selectedIds.size} selected</span>
            <Button variant="outline" size="sm" onClick={bulkArchive}>
              <Archive className="h-4 w-4 mr-1" /> Archive
            </Button>
            <Button variant="destructive" size="sm" onClick={bulkDelete}>
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
          </div>
        )}
      </div>

      {/* Reseller Subtotal Summary */}
      {resellerSearch.trim() && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 flex flex-wrap gap-6 items-center">
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Reseller Summary</span>
            <span className="text-sm font-medium">{resellerSearch.toUpperCase()}</span>
          </div>
          <div className="h-8 w-px bg-border hidden sm:block"></div>
          <div className="flex gap-6 flex-wrap">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Completed Orders</span>
              <span className="text-sm font-semibold text-emerald-600">{filtered.filter(o => o.status === 'Completed').length}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Ongoing Orders</span>
              <span className="text-sm font-semibold text-blue-600">{filtered.filter(o => o.status === 'Ongoing').length}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Pending Orders</span>
              <span className="text-sm font-semibold text-amber-600">{filtered.filter(o => o.status === 'Pending').length}</span>
            </div>
            <div className="h-8 w-px bg-border hidden sm:block"></div>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Total Cost</span>
              <span className="text-sm font-semibold">${filtered.reduce((sum, o) => sum + o.totalCost, 0).toFixed(2)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Total Profit</span>
              <span className="text-sm font-semibold text-emerald-600">${filtered.reduce((sum, o) => sum + o.profit, 0).toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={toggleAll}
                  className="rounded border-border"
                />
              </TableHead>
              <TableHead className="whitespace-nowrap">Order ID</TableHead>
              <TableHead className="whitespace-nowrap">Reseller ID</TableHead>
              <TableHead className="whitespace-nowrap">Staff</TableHead>
              <TableHead className="whitespace-nowrap">Admin</TableHead>
              <TableHead className="whitespace-nowrap text-center">Products</TableHead>
              <TableHead className="whitespace-nowrap text-center">Counts</TableHead>
              <TableHead className="whitespace-nowrap text-right">Total Cost</TableHead>
              <TableHead className="whitespace-nowrap text-right">Service Cost</TableHead>
              <TableHead className="whitespace-nowrap text-right">Profits</TableHead>
              <TableHead className="whitespace-nowrap">Creation Date</TableHead>
              <TableHead className="whitespace-nowrap">Picked Up Date</TableHead>
              <TableHead className="whitespace-nowrap">Completed Date</TableHead>
              <TableHead className="whitespace-nowrap">Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={15} className="text-center py-12">
                  <LoadingSpinner size={32} />
                </TableCell>
              </TableRow>
            ) : paged.length === 0 ? (
              <TableRow>
                <TableCell colSpan={15} className="text-center py-12 text-muted-foreground">
                  No orders found.
                </TableCell>
              </TableRow>
            ) : (
              paged.map((order) => (
                <TableRow
                  key={order.id}
                  className={order.focused ? "bg-primary/5 border-l-2 border-l-primary" : ""}
                >
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(order.id)}
                      onChange={() => toggleOne(order.id)}
                      className="rounded border-border"
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap">
                    {order.focused && <Star className="inline h-3 w-3 text-primary mr-1" />}
                    {order.orderId}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-[#009000] whitespace-nowrap">
                    {order.resellerNumericId ? `GRS${order.resellerNumericId}` : (order.humanResellerId || order.resellerId)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{order.staffUsername}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{order.adminName}</TableCell>
                  <TableCell className="text-center">{order.productCount}</TableCell>
                  <TableCell className="text-center">{order.itemCount}</TableCell>
                  <TableCell className="text-right font-mono">${order.totalCost.toFixed(2)}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">${order.serviceCost.toFixed(2)}</TableCell>
                  <TableCell className="text-right font-mono text-emerald-500">${order.profit.toFixed(2)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {order.createdAt ? new Date(order.createdAt).toLocaleDateString() : "-"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {order.pickedUpAt ? new Date(order.pickedUpAt).toLocaleDateString() : "-"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {order.completedAt ? new Date(order.completedAt).toLocaleDateString() : "-"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(order.status)} className={statusClass(order.status)}>
                      {order.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem onClick={() => setViewOrder(order)}>
                          <Eye className="h-4 w-4 mr-2" /> View Details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => toggleFocus(order.id, order.focused)}>
                          <Star className="h-4 w-4 mr-2" />
                          {order.focused ? "Remove Focus" : "Mark as Focus"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => updateStatus(order.id, "Ongoing")}>
                          <Clock className="h-4 w-4 mr-2" /> Mark Ongoing
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => updateStatus(order.id, "Shipped")}>
                          <Truck className="h-4 w-4 mr-2" /> Mark Shipped
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => updateStatus(order.id, "Completed")}>
                          <CheckCircle className="h-4 w-4 mr-2" /> Mark Completed
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => updateStatus(order.id, "Cancelled")}>
                          <Trash2 className="h-4 w-4 mr-2" /> Cancel Order
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => archiveOrder(order.id)}>
                          <Archive className="h-4 w-4 mr-2" /> Archive
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => deleteOrder(order.id)}>
                          <Trash2 className="h-4 w-4 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {(hasMore || loadingMore) && (
          <div className="p-4 border-t border-border flex justify-center bg-muted/20">
            <Button
              variant="outline"
              size="sm"
              onClick={loadMore}
              disabled={loadingMore}
              className="text-xs h-8 px-8 gap-2"
            >
              {loadingMore && <LoadingSpinner size={14} />}
              {loadingMore ? "Loading..." : "Load More Orders"}
            </Button>
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{filtered.length} orders total</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span>Page {page} of {totalPages}</span>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* View Details Dialog */}
      <Dialog open={!!viewOrder} onOpenChange={(o) => !o && setViewOrder(null)}>
        <DialogContent className="max-w-md">
          <DialogTitle>Order Details — {viewOrder?.orderId}</DialogTitle>
          <DialogHeader>
            <DialogDescription>Full breakdown of order information.</DialogDescription>
          </DialogHeader>
          {viewOrder && (
            <div className="space-y-3 text-sm">
              <Row label="Reseller ID" value={viewOrder.resellerNumericId ? `GRS${viewOrder.resellerNumericId}` : (viewOrder.humanResellerId || viewOrder.resellerId)} />
              <Row label="Reseller Name" value={viewOrder.resellerName} />
              <Row label="Staff" value={viewOrder.staffUsername} />
              <Row label="Admin" value={viewOrder.adminName} />
              <Row label="Products" value={String(viewOrder.productCount)} />
              <Row label="Item Counts" value={String(viewOrder.itemCount)} />
              <Row label="Total Cost" value={`$${viewOrder.totalCost.toFixed(2)}`} />
              <Row label="Service Cost" value={`$${viewOrder.serviceCost.toFixed(2)}`} />
              <Row label="Profit" value={`$${viewOrder.profit.toFixed(2)}`} />
              <Row label="Status" value={viewOrder.status} />
              <Row label="Created" value={viewOrder.createdAt ? new Date(viewOrder.createdAt).toLocaleDateString() : "-"} />
              <Row label="Picked Up" value={viewOrder.pickedUpAt ? new Date(viewOrder.pickedUpAt).toLocaleDateString() : "-"} />
              <Row label="Completed" value={viewOrder.completedAt ? new Date(viewOrder.completedAt).toLocaleDateString() : "-"} />
              <Row label="Focus" value={viewOrder.focused ? "Yes ⭐" : "No"} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewOrder(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-border pb-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
