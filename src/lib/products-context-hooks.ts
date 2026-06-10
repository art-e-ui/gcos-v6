import { createContext, useContext } from "react";
import type { Product, Category } from "@/lib/types";
import { useDbProducts, useDbCategories } from "@/hooks/use-db-products";

export interface ProductsContextType {
  products: Product[];
  categories: Category[];
  isLoading: boolean;
}

export const ProductsContext = createContext<ProductsContextType | undefined>(undefined);

const CATEGORY_DEFAULT_IMAGES: Record<string, string> = {
  electronics: "https://images.unsplash.com/photo-1498049794561-7780e7231661?auto=format&fit=crop&w=200&q=80",
  accessories: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=200&q=80",
  "automotive-parts-&-accessories": "https://images.unsplash.com/photo-1486006920555-c77dce18193b?auto=format&fit=crop&w=200&q=80",
  fragrances: "https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=200&q=80",
  "bags-&-backpacks": "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=200&q=80",
  fashion: "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=200&q=80",
  "home-living": "https://images.unsplash.com/photo-1484101403633-562f891dc89a?auto=format&fit=crop&w=200&q=80",
  "beauty-health": "https://images.unsplash.com/photo-1526947425960-945c6e72858f?auto=format&fit=crop&w=200&q=80",
  "sports-outdoors": "https://images.unsplash.com/photo-1517838277536-f5f99be501cd?auto=format&fit=crop&w=200&q=80",
  "books-stationery": "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=200&q=80",
  clothing: "https://images.unsplash.com/photo-1525507119028-ed4c629a60a3?auto=format&fit=crop&w=200&q=80",
  shoes: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=200&q=80",
  watches: "https://images.unsplash.com/photo-1522312346375-d1a52e2b99b3?auto=format&fit=crop&w=200&q=80",
  jewelry: "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=200&q=80",
};

export function getCategoryImage(slug: string, providedImage?: string, products?: Product[], categoryName?: string): string {
  if (providedImage && providedImage.trim() !== "" && !providedImage.includes("placeholder.svg") && !providedImage.includes("picsum.photos")) {
    return providedImage;
  }

  // Try to find a product image from the inventory for this category
  if (products && categoryName) {
    const productWithImage = products.find(p => 
      p.category && p.category.toLowerCase() === categoryName.toLowerCase() && p.image
    );
    if (productWithImage) {
      return productWithImage.image;
    }
  }

  return CATEGORY_DEFAULT_IMAGES[slug] || `https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=200&q=80`;
}

export function mapCategories(dbCategories: Record<string, unknown>[], products?: Product[]): Category[] {
  return dbCategories.map((c) => {
    const name = String(c.name || "");
    const slug = c.slug ? String(c.slug) : name.toLowerCase().replace(/\s+/g, '-');
    return {
      id: String(c.id),
      name,
      slug,
      image: getCategoryImage(slug, String(c.image ?? ""), products, name),
      count: Number(c.product_count ?? 0),
    };
  });
}

export function useProducts() {
  const ctx = useContext(ProductsContext);
  const { data: dbProducts, isLoading: loadingP } = useDbProducts();
  const { data: dbCategories, isLoading: loadingC } = useDbCategories();

  if (ctx) return ctx;

  const products = dbProducts ?? [];
  const mappedCategories = mapCategories((dbCategories ?? []) as Record<string, unknown>[], products);

  // Derive any categories that exist in products but not in dbCategories
  const uniqueCategorySlugs = new Set(mappedCategories.map(c => c.slug));
  const derivedCategoriesMap = new Map<string, Category>();
  
  products.forEach(p => {
    const pCategory = p.category || "Uncategorized";
    const slug = pCategory.toLowerCase().replace(/\s+/g, '-');
    if (!uniqueCategorySlugs.has(slug)) {
      const existing = derivedCategoriesMap.get(slug);
      if (!existing) {
        derivedCategoriesMap.set(slug, {
          id: slug,
          name: pCategory, // Use the first encountered case variant
          slug: slug,
          image: getCategoryImage(slug, "", products, pCategory),
          count: 1
        });
      } else {
        existing.count = (existing.count || 0) + 1;
      }
    }
  });
  
  const derivedCategories = Array.from(derivedCategoriesMap.values());

  const categories = [...mappedCategories, ...derivedCategories];

  return {
    products,
    categories,
    isLoading: loadingP || loadingC,
  } satisfies ProductsContextType;
}
