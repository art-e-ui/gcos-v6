import { useState, useEffect, useCallback, useMemo } from "react";
import { useReseller } from "@/lib/reseller-context-hooks";
import { useNavigate, useLocation } from "react-router-dom";
import { resellerPath } from "@/lib/subdomain";
import { Package, ShoppingCart, CreditCard, Clock, CheckCircle, ArrowRight } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { Order, OrderStatus } from "@/lib/types";
import { LucideIcon } from "lucide-react";
import { parseImageUrl, getProductPlaceholder, handleImageError } from "@/lib/utils";
import { useUpdateOrderStatus } from "@/hooks/use-orders";
import { useTranslation } from "react-i18next";

type FilterTab = "All" | "Pending" | "Ongoing" | "Completed";

export default function ResellerOrders() {
  const { reseller } = useReseller();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<FilterTab>(location.state?.tab || "All");
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const updateStatusMutation = useUpdateOrderStatus();

  const STATUS_CONFIG: Record<string, { label: string; color: string; icon: LucideIcon | typeof LoadingSpinner }> = {
    Pending: { label: t("reseller.pending"), color: "bg-warning/15 text-warning", icon: Clock },
    Ongoing: { label: t("reseller.ongoing"), color: "bg-info/15 text-info", icon: LoadingSpinner },
    Completed: { label: t("reseller.completed"), color: "bg-success/15 text-success", icon: CheckCircle },
    Cancelled: { label: t("reseller.cancelled"), color: "bg-destructive/15 text-destructive", icon: Package },
  };

  const TABS: FilterTab[] = ["All", "Pending", "Ongoing", "Completed"];

  // Fetch orders from Supabase
  const fetchOrders = useCallback(async () => {
    if (!reseller?.id) return;
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from("orders")
        .select("*, order_items(*)")
        .eq("reseller_id", reseller.id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const fetchedOrders = (data || []).map(row => {
        let statusStr = row.status || "Pending";
        statusStr = statusStr.charAt(0).toUpperCase() + statusStr.slice(1).toLowerCase();
        
        return {
          id: row.id,
          orderId: row.orderId || row.order_number || row.id,
          resellerId: row.reseller_id,
          resellerName: row.resellerName,
          items: (row.items && row.items.length > 0 ? row.items : (row.order_items || [])).map((item: Record<string, unknown>) => ({
            productId: item.product_id || item.productId,
            name: item.name,
            image: item.image,
            price: item.price_at_time || item.price,
            qty: item.quantity || item.qty
          })),
          totalCost: Number(row.total_cost || row.total_amount || 0),
          serviceCost: Number(row.service_cost || 0),
          profit: Number(row.profit || row.profits || 0),
          status: statusStr as OrderStatus,
          createdAt: row.created_at,
          shippingAddress: row.shipping_address,
          profileName: row.profileName || row.customerName || "Unknown"
        } as Order;
      });
      
      setOrders(fetchedOrders);
    } catch (error) {
      console.error("Error fetching orders:", error);
    } finally {
      setLoading(false);
    }
  }, [reseller?.id]);

  useEffect(() => {
    fetchOrders();

    const channel = supabase
      .channel('reseller_orders_realtime')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'orders',
        filter: `reseller_id=eq.${reseller?.id}`
      }, () => {
        fetchOrders();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchOrders, reseller?.id]);

  const usableBalance = reseller ? reseller.balance - (reseller.guaranteeBalance ?? 0) : 0;

  const handlePickUp = async (order: Order) => {
    if (!reseller) return;
    
    if (usableBalance < order.serviceCost) {
      toast.error(t("reseller.insufficientBalanceOrder"), {
        duration: 3000,
      });
      setTimeout(() => navigate(resellerPath("/reseller/profile")), 1500);
      return;
    }

    try {
      await updateStatusMutation.mutateAsync({ 
        orderId: order.id, 
        status: "Ongoing"
      });

      toast.success(t("reseller.orderPickedUp"), {
        description: `$${order.serviceCost.toFixed(2)} ${t("reseller.deductedFromBalance")}. $${order.totalCost.toFixed(2)} ${t("reseller.addedToPendingBalance")}.`,
      });
    } catch (error) {
      console.error("Error picking up order:", error);
      toast.error(t("reseller.failedToPickUpOrder"));
    }
  };

  const filtered = useMemo(() => {
    if (activeTab === "All") return orders;
    return orders.filter(o => o.status === activeTab);
  }, [orders, activeTab]);

  if (!reseller) return null;

  return (
    <div className="px-4 py-5 space-y-4 max-w-lg mx-auto pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">{t("reseller.orders")}</h1>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-muted/50 p-1 rounded-xl overflow-x-auto no-scrollbar">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              activeTab === tab
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "All" ? t("common.all") : t(`reseller.${tab.toLowerCase()}`)}
          </button>
        ))}
      </div>

      {/* Order cards */}
      <div className="space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <LoadingSpinner size={32} />
            <p className="text-sm mt-2">{t("reseller.loadingOrders")}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground bg-card/40 rounded-3xl border border-dashed border-border">
            <ShoppingCart className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">{t("reseller.noOrdersFound", { status: activeTab !== "All" ? t(`reseller.${activeTab.toLowerCase()}`).toLowerCase() : "" })}</p>
          </div>
        ) : (
          filtered.map(order => {
            const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.Pending;
            const StatusIcon = cfg.icon;
            const totalItems = (order.items || []).reduce((sum, item) => sum + (item.qty || 0), 0);

            return (
              <div
                key={order.id}
                className="rounded-3xl border border-border bg-card/60 backdrop-blur-md p-4 space-y-4 shadow-sm"
              >
                {/* Header: ID + Status */}
                <div className="flex items-center justify-between">
                  <p className="text-xs font-mono font-bold text-muted-foreground">{order.orderId}</p>
                  <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase px-3 py-1 rounded-full ${cfg.color}`}>
                    <StatusIcon size={12} />
                    {cfg.label}
                  </span>
                </div>

                {/* Product thumbnails */}
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                  {(order.items || []).map((item, i) => (
                    <div key={i} className="relative flex-shrink-0">
                      <img
                        src={parseImageUrl(item.image, item.name)}
                        alt={item.name}
                        referrerPolicy="no-referrer"
                        onError={(e) => handleImageError(e, item.image)}
                        className="h-16 w-16 rounded-2xl object-cover border border-border"
                      />
                      {(item.qty || 0) > 1 && (
                        <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[8px] font-bold h-4 w-4 flex items-center justify-center rounded-full border border-background">
                          {item.qty}
                        </span>
                      )}
                    </div>
                  ))}
                  {(!order.items || order.items.length === 0) && (
                    <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center border border-border">
                      <Package className="h-6 w-6 text-muted-foreground/40" />
                    </div>
                  )}
                </div>

                {/* Order Info */}
                <div className="flex items-center justify-between text-[10px] text-muted-foreground border-b border-border/50 pb-3">
                  <div className="flex gap-3">
                    <span>{(order.items || []).length} {t("reseller.products")}</span>
                    <span>{totalItems} {t("reseller.itemsTotal")}</span>
                  </div>
                </div>

                {/* Financial breakdown */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <p className="text-[9px] text-muted-foreground uppercase font-semibold">{t("reseller.totalCost")}</p>
                    <p className="text-sm font-bold text-foreground">${order.totalCost.toFixed(2)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[9px] text-muted-foreground uppercase font-semibold">{t("reseller.serviceCost")}</p>
                    <p className="text-sm font-bold text-destructive">${order.serviceCost.toFixed(2)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[9px] text-muted-foreground uppercase font-semibold">{t("reseller.profits")}</p>
                    <p className="text-sm font-bold text-success">${order.profit.toFixed(2)}</p>
                  </div>
                </div>

                {/* Pick up button */}
                {order.status === "Pending" && (
                  <button
                    onClick={() => handlePickUp(order)}
                    className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground text-sm font-bold py-3 rounded-2xl shadow-lg shadow-primary/20 hover:opacity-90 transition-all active:scale-[0.98]"
                  >
                    {t("reseller.pickUp")}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
