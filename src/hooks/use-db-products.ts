import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Product, Category } from "@/lib/types";
import { toast } from "@/hooks/use-toast";
import { parseImageUrl } from "@/lib/utils";
import { useAdminLogger } from "@/hooks/use-admin-logger";

// Types for compatibility with the rest of the app
export type DbProduct = Product;
export type DbCategory = Category;

export interface DbReview {
  id: string;
  product_id: string;
  user_id: string;
  rating: number;
  title: string;
  content: string;
  helpful_count: number;
  created_at: string;
  users?: {
    first_name: string;
    last_name: string;
  };
}

export function useDbReviews(productId: string) {
  return useQuery({
    queryKey: ["db-reviews", productId],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("reviews")
          .select("*, users!inner(first_name, last_name)")
          .eq("product_id", productId)
          .order("created_at", { ascending: false });
        
        if (error) throw error;
        
        return (data || []).map((review) => ({
          ...review,
          users: review.users ? {
            first_name: review.users.first_name || "Unknown",
            last_name: review.users.last_name || "User"
          } : undefined
        })) as DbReview[];
      } catch (error) {
        console.error("Error fetching reviews from Supabase:", error);
        throw error;
      }
    },
    enabled: !!productId,
  });
}

export function useReviewMutations() {
  const queryClient = useQueryClient();

  const addReview = useMutation({
    mutationFn: async (newReview: { product_id: string; rating: number; title: string; content: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("You must be logged in to leave a review.");

      const { data: userData } = await supabase
        .from("users")
        .select("first_name, last_name")
        .eq("id", user.id)
        .single();

      const reviewData = {
        ...newReview,
        user_id: user.id,
        user_first_name: userData?.first_name || "Unknown",
        user_last_name: userData?.last_name || "User",
        helpful_count: 0,
        created_at: new Date().toISOString()
      };

      const { data, error } = await supabase.from("reviews").insert(reviewData).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["db-reviews", variables.product_id] });
      toast({ title: "Review Submitted", description: "Thank you for your feedback!" });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  return { addReview };
}

export function useDbProducts() {
  return useQuery({
    queryKey: ["db-products"],
    queryFn: async () => {
      try {
        let allData: Record<string, unknown>[] = [];
        let from = 0;
        let to = 999;
        let hasMore = true;
        const maxLimit = 5000; // Cap at 5000 rows to keep client performance smooth
        
        while (hasMore && allData.length < maxLimit) {
          const { data, error } = await supabase
            .from("products")
            .select("*")
            .order("created_at", { ascending: false })
            .range(from, to);
          
          if (error) throw error;
          
          if (data && data.length > 0) {
            allData = [...allData, ...data];
            if (data.length < 1000) {
              hasMore = false;
            } else {
              from += 1000;
              to += 1000;
            }
          } else {
            hasMore = false;
          }
        }
        
        const trimmedData = allData.slice(0, maxLimit);
        return trimmedData.map(item => dbProductToLegacy(item));
      } catch (error) {
        console.error("Error fetching products from Supabase:", error);
        return [];
      }
    },
    staleTime: 5000, 
  });
}

export function useDbCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("categories")
          .select("*")
          .limit(100);
        
        if (error) throw error;
        return data || [];
      } catch (error) {
        console.warn("Could not fetch from categories table (might not exist), falling back to derived categories:", error);
        return [];
      }
    },
    staleTime: 6 * 60 * 60 * 1000,
  });
}

