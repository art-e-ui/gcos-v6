import { useState, useMemo, useEffect } from "react";
import Papa from "papaparse";
import { supabase } from "@/lib/supabase";
import { useUnifiedResellers } from "@/lib/unified-hooks";
import { useDbProducts, dbProductToInventory, type InventoryRow, useProductMutations } from "@/hooks/use-db-products";
import { useProductSync } from "@/lib/product-sync-context-hooks";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { useAdminAuth } from "@/lib/admin-auth-context-hooks";
import { 
  Search, Package, AlertTriangle, CheckCircle, MoreVertical, 
  ShoppingBag, Users, FolderOpen, Globe, Download,
  RefreshCw, Clock, Settings, FileText, Plus, Upload, Trash2, Edit,
  ChevronLeft, ChevronRight
} from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatCard } from "@/components/admin/StatCard";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import * as z from "zod";
import { parseImageUrl } from "@/lib/utils";
import { ShopifySyncPanel } from "@/components/admin/ShopifySyncPanel";

const productSchema = z.object({
  name: z.string().min(2, "Name is required"),
  price: z.coerce.number().min(0.01, "Price must be greater than 0"),
  stock: z.coerce.number().min(0, "Stock cannot be negative"),
  category: z.string().min(1, "Category is required"),
  sku: z.string().min(1, "SKU is required"),
  image: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  description: z.string().optional(),
});

type ProductFormValues = z.infer<typeof productSchema>;

type ViewMode = "products" | "reseller" | "category";

