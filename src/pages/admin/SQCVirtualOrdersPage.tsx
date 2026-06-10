import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useProducts } from "@/lib/products-context-hooks";
import { useUpdateOrderStatus } from "@/hooks/use-orders";
import { STATIC_VIRTUAL_PROFILES } from "@/data/virtualProfiles";
import { LEVEL_PROFIT_MAP } from "@/lib/reseller-context-hooks";
import { useAdminAuth } from "@/lib/admin-auth-context-hooks";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { useUnifiedResellers } from "@/lib/unified-hooks";
import { cn, parseImageUrl, getProductPlaceholder, getRawImageUrl, handleImageError } from "@/lib/utils";
import {
  ChevronDown, ChevronUp, MoreHorizontal, UserCheck,
  Search, ShoppingBag, Plus, Minus, Trash2, Send, Package,
  Circle, X,
} from "lucide-react";
import { Product, Order, OrderStatus } from "@/lib/types";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

interface VirtualProfile {
  id: string;
  name: string;
  email: string;
  shipping_address: string;
  region: string;
  status: string;
}

interface ResellerSession {
  id: string;
  reseller_id: string;
  reseller_name: string;
  reseller_avatar: string;
  is_online: boolean;
  last_message_at: string;
  level?: string;
  resellerId?: number;
  staffName?: string;
  adminMember?: string;
}

interface CartItem {
  productId: string;
  name: string;
  image: string;
  price: number;
  qty: number;
}

interface VirtualOrder {
  id: string;
  orderId: string;
  profileName: string;
  resellerName: string;
  resellerId: string;
  items: CartItem[];
  totalCost: number;
  serviceCost: number;
  profit: number;
  status: OrderStatus;
  createdAt: string;
  shippingAddress: string;
  referralId?: string;
  referredBy?: string;
  memberOfAdminId?: string;
}

const orderCounter = 1000;