export function useProductMutations() {
  const queryClient = useQueryClient();
  const { logActivity } = useAdminLogger();

  const mapToDb = (p: Partial<Product>) => {
    const dbObj: Record<string, unknown> = { ...p };
    
    if (!dbObj.id) {
      dbObj.id = crypto.randomUUID ? crypto.randomUUID() : `prod-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    }

    if (p.originalPrice !== undefined) {
      dbObj.original_price = p.originalPrice;
      delete dbObj.originalPrice;
    }
    
    if (p.inStock !== undefined) {
      dbObj.in_stock = p.inStock;
      delete dbObj.inStock;
    }
    
    return dbObj;
  };

  const addProduct = useMutation({
    mutationFn: async (newProduct: Partial<Product>) => {
      const productData = {
        ...mapToDb(newProduct),
        created_at: new Date().toISOString()
      };
      const { data, error } = await supabase.from("products").insert(productData).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["db-products"] });
      toast({ title: "Product Added", description: "The product has been saved to your database." });
      logActivity("DATA_CREATE", `Product: ${data.name || data.id}`, { id: data.id, ...data });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const updateProduct = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Product> & { id: string }) => {
      const { data, error } = await supabase
        .from("products")
        .update(mapToDb(updates))
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["db-products"] });
      toast({ title: "Product Updated", description: "Changes have been saved." });
      logActivity("DATA_UPDATE", `Product: ${data.name || data.id}`, { id: data.id, ...data });
    },
  });

  const deleteProduct = useMutation({
    mutationFn: async (id: string) => {
      const { data: product } = await supabase.from("products").select("name").eq("id", id).single();
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
      return { id, name: product?.name || "Unknown Product" };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["db-products"] });
      toast({ title: "Product Deleted", description: "The product has been removed." });
      logActivity("DATA_DELETE", `Product: ${data.name} (${data.id})`, { id: data.id });
    },
  });

  const clearInventory = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("products").delete().neq("id", "-1");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["db-products"] });
      toast({ title: "Inventory Cleared", description: "All products have been removed." });
      logActivity("DATA_DELETE", "Clear Inventory", { clearedAt: new Date().toISOString() });
    },
    onError: (error) => {
      console.error("Error clearing inventory:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const bulkSyncProducts = useMutation({
    mutationFn: async (products: Partial<Product>[]) => {
      const { data: existingProducts, error: fetchError } = await supabase.from("products").select("id, sku, name");
      if (fetchError) throw fetchError;

      const toInsert: Record<string, unknown>[] = [];
      const toUpdate: Record<string, unknown>[] = [];
      const results: Record<string, unknown>[] = [];

      for (const product of products) {
        let existing = null;
        if (product.sku) {
          existing = existingProducts.find(p => p.sku === product.sku);
        }
        if (!existing && product.name) {
          existing = existingProducts.find(p => p.name === product.name);
        }

        if (existing) {
          toUpdate.push({
            ...mapToDb(product),
            id: existing.id,
            updated_at: new Date().toISOString()
          });
          results.push({ name: product.name, status: "updated", id: existing.id });
        } else {
          toInsert.push({
            ...mapToDb(product),
            created_at: new Date().toISOString()
          });
          results.push({ name: product.name, status: "created" });
        }
      }

      if (toInsert.length > 0) {
        const { error: insertError } = await supabase.from("products").insert(toInsert);
        if (insertError) throw insertError;
      }
      
      if (toUpdate.length > 0) {
        const { error: updateError } = await supabase.from("products").upsert(toUpdate);
        if (updateError) throw updateError;
      }

      return { results };
    },
    onSuccess: (data: { results: { status: string }[] }) => {
      queryClient.invalidateQueries({ queryKey: ["db-products"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      const created = data.results.filter((r) => r.status === "created").length;
      const updated = data.results.filter((r) => r.status === "updated").length;
      toast({ 
        title: "Bulk Sync Complete", 
        description: `Successfully processed ${data.results.length} products (${created} new, ${updated} updated).` 
      });
    },
    onError: (error) => {
      toast({ title: "Sync Error", description: error.message, variant: "destructive" });
    }
  });

  return { addProduct, updateProduct, deleteProduct, clearInventory, bulkSyncProducts };
}

// Adapter: convert DB product to the legacy Product shape used across the app
export function dbProductToLegacy(p: Record<string, unknown>): Product {
  // If it's already in the legacy shape (from mock data), just return it
  if ('price' in p && typeof p.price === 'number' && !p.created_at) {
    return p as unknown as Product;
  }
  
  return {
    id: String(p.id ?? ""),
    name: String(p.name ?? p.title ?? ""),
    price: Number(p.price ?? 0),
    originalPrice: p.original_price ? Number(p.original_price) : undefined,
    image: String(p.image_url || p.image || ""),
    rating: Number(p.rating ?? 0),
    category: String(p.category_slug ?? p.category ?? ""),
    badge: p.badge ? String(p.badge) : undefined,
    description: p.description ? String(p.description) : undefined,
    seller: p.seller ? String(p.seller) : undefined,
    inStock: Boolean(p.in_stock ?? true),
    stock: Number(p.stock ?? 0),
    sku: String(p.sku ?? ""),
    specifications: p.specifications
      ? (p.specifications as Record<string, string>)
      : undefined,
  };
}

// Build inventory view from DB products + reseller data
export interface InventoryRow {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  status: "In Stock" | "Low Stock" | "Out of Stock";
  image: string;
  resellerCount: number;
  description?: string;
}

export function dbProductToInventory(
  p: Product | Record<string, unknown>,
  resellerCount: number
): InventoryRow {
  const raw = p as Record<string, unknown>;
  const stock = Number(raw.stock ?? 50); // Default stock for mock data
  return {
    id: String(raw.id ?? ""),
    sku: raw.sku ? String(raw.sku) : `SKU-${String(raw.id ?? "").slice(0, 6).toUpperCase()}`,
    name: String(raw.name ?? ""),
    category: String(raw.category_slug || raw.category || "uncategorized"),
    price: Number(raw.price ?? 0),
    stock,
    status:
      stock === 0
        ? "Out of Stock"
        : stock < 15
          ? "Low Stock"
          : "In Stock",
    image: String(raw.image_url || raw.image || ""),
    resellerCount,
    description: raw.description ? String(raw.description) : undefined,
  };
}