export default function AdminInventoryPage() {
  const { session } = useAdminAuth();
  const { data: dbProducts, isLoading } = useDbProducts();
  const resellers = useUnifiedResellers();
  const { canSeeAll, allowedReferralIds, allowedStaffIds, allowedStaffDocIds, allowedAdminIds } = useAdminAccess();
  const queryClient = useQueryClient();
  const { isSyncing, lastSync, syncNow, nextSync, syncUrl, setSyncUrl } = useProductSync();
  
  const { addProduct, updateProduct, deleteProduct, clearInventory, bulkSyncProducts } = useProductMutations();
  
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("products");
  const [scrapeUrl, setScrapeUrl] = useState("");
  const [scrapeCategory, setScrapeCategory] = useState("");
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeOpen, setScrapeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<InventoryRow | null>(null);
  const [tempUrl, setTempUrl] = useState(syncUrl);
  const [isLoadingDummyData, setIsLoadingDummyData] = useState(false);
  
  // Shopify Sync Integration State
  const [shopifyDomain, setShopifyDomain] = useState(() => {
    return typeof window !== 'undefined' ? (localStorage.getItem("shopify_domain") || "") : "";
  });
  const [shopifyToken, setShopifyToken] = useState(() => {
    return typeof window !== 'undefined' ? (localStorage.getItem("shopify_token") || "") : "";
  });
  const [shopifyClientId, setShopifyClientId] = useState("");
  const [shopifyClientSecret, setShopifyClientSecret] = useState("");
  const [shopifySyncLimit, setShopifySyncLimit] = useState("50");
  const [shopifyCategory, setShopifyCategory] = useState("GC-Special");
  const [isShopifySyncing, setIsShopifySyncing] = useState(false);

  // Advanced Shopify GraphQL Sync and Policies States
  const [useGraphQL, setUseGraphQL] = useState(true);
  const [autoCategory, setAutoCategory] = useState(true);
  const [overwritePrice, setOverwritePrice] = useState(true);
  const [overwriteStock, setOverwriteStock] = useState(true);
  const [defaultRating, setDefaultRating] = useState("4.5");
  const [shopifyBadge, setShopifyBadge] = useState("Shopify");
  
  // Background Syncer
  const [backgroundSync, setBackgroundSync] = useState(false);
  const [syncInterval, setSyncInterval] = useState("5"); // 5 mins
  const [syncLogs, setSyncLogs] = useState<string[]>(() => [
    `[${new Date().toLocaleTimeString('en-US', { hour12: false })}] System: Shopify Catalog Sync system initialized.`
  ]);
  const [nextSyncTime, setNextSyncTime] = useState<string | null>(null);

  // Load Settings from Supabase system_settings
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const { data, error } = await supabase.from("system_settings").select("*");
        if (error) throw error;
        if (data && data.length > 0) {
          const domainVal = data.find(r => r.key === "shopify_domain")?.value;
          const tokenVal = data.find(r => r.key === "shopify_token")?.value;
          const clientIdVal = data.find(r => r.key === "shopify_client_id")?.value;
          const clientSecretVal = data.find(r => r.key === "shopify_client_secret")?.value;
          const limitVal = data.find(r => r.key === "shopify_sync_limit")?.value;
          const catVal = data.find(r => r.key === "shopify_category")?.value;
          const gqlVal = data.find(r => r.key === "shopify_use_graphql")?.value;
          const autoCatVal = data.find(r => r.key === "shopify_auto_category")?.value;
          const overPriceVal = data.find(r => r.key === "shopify_overwrite_price")?.value;
          const overStockVal = data.find(r => r.key === "shopify_overwrite_stock")?.value;
          const defRatingVal = data.find(r => r.key === "shopify_default_rating")?.value;
          const badgeVal = data.find(r => r.key === "shopify_badge")?.value;
          const bgSyncVal = data.find(r => r.key === "shopify_background_sync")?.value;
          const intervalVal = data.find(r => r.key === "shopify_sync_interval")?.value;

          if (domainVal) setShopifyDomain(domainVal);
          if (tokenVal) setShopifyToken(tokenVal);
          if (clientIdVal) setShopifyClientId(clientIdVal);
          if (clientSecretVal) setShopifyClientSecret(clientSecretVal);
          if (limitVal) setShopifySyncLimit(limitVal);
          if (catVal) setShopifyCategory(catVal);
          if (gqlVal !== undefined) setUseGraphQL(gqlVal === "true");
          if (autoCatVal !== undefined) setAutoCategory(autoCatVal === "true");
          if (overPriceVal !== undefined) setOverwritePrice(overPriceVal === "true");
          if (overStockVal !== undefined) setOverwriteStock(overStockVal === "true");
          if (defRatingVal !== undefined) setDefaultRating(defRatingVal);
          if (badgeVal !== undefined) setShopifyBadge(badgeVal);
          if (bgSyncVal !== undefined) setBackgroundSync(bgSyncVal === "true");
          if (intervalVal !== undefined) setSyncInterval(intervalVal);
        }
      } catch (e) {
        console.error("Failed to load shopify database settings from system_settings:", e);
      }
    };
    loadSettings();
  }, []);

  const saveShopifySettingsToDb = async (options: {
    domain: string;
    token: string;
    clientId: string;
    clientSecret: string;
    limit: string;
    category: string;
    gql: boolean;
    autoCat: boolean;
    overPrice: boolean;
    overStock: boolean;
    rating: string;
    badge: string;
    bgSync: boolean;
    interval: string;
  }) => {
    try {
      const settingsToUpsert = [
        { key: "shopify_domain", value: options.domain, category: "shopify", label: "Shopify Store Domain" },
        { key: "shopify_token", value: options.token, category: "shopify", label: "Shopify Admin Access Token" },
        { key: "shopify_client_id", value: options.clientId, category: "shopify", label: "Shopify Client ID" },
        { key: "shopify_client_secret", value: options.clientSecret, category: "shopify", label: "Shopify Client Secret" },
        { key: "shopify_sync_limit", value: options.limit, category: "shopify", label: "Shopify Sync Limit" },
        { key: "shopify_category", value: options.category, category: "shopify", label: "Shopify Default Sync Category" },
        { key: "shopify_use_graphql", value: String(options.gql), category: "shopify", label: "Use Shopify GraphQL API" },
        { key: "shopify_auto_category", value: String(options.autoCat), category: "shopify", label: "Shopify Automated Category-Matching" },
        { key: "shopify_overwrite_price", value: String(options.overPrice), category: "shopify", label: "Shopify Overwrite Price Policy" },
        { key: "shopify_overwrite_stock", value: String(options.overStock), category: "shopify", label: "Shopify Overwrite Stock Policy" },
        { key: "shopify_default_rating", value: options.rating, category: "shopify", label: "Shopify New Product Default Rating" },
        { key: "shopify_badge", value: options.badge, category: "shopify", label: "Shopify Synced Product Badge" },
        { key: "shopify_background_sync", value: String(options.bgSync), category: "shopify", label: "Enable Background Sync Schedule" },
        { key: "shopify_sync_interval", value: options.interval, category: "shopify", label: "Shopify Background Sync Interval" },
      ];

      for (const setting of settingsToUpsert) {
        await supabase.from("system_settings").upsert(setting, { onConflict: "key" });
      }
    } catch (e) {
      console.error("Failed to persist database settings to system_settings", e);
    }
  };

  // Background Sync Daemon Timer
  useEffect(() => {
    if (!backgroundSync || !shopifyDomain || !shopifyToken) {
      setNextSyncTime(null);
      return;
    }

    const intervalMin = parseInt(syncInterval) || 5;
    const intervalMs = intervalMin * 60 * 1000;

    const calcNextTime = () => {
      const nextDate = new Date(Date.now() + intervalMs);
      return nextDate.toLocaleTimeString('en-US', { hour12: false });
    };

    setNextSyncTime(calcNextTime());

    const backgroundSyncTask = async () => {
      const t = new Date().toLocaleTimeString('en-US', { hour12: false });
      setSyncLogs(prev => [...prev, `[${t}] Background Sync: Initiating scheduled syncer run...`]);
      
      try {
        const response = await fetch("/api/shopify-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            domain: shopifyDomain,
            token: shopifyToken,
            clientId: shopifyClientId,
            clientSecret: shopifyClientSecret,
            syncLimit: parseInt(shopifySyncLimit) || 50,
            category: shopifyCategory,
            useGraphQL,
            autoCategory,
            overwritePrice,
            overwriteStock,
            defaultRating: parseFloat(defaultRating) || 4.5,
            badge: shopifyBadge,
          }),
        });

        const data = await response.json();
        const currentT = new Date().toLocaleTimeString('en-US', { hour12: false });

        if (!response.ok) {
          throw new Error(data.error || "Background Sync failed.");
        }

        if (data.logs && Array.isArray(data.logs)) {
          setSyncLogs(prev => [...prev, ...data.logs]);
        }

        setSyncLogs(prev => [
          ...prev, 
          `[${currentT}] Background Sync SUCCESS: Synced ${data.count} items (${data.inserts || 0} inserted, ${data.updates || 0} updated).`
        ]);

        queryClient.invalidateQueries({ queryKey: ["db-products"] });
        queryClient.invalidateQueries({ queryKey: ["categories"] });

      } catch (err: unknown) {
        const currentT = new Date().toLocaleTimeString('en-US', { hour12: false });
        const errMsg = err instanceof Error ? err.message : String(err);
        setSyncLogs(prev => [
          ...prev, 
          `[${currentT}] Background Sync ERROR: ${errMsg}`
        ]);
        toast({
          title: "Shopify Auto-Sync Error",
          description: errMsg,
          variant: "destructive",
        });
      } finally {
        setNextSyncTime(calcNextTime());
      }
    };

    const thread = setInterval(backgroundSyncTask, intervalMs);

    return () => clearInterval(thread);
  }, [backgroundSync, syncInterval, shopifyDomain, shopifyToken, shopifyClientId, shopifyClientSecret, shopifySyncLimit, shopifyCategory, useGraphQL, autoCategory, overwritePrice, overwriteStock, defaultRating, shopifyBadge, queryClient]);

  const handleShopifySync = async () => {
    if (!shopifyDomain || (!shopifyToken && (!shopifyClientId || !shopifyClientSecret))) {
      toast({
        title: "Missing Information",
        description: "Please enter your Shopify Store Domain and either an Access Token or Client ID & Client Secret.",
        variant: "destructive",
      });
      return;
    }

    setIsShopifySyncing(true);
    const t = new Date().toLocaleTimeString('en-US', { hour12: false });
    setSyncLogs(prev => [...prev, `[${t}] Manual Sync Initiated: Connecting to Shopify API...`]);

    try {
      const response = await fetch("/api/shopify-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: shopifyDomain,
          token: shopifyToken,
          clientId: shopifyClientId,
          clientSecret: shopifyClientSecret,
          syncLimit: parseInt(shopifySyncLimit) || 50,
          category: shopifyCategory,
          useGraphQL,
          autoCategory,
          overwritePrice,
          overwriteStock,
          defaultRating: parseFloat(defaultRating) || 4.5,
          badge: shopifyBadge,
        }),
      });

      const data = await response.json();
      const currentT = new Date().toLocaleTimeString('en-US', { hour12: false });

      if (!response.ok) {
        throw new Error(data.error || "Failed to sync products from Shopify.");
      }

      if (data.logs && Array.isArray(data.logs)) {
        setSyncLogs(prev => [...prev, ...data.logs]);
      } else {
        setSyncLogs(prev => [...prev, `[${currentT}] Standard sync query returned successfully.`]);
      }

      setSyncLogs(prev => [
        ...prev, 
        `[${currentT}] Manual Sync COMPLETE: ${data.message}`
      ]);

      localStorage.setItem("shopify_domain", shopifyDomain);
      localStorage.setItem("shopify_token", shopifyToken);

      await saveShopifySettingsToDb({
        domain: shopifyDomain,
        token: shopifyToken,
        clientId: shopifyClientId,
        clientSecret: shopifyClientSecret,
        limit: shopifySyncLimit,
        category: shopifyCategory,
        gql: useGraphQL,
        autoCat: autoCategory,
        overPrice: overwritePrice,
        overStock: overwriteStock,
        rating: defaultRating,
        badge: shopifyBadge,
        bgSync: backgroundSync,
        interval: syncInterval,
      });

      queryClient.invalidateQueries({ queryKey: ["db-products"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });

      toast({
        title: "Shopify Sync Complete",
        description: data.message || `Successfully synced products from your Shopify store!`,
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "An unexpected error occurred during Shopify syncing.";
      const currentT = new Date().toLocaleTimeString('en-US', { hour12: false });
      setSyncLogs(prev => [...prev, `[${currentT}] Manual Sync ERROR: ${errMsg}`]);
      toast({
        title: "Shopify Integration Error",
        description: errMsg,
        variant: "destructive",
      });
    } finally {
      setIsShopifySyncing(false);
    }
  };
  const [isReplacing, setIsReplacing] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  const [productToDelete, setProductToDelete] = useState<string | null>(null);

  const handleLoadDummyData = async () => {
    setIsLoadingDummyData(true);
    try {
      const res = await fetch('https://dummyjson.com/products?limit=10');
      const data = await res.json();
      
      for (const item of data.products) {
        await addProduct.mutateAsync({
          name: item.title,
          price: item.price,
          stock: item.stock,
          category: item.category,
          sku: item.sku || `DUMMY-${item.id}`,
          image: item.thumbnail,
          description: item.description,
        });
      }
      toast({
        title: "Success",
        description: `Loaded ${data.products.length} dummy products.`,
      });
    } catch (error) {
      console.error("Error loading dummy data:", error);
      toast({
        title: "Error",
        description: "Failed to load dummy products.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingDummyData(false);
    }
  };

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: "",
      price: 0,
      stock: 0,
      category: "",
      sku: "",
      image: "",
      description: "",
    },
  });

  const onSubmit = async (values: ProductFormValues) => {
    try {
      if (editingProduct) {
        await updateProduct.mutateAsync({
          id: editingProduct.id,
          ...values,
        });
      } else {
        await addProduct.mutateAsync(values);
      }
      setProductDialogOpen(false);
      form.reset();
      setEditingProduct(null);
    } catch (error) {
      console.error("Form submission error:", error);
    }
  };

  const handleClearInventory = async () => {
    try {
      await clearInventory.mutateAsync();
      setClearDialogOpen(false);
    } catch (error) {
      console.error("Error clearing inventory:", error);
    }
  };

  const handleEdit = (product: InventoryRow) => {
    setEditingProduct(product);
    form.reset({
      name: product.name,
      price: product.price,
      stock: product.stock,
      category: product.category,
      sku: product.sku,
      image: product.image,
      description: product.description || "",
    });
    setProductDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    setProductToDelete(id);
  };

  const confirmDelete = async () => {
    if (!productToDelete) return;
    try {
      await deleteProduct.mutateAsync(productToDelete);
      setProductToDelete(null);
    } catch (error) {
      console.error("Delete error:", error);
      toast({
        title: "Delete Failed",
        description: error instanceof Error ? error.message : "You don't have permission to delete this product.",
        variant: "destructive",
      });
      setProductToDelete(null);
    }
  };

  const handleSaveSettings = () => {
    setSyncUrl(tempUrl);
    setSettingsOpen(false);
    toast({
      title: "Settings Saved",
      description: "Your inventory sync configuration has been updated.",
    });
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const data = results.data as Record<string, unknown>[];
        const productsToSync: ProductFormValues[] = [];

        if (data.length === 0) {
          toast({
            title: "Empty File",
            description: "No products found in the CSV file.",
            variant: "destructive",
          });
          return;
        }

        if (isReplacing) {
          toast({
            title: "Replacing Inventory",
            description: "Clearing existing products before upload...",
          });
          await clearInventory.mutateAsync();
        }

        toast({
          title: isReplacing ? "Uploading New Inventory" : "Processing CSV",
          description: `Found ${data.length} products. Bulk syncing now...`,
        });

        for (const row of data) {
          // Map CSV headers to our schema (case-insensitive and flexible)
          const getVal = (keys: string[]) => {
            const foundKey = Object.keys(row).find(k => 
              keys.some(searchKey => k.trim().toLowerCase() === searchKey.toLowerCase())
            );
            return foundKey ? String(row[foundKey]).trim() : undefined;
          };

          const cleanNumber = (val: string | undefined) => {
            if (!val) return "0";
            return val.replace(/[^0-9.]/g, "");
          };

          const rawPrice = getVal(["price", "cost", "unit price", "unit_price", "amount"]);
          const rawStock = getVal(["stock", "quantity", "inventory", "count", "qty"]);
          
          const productData = {
            name: getVal(["name", "product name", "title", "product_name"]) || "Unnamed Product",
            price: Math.max(0.01, parseFloat(cleanNumber(rawPrice)) || 0.01),
            stock: Math.max(0, parseInt(cleanNumber(rawStock), 10) || 0),
            category: getVal(["category", "type", "group", "category_name"]) || "Uncategorized",
            sku: getVal(["sku", "product code", "id", "product_id", "code"]) || `SKU-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            image: getVal(["image url", "image", "thumbnail", "photo", "image_url"]) || "",
            description: getVal(["description", "details", "info", "desc"]) || "",
          };

          productsToSync.push(productData);
        }

        await bulkSyncProducts.mutateAsync(productsToSync);
        
        // Reset input
        e.target.value = "";
      },
      error: (error) => {
        console.error("CSV Parsing Error:", error);
        toast({
          title: "Import Failed",
          description: "Could not parse the CSV file.",
          variant: "destructive",
        });
      }
    });
  };

  const handleScrapeProducts = async () => {
    setIsScraping(true);
    try {
      // 1. Scrape products from the URL
      const scrapeResponse = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: scrapeUrl, category: scrapeCategory }),
      });

      if (!scrapeResponse.ok) {
        const text = await scrapeResponse.text();
        let errorMessage = "Failed to scrape products from URL";
        try {
          const errorData = JSON.parse(text);
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          errorMessage = text.slice(0, 100) || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const text = await scrapeResponse.text();
      const contentType = scrapeResponse.headers.get("content-type");
      let products;
      
      if (contentType && contentType.includes("application/json")) {
        try {
          const data = JSON.parse(text);
          products = data.products;
        } catch (e) {
          console.error("Failed to parse JSON from /api/scrape:", text);
          throw new Error("Server returned invalid JSON data.");
        }
      } else {
        console.error("Non-JSON response from /api/scrape:", text);
        throw new Error("Server returned an invalid response format (HTML instead of JSON).");
      }

      if (!products || products.length === 0) {
        throw new Error("No products found at the provided URL.");
      }

      // 2. Sync products to Supabase using client-side mutation
      await bulkSyncProducts.mutateAsync(products);

      setScrapeOpen(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to scrape products";
      toast({ title: "Import Failed", description: message, variant: "destructive" });
    } finally {
      setIsScraping(false);
    }
  };

  const filteredResellers = useMemo(() => {
    if (canSeeAll) return resellers;
    return resellers.filter((r) => 
      (r.referralId && allowedReferralIds.includes(r.referralId)) ||
      (r.referredBy && (allowedStaffIds.includes(r.referredBy) || allowedStaffDocIds.includes(r.referredBy))) ||
      (r.memberOfAdminId && allowedAdminIds.includes(r.memberOfAdminId))
    );
  }, [resellers, canSeeAll, allowedReferralIds, allowedStaffIds, allowedStaffDocIds, allowedAdminIds]);

  const inventory: InventoryRow[] = useMemo(() => {
    if (!dbProducts) return [];
    return dbProducts.map((p) => {
      const resellerCount = filteredResellers.filter((r) =>
        r.selectedProductIds.includes(p.id)
      ).length;
      return dbProductToInventory(p, resellerCount);
    });
  }, [dbProducts, filteredResellers]);

  const filtered = inventory.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.sku.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const inStock = inventory.filter(p => p.status === "In Stock").length;
  const lowStock = inventory.filter(p => p.status === "Low Stock").length;

  const categoryData = useMemo(() => {
    const map: Record<string, { count: number; totalStock: number; inStock: number; lowStock: number; outOfStock: number; totalPrice: number }> = {};
    filtered.forEach((p) => {
      const cat = p.category || "Uncategorized";
      if (!map[cat]) map[cat] = { count: 0, totalStock: 0, inStock: 0, lowStock: 0, outOfStock: 0, totalPrice: 0 };
      map[cat].count++;
      map[cat].totalStock += p.stock;
      map[cat].totalPrice += p.price;
      if (p.status === "In Stock") map[cat].inStock++;
      else if (p.status === "Low Stock") map[cat].lowStock++;
      else map[cat].outOfStock++;
    });
    return Object.entries(map).map(([name, d]) => ({ name, ...d, avgPrice: d.totalPrice / d.count }));
  }, [filtered]);

  const resellerData = useMemo(() => {
    let list = filteredResellers;
    if (viewMode === "reseller" && searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(r => 
        r.firstName.toLowerCase().includes(q) || 
        r.lastName.toLowerCase().includes(q) || 
        r.shopName.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        r.resellerId?.toString().includes(q)
      );
    }
    return list.map((r) => ({
      id: r.id,
      name: `${r.firstName} ${r.lastName}`,
      shopName: r.shopName,
      referralId: r.referralId,
      level: r.level,
      productCount: Math.max(1, Math.round(filtered.length / Math.max(filteredResellers.length, 1))),
      totalStock: filtered.reduce((s, p) => s + p.stock, 0) / Math.max(filteredResellers.length, 1),
    }));
  }, [filteredResellers, filtered, viewMode, searchQuery]);

  const statCards = [
    { label: "Total Items", value: inventory.length, icon: Package, iconBg: "bg-primary/10 text-primary" },
    { label: "Low Stock", value: lowStock, icon: AlertTriangle, iconBg: "bg-warning/10 text-warning" },
    { label: "In Stock", value: inStock, icon: CheckCircle, iconBg: "bg-success/10 text-success" },
  ];

  const viewButtons: { mode: ViewMode; label: string; icon: typeof Package }[] = [
    { mode: "products", label: "By Products", icon: ShoppingBag },
    { mode: "reseller", label: "By Reseller", icon: Users },
    { mode: "category", label: "By Category", icon: FolderOpen },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex flex-col items-start">
              <h1 className="text-xl font-bold text-foreground">Inventory</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                  User: {session?.email || 'Not Logged In'}
                </span>
                {session?.email?.toLowerCase() === 'heathercarpe34@gmail.com' && (
                  <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                    Owner Access
                  </span>
                )}
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isLoading ? "Loading products from database…" : `Manage your product catalog (${inventory.length} products)`}
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={handleLoadDummyData} disabled={isLoadingDummyData}>
              {isLoadingDummyData ? <LoadingSpinner size={14} /> : <Download className="h-3.5 w-3.5" />}
              Load Dummy Data
            </Button>
            
            <AlertDialog open={!!productToDelete} onOpenChange={(open) => !open && setProductToDelete(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Product?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete this product? This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction 
                    onClick={confirmDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {deleteProduct.isPending ? "Deleting..." : "Delete"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive" className="gap-1.5 h-8" disabled={clearInventory.isPending}>
                  {clearInventory.isPending ? <LoadingSpinner size={14} /> : <Trash2 className="h-3.5 w-3.5" />}
                  Clear Inventory
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action will permanently delete all products from your inventory. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleClearInventory} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Yes, Clear All Products
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Dialog open={productDialogOpen} onOpenChange={(open) => {
              setProductDialogOpen(open);
              if (!open) {
                setEditingProduct(null);
                form.reset();
              }
            }}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5 h-8">
                  <Plus className="h-3.5 w-3.5" />
                  Add Product
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px]">
                <DialogTitle>{editingProduct ? "Edit Product" : "Add New Product"}</DialogTitle>
                <DialogHeader>
                  <DialogDescription>
                    Fill in the details below to {editingProduct ? "update" : "create"} a product in your native database.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2 col-span-2">
                      <Label htmlFor="name">Product Name</Label>
                      <Input id="name" {...form.register("name")} placeholder="e.g. Premium Wireless Headphones" />
                      {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sku">SKU</Label>
                      <Input id="sku" {...form.register("sku")} placeholder="e.g. WH-1000XM4" />
                      {form.formState.errors.sku && <p className="text-xs text-destructive">{form.formState.errors.sku.message}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="category">Category</Label>
                      <Input id="category" {...form.register("category")} placeholder="e.g. Electronics" />
                      {form.formState.errors.category && <p className="text-xs text-destructive">{form.formState.errors.category.message}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="price">Price ($)</Label>
                      <Input id="price" type="number" step="0.01" {...form.register("price")} />
                      {form.formState.errors.price && <p className="text-xs text-destructive">{form.formState.errors.price.message}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="stock">Initial Stock</Label>
                      <Input id="stock" type="number" {...form.register("stock")} />
                      {form.formState.errors.stock && <p className="text-xs text-destructive">{form.formState.errors.stock.message}</p>}
                    </div>
                    <div className="space-y-2 col-span-2">
                      <Label htmlFor="image">Image URL</Label>
                      <Input id="image" {...form.register("image")} placeholder="https://example.com/image.jpg" />
                      {form.formState.errors.image && <p className="text-xs text-destructive">{form.formState.errors.image.message}</p>}
                    </div>
                    <div className="space-y-2 col-span-2">
                      <Label htmlFor="description">Description</Label>
                      <Textarea id="description" {...form.register("description")} placeholder="Describe the product..." className="min-h-[100px]" />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setProductDialogOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={addProduct.isPending || updateProduct.isPending}>
                      {addProduct.isPending || updateProduct.isPending ? "Saving..." : editingProduct ? "Update Product" : "Create Product"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>

            <div className="flex items-center gap-2">
              {lastSync && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Last Sync: {format(lastSync, "HH:mm:ss")}
                </span>
              )}

              <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" className="h-8 w-8 p-0" id="sync-settings-button">
                    <Settings className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogTitle>Inventory Sync & Integration</DialogTitle>
                  <DialogHeader>
                    <DialogDescription>
                      Choose your preferred method to import and sync your store's inventory.
                    </DialogDescription>
                  </DialogHeader>
                  
                  <Tabs defaultValue="shopify" className="w-full mt-2">
                    <TabsList className="grid grid-cols-2 mb-4">
                      <TabsTrigger value="shopify" className="font-semibold text-xs">
                        Shopify Store Integration
                      </TabsTrigger>
                      <TabsTrigger value="sheets" className="font-semibold text-xs">
                        Google Sheets / CSV API
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="shopify" className="space-y-4 focus:outline-none">
                      <ShopifySyncPanel 
                        shopifyDomain={shopifyDomain}
                        setShopifyDomain={setShopifyDomain}
                        shopifyToken={shopifyToken}
                        setShopifyToken={setShopifyToken}
                        shopifyClientId={shopifyClientId}
                        setShopifyClientId={setShopifyClientId}
                        shopifyClientSecret={shopifyClientSecret}
                        setShopifyClientSecret={setShopifyClientSecret}
                        shopifySyncLimit={shopifySyncLimit}
                        setShopifySyncLimit={setShopifySyncLimit}
                        shopifyCategory={shopifyCategory}
                        setShopifyCategory={setShopifyCategory}
                        useGraphQL={useGraphQL}
                        setUseGraphQL={setUseGraphQL}
                        autoCategory={autoCategory}
                        setAutoCategory={setAutoCategory}
                        overwritePrice={overwritePrice}
                        setOverwritePrice={setOverwritePrice}
                        overwriteStock={overwriteStock}
                        setOverwriteStock={setOverwriteStock}
                        defaultRating={defaultRating}
                        setDefaultRating={setDefaultRating}
                        shopifyBadge={shopifyBadge}
                        setShopifyBadge={setShopifyBadge}
                        backgroundSync={backgroundSync}
                        setBackgroundSync={setBackgroundSync}
                        syncInterval={syncInterval}
                        setSyncInterval={setSyncInterval}
                        syncLogs={syncLogs}
                        setSyncLogs={setSyncLogs}
                        nextSyncTime={nextSyncTime}
                        isShopifySyncing={isShopifySyncing}
                        onSync={handleShopifySync}
                      />
                    </TabsContent>

                    <TabsContent value="sheets" className="space-y-4 focus:outline-none">
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <Label htmlFor="sync-url" className="text-xs font-medium">Data Source URL</Label>
                          <Input 
                            id="sync-url" 
                            placeholder="https://api.example.com/products or Google Sheet CSV URL" 
                            value={tempUrl}
                            onChange={(e) => setTempUrl(e.target.value)}
                          />
                          <p className="text-[10px] text-muted-foreground">
                            Tip: For Google Sheets, use the "Publish to Web" option and choose "CSV" format.
                          </p>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-medium">Sync Frequency</Label>
                          <Select defaultValue="5">
                            <SelectTrigger>
                              <SelectValue placeholder="Select frequency" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">Every 1 minute</SelectItem>
                              <SelectItem value="5">Every 5 minutes</SelectItem>
                              <SelectItem value="15">Every 15 minutes</SelectItem>
                              <SelectItem value="60">Every 1 hour</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      
                      <Button onClick={handleSaveSettings} className="w-full font-medium mt-2">
                        Save Source Configuration
                      </Button>
                    </TabsContent>
                  </Tabs>

                  <DialogFooter className="border-t pt-3">
                    <Button variant="outline" size="sm" onClick={() => setSettingsOpen(false)}>Close Settings</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            {nextSync && (
              <span className="text-[10px] text-muted-foreground/60 italic">
                Next scheduled sync: {format(nextSync, "HH:mm")}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {statCards.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} icon={s.icon} iconBg={s.iconBg} />
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 w-full sm:w-72">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search products..." className="bg-transparent border-none outline-none text-sm w-full" />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {viewButtons.map((vb) => (
            <Button
              key={vb.mode}
              variant={viewMode === vb.mode ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode(vb.mode)}
              className="gap-1.5"
            >
              <vb.icon className="h-3.5 w-3.5" />
              {vb.label}
            </Button>
          ))}

          <Sheet open={scrapeOpen} onOpenChange={setScrapeOpen}>
            <SheetTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5 border-primary/30 text-primary hover:bg-primary/10">
                <Globe className="h-3.5 w-3.5" />
                Import / Sync Web
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-md overflow-y-auto">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Download className="h-5 w-5 text-primary" />
                  Storefront Import & Sync
                </SheetTitle>
              </SheetHeader>
              <div className="mt-6">
                <Tabs defaultValue="shopify" className="w-full">
                  <TabsList className="grid grid-cols-2 mb-4">
                    <TabsTrigger value="shopify" className="font-semibold text-xs">
                      Shopify Store Integration
                    </TabsTrigger>
                    <TabsTrigger value="web" className="font-semibold text-xs">
                      Google Sheets / Web Scraper
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="shopify" className="space-y-4 focus:outline-none">
                    <ShopifySyncPanel 
                      shopifyDomain={shopifyDomain}
                      setShopifyDomain={setShopifyDomain}
                      shopifyToken={shopifyToken}
                      setShopifyToken={setShopifyToken}
                      shopifyClientId={shopifyClientId}
                      setShopifyClientId={setShopifyClientId}
                      shopifyClientSecret={shopifyClientSecret}
                      setShopifyClientSecret={setShopifyClientSecret}
                      shopifySyncLimit={shopifySyncLimit}
                      setShopifySyncLimit={setShopifySyncLimit}
                      shopifyCategory={shopifyCategory}
                      setShopifyCategory={setShopifyCategory}
                      useGraphQL={useGraphQL}
                      setUseGraphQL={setUseGraphQL}
                      autoCategory={autoCategory}
                      setAutoCategory={setAutoCategory}
                      overwritePrice={overwritePrice}
                      setOverwritePrice={setOverwritePrice}
                      overwriteStock={overwriteStock}
                      setOverwriteStock={setOverwriteStock}
                      defaultRating={defaultRating}
                      setDefaultRating={setDefaultRating}
                      shopifyBadge={shopifyBadge}
                      setShopifyBadge={setShopifyBadge}
                      backgroundSync={backgroundSync}
                      setBackgroundSync={setBackgroundSync}
                      syncInterval={syncInterval}
                      setSyncInterval={setSyncInterval}
                      syncLogs={syncLogs}
                      setSyncLogs={setSyncLogs}
                      nextSyncTime={nextSyncTime}
                      isShopifySyncing={isShopifySyncing}
                      onSync={handleShopifySync}
                    />
                  </TabsContent>

                  <TabsContent value="web" className="space-y-4 focus:outline-none">
                    <div className="space-y-4">
                      <div className="p-3 bg-primary/5 rounded-lg border border-primary/10">
                        <h3 className="text-sm font-semibold text-primary flex items-center gap-2 mb-2">
                          <FileText className="h-4 w-4" />
                          Google Sheets Sync (Recommended)
                        </h3>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          1. In Google Sheets, go to <strong>File &gt; Share &gt; Publish to web</strong>.<br />
                          2. Select <strong>Entire Document</strong> and <strong>Comma-separated values (.csv)</strong>.<br />
                          3. Copy the generated link and paste it below.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">Source URL (CSV or Web Page)</label>
                        <Input
                          value={scrapeUrl}
                          onChange={(e) => setScrapeUrl(e.target.value)}
                          placeholder="https://docs.google.com/spreadsheets/d/.../export?format=csv"
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">Default Category</label>
                        <Input
                          value={scrapeCategory}
                          onChange={(e) => setScrapeCategory(e.target.value)}
                          placeholder="e.g. Electronics"
                        />
                      </div>

                      <Button
                        onClick={handleScrapeProducts}
                        disabled={isScraping || !scrapeUrl.trim()}
                        className="w-full gap-2"
                      >
                        {isScraping ? (
                          <>
                            <LoadingSpinner size={16} />
                            Processing & Syncing…
                          </>
                        ) : (
                          <>
                            <RefreshCw className="h-4 w-4" />
                            Sync Products Now
                          </>
                        )}
                      </Button>
                    </div>

                    <div className="pt-4 border-t border-border">
                      <h3 className="text-sm font-semibold mb-3">Other Web Sources</h3>
                      <p className="text-xs text-muted-foreground mb-3">
                        You can also paste URLs from Amazon, eBay, or other e-commerce sites to scrape products directly.
                      </p>
                      <div className="rounded-lg bg-muted/50 p-3 text-[11px] text-muted-foreground space-y-1">
                        <p><strong>Note:</strong> Web scraping depends on the site's structure and may not always capture all details. CSV sync is more reliable for bulk management.</p>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </SheetContent>
          </Sheet>

          <div className="relative flex items-center gap-2">
            <input
              type="file"
              accept=".csv"
              className="hidden"
              id="csv-upload"
              onChange={handleCsvUpload}
            />
            <Button 
              size="sm" 
              variant="outline" 
              className="gap-1.5"
              onClick={() => {
                setIsReplacing(false);
                document.getElementById("csv-upload")?.click();
              }}
            >
              <Upload className="h-3.5 w-3.5" />
              Bulk Upload CSV
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="gap-1.5 border-destructive/50 text-destructive hover:bg-destructive/10"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Replace All Inventory
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Replace Entire Inventory?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will clear all existing products and replace them with the ones in your CSV file. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction 
                    onClick={() => {
                      setIsReplacing(true);
                      document.getElementById("csv-upload")?.click();
                    }}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Confirm & Select File
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={() => {
                const headers = "SKU,Name,Description,Price,Stock,Category,Image URL\n";
                const example = "WH-001,Wireless Headphones,High-quality noise-canceling headphones.,99.99,50,Electronics,https://picsum.photos/seed/headphones/200\n";
                const blob = new Blob([headers + example], { type: "text/csv" });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "inventory_template.csv";
                a.click();
              }}
            >
              <FileText className="h-3.5 w-3.5" />
              Download Template
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-lg bg-card border border-border shadow-theme-sm overflow-hidden">
        <div className="overflow-x-auto">
          {viewMode === "products" && <ProductsTable data={filtered} onEdit={handleEdit} onDelete={handleDelete} />}
          {viewMode === "reseller" && <ResellerTable data={resellerData} />}
          {viewMode === "category" && <CategoryTable data={categoryData} />}
        </div>
      </div>
    </div>
  );
}

function ProductsTable({ data, onEdit, onDelete }: { data: InventoryRow[], onEdit: (p: InventoryRow) => void, onDelete: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;
  
  useEffect(() => {
    setPage(1);
  }, [data.length]);

  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  const pagedData = data.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <table className="w-full">
        <thead>
          <tr className="border-b bg-muted/50">
            {["", "SKU", "Product", "Category", "Price", "Stock", "Resellers", "Status", ""].map((h, i) => (
              <th key={`${h}-${i}`} className="thead-label text-left p-3.5 first:pl-5">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {pagedData.map((p) => (
            <tr key={p.id} className="hover:bg-accent/50 transition-colors">
              <td className="p-3.5 pl-5">
                {p.image ? (
                  <img 
                    src={parseImageUrl(p.image) || "/placeholder.svg"} 
                    alt={p.name} 
                    referrerPolicy="no-referrer"
                    className="h-10 w-10 rounded-lg object-cover border border-border" 
                    onError={(e) => { (e.target as HTMLImageElement).src = "/placeholder.svg"; }}
                  />
                ) : (
                  <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                    <Package className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
              </td>
              <td className="p-3.5"><span className="mono-badge">{p.sku}</span></td>
              <td className="p-3.5 text-sm font-medium text-foreground max-w-[200px] truncate">{p.name}</td>
              <td className="p-3.5 text-sm text-muted-foreground capitalize">{p.category}</td>
              <td className="p-3.5 text-sm font-semibold text-foreground">${p.price.toFixed(2)}</td>
              <td className="p-3.5 text-sm text-foreground">{p.stock}</td>
              <td className="p-3.5 text-sm text-muted-foreground">{p.resellerCount}</td>
              <td className="p-3.5"><StockBadge status={p.status} /></td>
              <td className="p-3.5 pr-5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="p-1.5 rounded-md hover:bg-accent transition-colors">
                      <MoreVertical className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEdit(p)} className="gap-2">
                      <Edit className="h-4 w-4" /> Edit Details
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onDelete(p.id)} className="gap-2 text-destructive focus:text-destructive">
                      <Trash2 className="h-4 w-4" /> Delete Product
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination Controls */}
      <div className="flex items-center justify-between text-sm text-muted-foreground p-4 border-t border-border bg-card">
        <span>Showing {data.length > 0 ? (page - 1) * PAGE_SIZE + 1 : 0} to {Math.min(page * PAGE_SIZE, data.length)} of {data.length} products</span>
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
    </>
  );
}

const vipColors: Record<number, string> = {
  0: "bg-muted text-muted-foreground",
  1: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  2: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  3: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  4: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  5: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
};

function ResellerTable({ data }: { data: { id: string; name: string; shopName: string; referralId: string; level: string | number; productCount: number; totalStock: number }[] }) {
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b bg-muted/50">
          {["Reseller", "Shop Name", "Referral ID", "Products", "Total Stock", "VIP Level"].map((h) => (
            <th key={h} className="thead-label text-left p-3.5 first:pl-5">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {data.map((r) => (
          <tr key={r.id} className="hover:bg-accent/50 transition-colors">
            <td className="p-3.5 pl-5 text-sm font-medium text-foreground">{r.name}</td>
            <td className="p-3.5 text-sm text-muted-foreground">{r.shopName}</td>
            <td className="p-3.5"><span className="mono-badge">{r.referralId}</span></td>
            <td className="p-3.5 text-sm text-foreground">{r.productCount}</td>
            <td className="p-3.5 text-sm text-foreground">{Math.round(r.totalStock)}</td>
            <td className="p-3.5">
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${vipColors[r.level] || vipColors[0]}`}>
                VIP-{r.level}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CategoryTable({ data }: { data: { name: string; count: number; totalStock: number; inStock: number; lowStock: number; outOfStock: number; avgPrice: number }[] }) {
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b bg-muted/50">
          {["Category", "Products", "Total Stock", "In Stock", "Low Stock", "Out of Stock", "Avg Price"].map((h) => (
            <th key={h} className="thead-label text-left p-3.5 first:pl-5">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {data.map((c) => (
          <tr key={c.name} className="hover:bg-accent/50 transition-colors">
            <td className="p-3.5 pl-5 text-sm font-medium text-foreground capitalize">{c.name}</td>
            <td className="p-3.5 text-sm text-foreground">{c.count}</td>
            <td className="p-3.5 text-sm text-foreground">{c.totalStock}</td>
            <td className="p-3.5"><StatusBadge label={String(c.inStock)} variant="success" /></td>
            <td className="p-3.5"><StatusBadge label={String(c.lowStock)} variant="warning" /></td>
            <td className="p-3.5"><StatusBadge label={String(c.outOfStock)} variant="danger" /></td>
            <td className="p-3.5 text-sm font-semibold text-foreground">${c.avgPrice.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StockBadge({ status }: { status: string }) {
  const variantMap: Record<string, "success" | "warning" | "danger"> = {
    "In Stock": "success", "Low Stock": "warning", "Out of Stock": "danger",
  };
  return <StatusBadge label={status} variant={variantMap[status] || "default"} />;
}