export default function SQCVirtualOrdersPage() {
  const { session } = useAdminAuth();
  const { isOwner, isAdmin, isStaff, allowedAdminIds, allowedStaffIds, allowedReferralIds, allowedStaffDocIds, canSeeAll } = useAdminAccess();
  const resellers = useUnifiedResellers();
  const [profiles, setProfiles] = useState<VirtualProfile[]>(STATIC_VIRTUAL_PROFILES);
  const [realUsers, setRealUsers] = useState<Record<string, unknown>[]>([]);
  const [useRealUsers, setUseRealUsers] = useState(false);
  const [tableOpen, setTableOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [resellerSearch, setResellerSearch] = useState("");
  const [selectedProfile, setSelectedProfile] = useState<VirtualProfile | null>(null);
  const [editProfile, setEditProfile] = useState<VirtualProfile | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // Reseller panel
  const [resellerSessions, setResellerSessions] = useState<ResellerSession[]>([]);
  const [activeReseller, setActiveReseller] = useState<ResellerSession | null>(null);

  // Cart & Orders
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orders, setOrders] = useState<VirtualOrder[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [orderHistoryOpen, setOrderHistoryOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { products } = useProducts();
  const updateStatusMutation = useUpdateOrderStatus();

  // Fetch selected products for the active reseller
  useEffect(() => {
    if (!activeReseller) {
      setSelectedProductIds([]);
      return;
    }

    const fetchSelection = async () => {
      try {
        const { data, error } = await supabase
          .from("reseller_product_selection")
          .select("product_id")
          .eq("reseller_id", activeReseller.reseller_id);
        
        if (error) throw error;
        const ids = (data || []).map(row => row.product_id);
        console.log(`[SQC_VIRTUAL_ORDER] Fetched ${ids.length} selected products for reseller ${activeReseller.reseller_id}`);
        setSelectedProductIds(ids);
      } catch (error) {
        console.error("Error fetching reseller product selection:", error);
      }
    };

    fetchSelection();
  }, [activeReseller]);

  // Fetch profiles
  const fetchProfiles = useCallback(async () => {
    setProfiles(STATIC_VIRTUAL_PROFILES);
    try {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      
      if (error) throw error;
      setRealUsers(data || []);
    } catch (error) {
      console.error("Error fetching real users:", error);
    }
  }, []);

  // Fetch reseller sessions
  const fetchResellerSessions = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("reseller_chat_sessions")
        .select("*")
        .order("last_message_at", { ascending: false })
        .limit(50);
      
      if (error) throw error;
      
      const sessions = (data || [])
        .map(s => ({ ...s, reseller_avatar: s.reseller_avatar || "" } as ResellerSession))
        .filter(s => s.reseller_name !== "Ahmad Fauzi" && s.reseller_name !== "Maria Santos");
      setResellerSessions(sessions);
    } catch (error) {
      console.error("Error fetching reseller sessions:", error);
    }
  }, []);

  // Fetch cart & orders
  const fetchOrders = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("orders")
        .select("*, order_items(*)")
        .order("created_at", { ascending: false })
        .limit(100);
      
      if (error) throw error;
      
      const fetchedOrders = (data || []).map((orderData) => {
        const itemsList = Array.isArray(orderData.items) && orderData.items.length > 0 ? orderData.items : (Array.isArray(orderData.order_items) ? orderData.order_items : []);
        const items = itemsList.map((d: Record<string, unknown>) => ({
          productId: String(d.productId || d.product_id || ''),
          name: String(d.name || 'Unknown Product'),
          image: d.image || '',
          price: Number(d.price || d.price_at_time || 0),
          qty: Number(d.qty || d.quantity || 0)
        }));

        let status: OrderStatus = "Pending";
        const dbStatus = String(orderData.status || "").toLowerCase();
        if (dbStatus === "ongoing" || dbStatus === "shipped") status = "Ongoing";
        else if (dbStatus === "completed" || dbStatus === "delivered") status = "Completed";
        else if (dbStatus === "cancelled") status = "Cancelled";

        return {
          id: orderData.id,
          orderId: orderData.orderId || orderData.id,
          profileName: orderData.profileName || 'Unknown',
          resellerName: orderData.resellerName || 'Unknown',
          resellerId: orderData.resellerId || '',
          items,
          totalCost: Number(orderData.total_cost || orderData.total_amount || 0),
          serviceCost: Number(orderData.service_cost || 0),
          profit: Number(orderData.profits || 0),
          status,
          createdAt: orderData.created_at || '',
          shippingAddress: orderData.shippingAddress || '',
          referralId: orderData.referralId || '',
          referredBy: orderData.referredBy || '',
          memberOfAdminId: orderData.memberOfAdminId || '',
        } as VirtualOrder;
      });

      setOrders(fetchedOrders);
    } catch (error) {
      console.error("Error fetching orders:", error);
    }
  }, []);

  const filteredOrders = useMemo(() => {
    let list = orders || [];

    const allowedResellerIds = new Set<string>();
    if (!canSeeAll) {
      const allowedResellers = resellers.filter(r => {
        const referredBy = r.referredBy;
        return (referredBy && (
          allowedReferralIds.includes(String(referredBy)) || 
          allowedStaffIds.includes(String(referredBy)) || 
          allowedStaffDocIds.includes(String(referredBy))
        ));
      });
      allowedResellers.forEach(r => {
        allowedResellerIds.add(String(r.id));
        allowedResellerIds.add(`GRS${r.resellerId}`);
      });
      
      list = list.filter((o) => allowedResellerIds.has(String(o.resellerId)));
    }
    return list;
  }, [orders, canSeeAll, resellers, allowedReferralIds, allowedStaffIds, allowedStaffDocIds]);

  useEffect(() => { fetchProfiles(); fetchResellerSessions(); fetchOrders(); }, [fetchProfiles, fetchResellerSessions, fetchOrders]);

  // Select profile
  const handleSelectProfile = async (profile: VirtualProfile) => {
    try {
      await supabase
        .from("virtual_customer_profiles")
        .update({ status: "Busy" })
        .eq("id", profile.id);
    } catch (e) {
      console.warn("Could not update virtual profile status in DB", e);
    }
    setSelectedProfile({ ...profile, status: "Busy" });
    setTableOpen(false);
    fetchProfiles();
  };

  // Deselect profile
  const handleDeselectProfile = async () => {
    if (selectedProfile) {
      try {
        await supabase
          .from("virtual_customer_profiles")
          .update({ status: "Available" })
          .eq("id", selectedProfile.id);
      } catch (e) {
        console.warn("Could not update virtual profile status in DB", e);
      }
    }
    setSelectedProfile(null);
    setActiveReseller(null);
    setCart([]);
    setTableOpen(true);
    fetchProfiles();
  };

  const handleDeleteProfile = async (id: string) => {
    try {
      await supabase.from("virtual_customer_profiles").delete().eq("id", id);
    } catch (e) {
      console.warn("Could not delete virtual profile from DB", e);
    }
    fetchProfiles();
  };

  const handleEditSave = async () => {
    if (!editProfile) return;
    try {
      await supabase
        .from("virtual_customer_profiles")
        .update({
          name: editProfile.name,
          email: editProfile.email,
          shipping_address: editProfile.shipping_address,
          region: editProfile.region,
        })
        .eq("id", editProfile.id);
    } catch (e) {
      console.warn("Could not update virtual profile in DB", e);
    }
    setEditDialogOpen(false);
    setEditProfile(null);
    fetchProfiles();
  };

  // Cart logic
  const addToCart = (product: { id: string; name: string; image: string; price: number }) => {
    const cleanImage = getRawImageUrl(parseImageUrl(product.image));
    setCart((prev) => {
      const existing = prev.find((c) => c.productId === product.id);
      if (existing) {
        return prev.map((c) => c.productId === product.id ? { ...c, qty: c.qty + 1 } : c);
      }
      return [...prev, { productId: product.id, name: product.name, image: cleanImage, price: product.price, qty: 1 }];
    });
  };

  const updateQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => c.productId === productId ? { ...c, qty: c.qty + delta } : c)
        .filter((c) => c.qty > 0)
    );
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((c) => c.productId !== productId));
  };

  const cartTotal = cart.reduce((sum, c) => sum + c.price * c.qty, 0);
  const cartCount = cart.reduce((sum, c) => sum + c.qty, 0);

  // Submit order
  const submitOrder = async () => {
    if (!selectedProfile || !activeReseller || cart.length === 0) {
      toast.error("Please select a customer, add products, and select an active reseller.");
      return;
    }
    
    setSubmitting(true);
    try {
      // 1. Fetch reseller data
      const { data: resellerData, error: resellerError } = await supabase
        .from("reseller_profiles")
        .select("*")
        .eq("id", activeReseller.reseller_id)
        .single();
      
      if (resellerError || !resellerData) throw new Error("Reseller not found");

      // Generate a more unique Order ID
      const timestamp = Date.now().toString().slice(-6);
      const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      const orderId = `VO-${timestamp}${random}`;
      
      const totalCost = cartTotal;

      if (totalCost <= 0) {
        toast.error("Cannot place an order with zero amount.");
        setSubmitting(false);
        return;
      }
      
      let margin = 0.80; 
      if (activeReseller.level === 'VIP-1') margin = 0.75;
      else if (activeReseller.level === 'VIP-2') margin = 0.70;
      else if (activeReseller.level === 'VIP-3') margin = 0.65;
      
      const serviceCost = Number((totalCost * margin).toFixed(2));
      const profit = Number((totalCost - serviceCost).toFixed(2));

      // 2. Save to orders table
      const orderData = {
        id: orderId,
        order_number: orderId,
        user_id: selectedProfile.id,
        customer_name: selectedProfile.name,
        profile_name: selectedProfile.name,
        reseller_name: activeReseller.reseller_name,
        reseller_id: activeReseller.reseller_id,
        staff_username: activeReseller.staffName || "System",
        admin_username: activeReseller.adminMember || "System",
        total_amount: totalCost,
        total_cost: totalCost,
        service_cost: serviceCost,
        profit: profit,
        status: "Pending",
        focused: false,
        created_at: new Date().toISOString(),
        shipping_address: selectedProfile.shipping_address,
        referral_id: resellerData.referral_id || resellerData.referral_code || "",
        referred_by_staff_id: resellerData.referred_by_staff_id || resellerData.referredBy || session?.accountId || "",
        member_of_admin_id: resellerData.member_of_admin_id || resellerData.memberOfAdminId || session?.uid || "",
        items_count: cart.reduce((sum, item) => sum + item.qty, 0),
        products_count: cart.length,
        order_items: cart.map(item => ({
          productId: item.productId,
          name: item.name,
          image: item.image,
          price: item.price,
          qty: item.qty,
          quantity: item.qty
        }))
      };

      console.log("[VIRTUAL_ORDER] Submitting order:", orderData);
      const { error: orderInsertError } = await supabase
        .from("orders")
        .insert(orderData);
      
      if (orderInsertError) throw orderInsertError;
      console.log("[VIRTUAL_ORDER] Order created with ID:", orderId);

      // 3. Create order_items
      const orderItems = cart.map(item => ({
        order_id: orderId,
        product_id: item.productId,
        name: item.name,
        image: item.image,
        price_at_time: item.price,
        quantity: item.qty,
        created_at: new Date().toISOString()
      }));

      const { error: itemsError } = await supabase.from("order_items").insert(orderItems);
      if (itemsError) console.error("Error creating order items:", itemsError);

      // 4. Update Reseller Balance and Stats
      if (activeReseller.reseller_id) {
        const { error: balanceError } = await supabase
          .from("reseller_profiles")
          .update({
            unpicked_balance: (resellerData.unpicked_balance || 0) + totalCost,
            total_orders: (resellerData.total_orders || 0) + 1,
            updated_at: new Date().toISOString()
          })
          .eq("id", activeReseller.reseller_id);
        
        if (balanceError) console.error("Error updating reseller balance:", balanceError);
      }

      toast.success(`Order ${orderId} created successfully!`);
      setCart([]);
      setTableOpen(true);
      fetchOrders();
    } catch (error) {
      console.error("[VIRTUAL_ORDER] Error submitting order:", error);
      toast.error("Failed to create order. Check console for details.");
    } finally {
      setSubmitting(false);
    }
  };

  const updateOrderStatus = async (orderId: string, status: string) => {
    try {
      await updateStatusMutation.mutateAsync({ orderId, status: status as OrderStatus });
      setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status: status as OrderStatus } : o));
      toast.success(`Order status updated to ${status}`);
    } catch (error) {
      console.error("Error updating status:", error);
      toast.error("Failed to update status");
    }
  };

  const filteredResellerSessions = useMemo(() => {
    const list = resellerSessions || [];
    
    // Enrich sessions with unified reseller data for better searching
    let enrichedList = list.map(session => {
      const profile = resellers.find(r => r.id === session.reseller_id);
      return {
        ...session,
        shop_name: profile?.shopName || "",
        numeric_id: profile?.resellerId?.toString() || "",
        full_name: profile ? `${profile.firstName} ${profile.lastName}` : session.reseller_name,
        referralId: profile?.referralId || "",
        referredBy: profile?.referredBy || "",
        memberOfAdminId: profile?.memberOfAdminId || ""
      };
    });

    if (!canSeeAll) {
      enrichedList = enrichedList.filter(s => 
        (s.referredBy && (allowedStaffIds.includes(String(s.referredBy)) || allowedStaffDocIds.includes(String(s.referredBy)))) ||
        (s.referralId && allowedReferralIds.includes(String(s.referralId)))
      );
    }

    if (resellerSearch.trim()) {
      const q = resellerSearch.toLowerCase();
      return enrichedList.filter(s => 
        s.reseller_name.toLowerCase().includes(q) || 
        s.reseller_id.toLowerCase().includes(q) ||
        s.shop_name.toLowerCase().includes(q) ||
        s.numeric_id.includes(q) ||
        s.full_name.toLowerCase().includes(q)
      );
    }
    return enrichedList;
  }, [resellerSessions, resellerSearch, resellers, canSeeAll, allowedReferralIds, allowedStaffIds, allowedStaffDocIds]);

  const filteredProfiles = profiles.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.region.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredProducts = products.filter(
    (p) => p.name.toLowerCase().includes(productSearch.toLowerCase())
  );

  const displayedProducts = useMemo(() => {
    if (selectedProductIds.length === 0) return filteredProducts;
    const filtered = filteredProducts.filter(p => selectedProductIds.includes(p.id));
    return filtered.length > 0 ? filtered : filteredProducts;
  }, [filteredProducts, selectedProductIds]);

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <ShoppingBag className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold text-foreground">
            Standard Quality Control
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-lg mr-2">
            <Button
              variant={!useRealUsers ? "secondary" : "ghost"}
              size="sm"
              className="text-xs h-7 px-3"
              onClick={() => { setUseRealUsers(false); setSelectedProfile(null); }}
            >
              Virtual
            </Button>
            <Button
              variant={useRealUsers ? "secondary" : "ghost"}
              size="sm"
              className="text-xs h-7 px-3"
              onClick={() => { setUseRealUsers(true); setSelectedProfile(null); }}
            >
              Real
            </Button>
          </div>
          {selectedProfile && (
            <div className="flex items-center gap-2 mr-3">
              <Badge variant="secondary" className="text-xs">
                Active: {selectedProfile.name}
              </Badge>
              <Button variant="ghost" size="sm" onClick={handleDeselectProfile} className="text-xs h-7">
                Release
              </Button>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={() => setOrderHistoryOpen(true)}
          >
            <Package className="h-3 w-3 mr-1" />
            Orders ({filteredOrders.length})
          </Button>
        </div>
      </div>

      {/* Foldable Table — same as VP for SQC */}
      <div className="border-b border-border">
        <button
          onClick={() => setTableOpen(!tableOpen)}
          className="w-full flex items-center justify-between px-4 py-2 bg-muted/30 hover:bg-muted/50 transition-colors"
        >
          <span className="text-sm font-semibold text-foreground flex items-center gap-2">
            <UserCheck className="h-4 w-4" />
            {useRealUsers ? `Real Customer Users (${realUsers.length})` : `Virtual Customer Profiles (${profiles.length})`}
          </span>
          {tableOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        {tableOpen && (
          <div className="max-h-[45vh] overflow-auto">
            <div className="px-4 py-2">
              <div className="relative max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={useRealUsers ? "Search real users..." : "Search profiles..."}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9 text-sm"
                />
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="hidden lg:table-cell">Shipping Address</TableHead>
                  <TableHead className="hidden md:table-cell">Region</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(useRealUsers ? realUsers : profiles)
                  .filter(p => 
                    (p.name || `${p.first_name || ""} ${p.last_name || ""}`).toLowerCase().includes(searchQuery.toLowerCase()) ||
                    (p.email || "").toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  .map((p, i) => (
                    <TableRow key={p.id} className={cn(selectedProfile?.id === p.id && "bg-primary/5")}>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-medium text-sm">
                        {p.name || `${p.first_name || ""} ${p.last_name || ""}`}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.email}</TableCell>
                      <TableCell className="text-xs text-muted-foreground hidden lg:table-cell max-w-[200px] truncate">
                        {p.shipping_address || p.address || "N/A"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant="outline" className="text-[10px]">{p.region || "N/A"}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={(p.status === "Available" || !p.status) ? "default" : "secondary"}
                          className={cn(
                            "text-[10px]",
                            (p.status === "Available" || !p.status)
                              ? "bg-green-500/10 text-green-600 border-green-500/30"
                              : "bg-orange-500/10 text-orange-600 border-orange-500/30"
                          )}
                        >
                          {p.status || "Active"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="p-1 rounded hover:bg-accent transition-colors">
                              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => setSelectedProfile({
                                id: p.id,
                                name: p.name || `${p.first_name || ""} ${p.last_name || ""}`,
                                email: p.email || "",
                                shipping_address: p.shipping_address || p.address || "N/A",
                                region: p.region || "N/A",
                                status: p.status || "active"
                              })}
                              disabled={p.status === "Busy"}
                            >
                              Select
                            </DropdownMenuItem>
                            {!useRealUsers && (
                              <>
                                <DropdownMenuItem
                                  onClick={() => { setEditProfile({ ...p }); setEditDialogOpen(true); }}
                                >
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleDeleteProfile(p.id)}
                                  className="text-destructive"
                                >
                                  Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Main interface — reseller panel + cart + product panel */}
      {selectedProfile ? (
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Reseller sessions */}
          <div className="w-60 border-r border-border overflow-hidden flex-shrink-0 bg-card flex flex-col">
            <div className="p-3 border-b space-y-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                Select Reseller Shop
              </p>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Search..." 
                  className="pl-9 h-9 text-sm"
                  value={resellerSearch}
                  onChange={(e) => setResellerSearch(e.target.value)}
                />
              </div>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-0">
                {filteredResellerSessions.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No reseller sessions
                  </div>
                ) : (
                  filteredResellerSessions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => { setActiveReseller(s); setCart([]); }}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50",
                        activeReseller?.id === s.id && "bg-primary/10 border-r-2 border-primary"
                      )}
                    >
                      <div className="relative">
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground">
                          {s.reseller_name.charAt(0).toUpperCase()}
                        </div>
                        {s.is_online && (
                          <Circle className="absolute -bottom-0.5 -right-0.5 h-3 w-3 fill-green-500 text-green-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{s.reseller_name}</p>
                        <p className="text-[10px] text-muted-foreground">ID: {s.reseller_id}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Center: Virtual Cart */}
          <div className="flex-1 flex flex-col min-w-0">
            {!activeReseller ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <ShoppingBag className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Select a reseller shop to create a virtual order as <span className="font-semibold text-foreground">{selectedProfile.name}</span></p>
                </div>
              </div>
            ) : (
              <>
                {/* Cart header */}
                <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-card">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                    {activeReseller.reseller_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-foreground">{activeReseller.reseller_name}'s Shop</p>
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Circle className="h-2 w-2 fill-green-500 text-green-500" /> Ordering as: {selectedProfile.name}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    Ship to: {selectedProfile.region}
                  </Badge>
                </div>

                {/* Cart items */}
                <ScrollArea className="flex-1 p-4">
                  {cart.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                      <ShoppingBag className="h-10 w-10 mb-3 opacity-30" />
                      <p className="text-sm">Cart is empty — add products from the panel</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {cart.map((item) => (
                        <div
                          key={item.productId}
                          className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card"
                        >
                          <img
                            src={parseImageUrl(item.image, item.name)}
                            alt={item.name}
                            referrerPolicy="no-referrer"
                            className="w-14 h-14 rounded-md object-cover flex-shrink-0"
                            onError={(e) => handleImageError(e, item.image)}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
                            <p className="text-xs text-muted-foreground">${item.price.toFixed(2)} each</p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => updateQty(item.productId, -1)}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="w-8 text-center text-sm font-semibold">{item.qty}</span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => updateQty(item.productId, 1)}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                          <p className="text-sm font-semibold w-20 text-right">${(item.price * item.qty).toFixed(2)}</p>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => removeFromCart(item.productId)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>

                {/* Cart footer / submit */}
                {cart.length > 0 && (
                  <div className="px-4 py-3 border-t border-border bg-card">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-xs text-muted-foreground">{cartCount} item(s)</p>
                        <p className="text-xs text-muted-foreground">Shipping: {selectedProfile.shipping_address}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Total</p>
                        <p className="text-lg font-bold text-foreground">${cartTotal.toFixed(2)}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => setCart([])}>
                        <Trash2 className="h-3 w-3 mr-1" /> Clear Cart
                      </Button>
                      <Button size="sm" className="flex-1" onClick={submitOrder}>
                        <Send className="h-3 w-3 mr-1" /> Submit Virtual Order
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Right: Product catalog panel */}
          {activeReseller && (
            <div className="w-56 border-l border-border overflow-hidden flex-shrink-0 bg-card hidden lg:flex flex-col">
              <div className="p-3">
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-2 tracking-wider">
                  Add Products
                </p>
                <div className="relative">
                  <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    className="pl-7 h-8 text-xs"
                  />
                </div>
              </div>
              <ScrollArea className="flex-1">
                <div className="px-2 space-y-1.5 pb-4">
                  {displayedProducts.map((p) => {
                    const inCart = cart.find((c) => c.productId === p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => addToCart({ id: p.id, name: p.name, image: p.image, price: p.price })}
                        className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-accent/50 transition-colors text-left group"
                      >
                        <img
                          src={parseImageUrl(p.image, p.name)}
                          alt={p.name}
                          referrerPolicy="no-referrer"
                          className="w-10 h-10 rounded object-cover flex-shrink-0"
                          onError={(e) => handleImageError(e, p.image)}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-foreground truncate">{p.name}</p>
                          <p className="text-[10px] text-muted-foreground">${p.price.toFixed(2)}</p>
                        </div>
                        {inCart ? (
                          <Badge className="text-[9px] h-5 px-1.5">{inCart.qty}</Badge>
                        ) : (
                          <Plus className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      ) : (
        !tableOpen && (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <ShoppingBag className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select a virtual profile from the table above to begin SQC ordering</p>
            </div>
          </div>
        )
      )}

      {/* Edit Profile Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogTitle>Edit Virtual Profile</DialogTitle>
          {editProfile && (
            <div className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input value={editProfile.name} onChange={(e) => setEditProfile({ ...editProfile, name: e.target.value })} />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={editProfile.email} onChange={(e) => setEditProfile({ ...editProfile, email: e.target.value })} />
              </div>
              <div>
                <Label>Shipping Address</Label>
                <Input value={editProfile.shipping_address} onChange={(e) => setEditProfile({ ...editProfile, shipping_address: e.target.value })} />
              </div>
              <div>
                <Label>Region</Label>
                <Input value={editProfile.region} onChange={(e) => setEditProfile({ ...editProfile, region: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleEditSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Order History Dialog */}
      <Dialog open={orderHistoryOpen} onOpenChange={setOrderHistoryOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Virtual Order History ({filteredOrders.length})
          </DialogTitle>
          <ScrollArea className="max-h-[60vh]">
            {filteredOrders.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No virtual orders yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredOrders.map((order) => (
                  <Card key={order.id} className="border border-border">
                    <CardHeader className="py-3 px-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <CardTitle className="text-sm font-mono">{order.orderId}</CardTitle>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px]",
                              order.status === "Ongoing" && "bg-blue-500/10 text-blue-600 border-blue-500/30",
                              order.status === "Completed" && "bg-green-500/10 text-green-600 border-green-500/30",
                              order.status === "Cancelled" && "bg-red-500/10 text-red-600 border-red-500/30",
                              order.status === "Pending" && "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
                            )}
                          >
                            {order.status}
                          </Badge>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="p-1 rounded hover:bg-accent">
                              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => updateOrderStatus(order.id, "Completed")}>
                              Mark Completed
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => updateOrderStatus(order.id, "Cancelled")} className="text-destructive">
                              Cancel Order
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-3">
                      <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground mb-2">
                        <span>Profile: <span className="text-foreground font-medium">{order.profileName}</span></span>
                        <span>Reseller: <span className="text-foreground font-medium">{order.resellerName}</span></span>
                        <span>ID: <span className="font-mono text-foreground">{order.resellerId}</span></span>
                      </div>
                      <div className="text-xs text-muted-foreground mb-2">
                        Ship to: {order.shippingAddress}
                      </div>
                      <Separator className="my-2" />
                      <div className="space-y-2">
                        {order.items.map((item) => (
                          <div key={item.productId} className="flex items-center justify-between gap-3 text-xs">
                            <div className="flex items-center gap-2 min-w-0">
                              <img
                                src={parseImageUrl(item.image, item.name)}
                                alt={item.name}
                                referrerPolicy="no-referrer"
                                className="w-8 h-8 rounded object-cover flex-shrink-0 border border-border"
                                onError={(e) => handleImageError(e, item.image)}
                              />
                              <span className="text-foreground truncate">{item.name} × {item.qty}</span>
                            </div>
                            <span className="text-muted-foreground flex-shrink-0">${(item.price * item.qty).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                      <Separator className="my-2" />
                      <div className="flex justify-between text-sm font-semibold">
                        <span>Total</span>
                        <span>${order.totalCost.toFixed(2)}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {new Date(order.createdAt).toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
