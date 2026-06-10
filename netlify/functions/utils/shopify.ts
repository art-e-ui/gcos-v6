/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js';

export interface ShopifyGraphQLProduct {
  id: string;
  title: string;
  descriptionHtml?: string;
  productType?: string;
  tags?: string[];
  vendor?: string;
  status?: string;
  totalInventory?: number;
  featuredImage?: {
    url: string;
  };
  variants?: {
    edges?: Array<{
      node: {
        id: string;
        price?: string;
        sku?: string;
        inventoryQuantity?: number;
      };
    }>;
  };
}

export interface SyncedProduct {
  id: string;
  name: string;
  price: number;
  image: string;
  category: string;
  stock: number;
  in_stock: boolean;
  sku: string;
  description: string;
  seller?: string;
  badge?: string;
  rating?: number;
}

function normalizeString(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export async function syncShopifyCatalog(
  supabase: ReturnType<typeof createClient>,
  params: {
    domain: string;
    token?: string;
    clientId?: string;
    clientSecret?: string;
    category: string;
    useGraphQL: boolean;
    autoCategory: boolean;
    overwritePrice: boolean;
    overwriteStock: boolean;
    defaultRating?: number;
    badge?: string;
    syncLimit?: number;
  }
) {
  const logs: string[] = [];
  const timestamp = () => `[${new Date().toLocaleTimeString('en-US', { hour12: false })}]`;
  const log = (msg: string) => logs.push(`${timestamp()} ${msg}`);

  let cleanDomain = params.domain.trim().toLowerCase();
  cleanDomain = cleanDomain.replace(/^(https?:\/\/)?(www\.)?/, '');
  cleanDomain = cleanDomain.split('/')[0];

  if (!cleanDomain.includes('.myshopify.com')) {
    cleanDomain = `${cleanDomain}.myshopify.com`;
  }

  log(`Initiating Shopify synchronization sequence for ${cleanDomain}...`);

  let activeToken = (params.token || '').trim();
  const isDirectToken = activeToken.startsWith('shpat_') || activeToken.startsWith('shpss_');

  // 1. Authorization Code Exchange
  if (activeToken && !isDirectToken) {
    log(`Token detected as potential temporary Authorization Code (not starting with shpat_ or shpss_). Exchanging code for permanent token...`);
    if (!params.clientId || !params.clientSecret) {
      throw new Error("Client ID and Client Secret are required for Shopify Authorization Code Exchange.");
    }

    try {
      const exchangeUrl = `https://${cleanDomain}/admin/oauth/access_token`;
      const response = await fetch(exchangeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: params.clientId.trim(),
          client_secret: params.clientSecret.trim(),
          code: activeToken,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Shopify oauth code exchange failed: ${response.status} ${errText}`);
      }

      const resBody = await response.json() as { access_token?: string };
      if (resBody.access_token) {
        activeToken = resBody.access_token;
        log(`Authorization code exchange successful. Permanent shpat_ token retrieved.`);
        
        // Save back to system_settings
        await supabase.from('system_settings').upsert({
          key: 'shopify_token',
          value: activeToken,
          category: 'shopify',
          label: 'Shopify Admin Access Token'
        }, { onConflict: 'key' });
        log(`Permanent token persisted to system settings.`);
      } else {
        throw new Error("No access_token returned from code exchange response.");
      }
    } catch (err: any) {
      log(`Error during oauth code exchange: ${err.message}`);
      throw err;
    }
  }

  // 2. Client Credentials Flow (Fallback if empty Token field but Client Credentials exist)
  if (!activeToken && params.clientId && params.clientSecret) {
    log(`Token field is empty, but Client ID and Client Secret are present. Checking for cached client credentials token...`);
    
    const { data: cachedTokenRow } = await supabase.from('system_settings').select('*').eq('key', 'shopify_temp_token').maybeSingle();
    const { data: cachedExpiryRow } = await supabase.from('system_settings').select('*').eq('key', 'shopify_temp_token_expires_at').maybeSingle();

    const cachedToken = cachedTokenRow?.value;
    const expiresAtStr = cachedExpiryRow?.value;
    const isExpired = !expiresAtStr || new Date() > new Date(expiresAtStr);

    if (cachedToken && !isExpired) {
      activeToken = cachedToken;
      log(`Using cached 24-hour client credentials token (expiry: ${expiresAtStr}).`);
    } else {
      log(`Cached 24h temporary token is missing or expired. Authenticating with grant_type=client_credentials...`);
      try {
        const exchangeUrl = `https://${cleanDomain}/admin/oauth/access_token`;
        const response = await fetch(exchangeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: params.clientId.trim(),
            client_secret: params.clientSecret.trim(),
            grant_type: 'client_credentials',
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Shopify client credentials flow failed: ${response.status} ${errText}`);
        }

        const resBody = await response.json() as { access_token?: string; expires_in?: number };
        if (resBody.access_token) {
          activeToken = resBody.access_token;
          log(`Client credentials authentication successful. Temporary token retrieved.`);
          
          const newExpiresInSec = resBody.expires_in || 86400;
          const expiryDate = new Date(Date.now() + newExpiresInSec * 1000);
          
          await supabase.from('system_settings').upsert({
            key: 'shopify_temp_token',
            value: activeToken,
            category: 'shopify',
            label: 'Shopify Temp Access Token'
          }, { onConflict: 'key' });

          await supabase.from('system_settings').upsert({
            key: 'shopify_temp_token_expires_at',
            value: expiryDate.toISOString(),
            category: 'shopify',
            label: 'Shopify Temp Access Token Expires At'
          }, { onConflict: 'key' });

          log(`Temporary token cached until ${expiryDate.toISOString()}.`);
        } else {
          throw new Error("No access_token returned from Client Credentials response.");
        }
      } catch (err: any) {
        log(`Error during Client Credentials Token Retrieval: ${err.message}`);
        throw err;
      }
    }
  }

  if (!activeToken) {
    throw new Error("Shopify synchronizer failed to authorize: Token field, code, and Client Credentials are empty.");
  }

  // Fetch unique categories currently in database for Auto-Category Mapping
  let dbCategories: string[] = [];
  try {
    const { data: checkCats } = await supabase.from('products').select('category');
    if (checkCats) {
      dbCategories = Array.from(new Set(checkCats.map(r => r.category).filter(Boolean)));
    }
  } catch (err) {
    log(`Failed to retrieve dynamic database categories: ${err instanceof Error ? err.message : String(err)}. Falling back to default.`);
  }

  const matchCategory = (prodType: string, prodTags: string[]): { matchedCategory: string; reason: string } => {
    const typeStr = (prodType || '').trim();
    const tagsArr = prodTags || [];

    if (dbCategories.length > 0) {
      const normType = normalizeString(typeStr);
      
      // 1. Attempt match on existing database categories using product type
      if (normType) {
        const match = dbCategories.find(c => {
          const normC = normalizeString(c);
          return normC.includes(normType) || normType.includes(normC);
        });
        if (match) {
          return { matchedCategory: match, reason: `Matched database category via productType "${typeStr}"` };
        }
      }

      // 2. Try tags match on existing database categories
      for (const tag of tagsArr) {
        const normTag = normalizeString(tag);
        if (!normTag) continue;
        const match = dbCategories.find(c => {
          const normC = normalizeString(c);
          return normC.includes(normTag) || normTag.includes(normC);
        });
        if (match) {
          return { matchedCategory: match, reason: `Matched database category via product tag "${tag}"` };
        }
      }
    }

    // 3. Fallback: If no database match is found, use Shopify's productType directly if it exists
    if (typeStr) {
      return { matchedCategory: typeStr, reason: `Used Shopify productType "${typeStr}" directly` };
    }

    // 4. Default Fallback: Use the fallback parameter if no productType is set
    return { matchedCategory: params.category || 'Shopify Catalog', reason: 'No productType found. Applying default.' };
  };

  const limitValue = params.syncLimit || 50;
  const targetNewInserts = limitValue;
  let parsedProducts: SyncedProduct[] = [];
  let insertsCount = 0;
  let skippedCount = 0;

  if (params.useGraphQL) {
    log(`Querying Shopify GraphQL Admin API (Newest First, limit: ${limitValue}).`);
    const graphqlUrl = `https://${cleanDomain}/admin/api/2024-01/graphql.json`;
    
    const graphqlQuery = `
      query getShopifyProducts($first: Int!, $after: String) {
        products(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              title
              descriptionHtml
              productType
              tags
              vendor
              status
              totalInventory
              featuredImage {
                url
              }
              variants(first: 5) {
                edges {
                  node {
                    id
                    price
                    sku
                    inventoryQuantity
                  }
                }
              }
            }
          }
        }
      }
    `;

    let hasNextPage = true;
    let endCursor: string | null = null;
    const pageSize = Math.min(limitValue, 50);

    while (hasNextPage && insertsCount < targetNewInserts) {
      log(`Fetching GraphQL page (pageSize: ${pageSize}, cursor: ${endCursor}) - Inserts progress: ${insertsCount}/${targetNewInserts}`);
      
      const response = await fetch(graphqlUrl, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': activeToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: graphqlQuery,
          variables: { 
            first: pageSize,
            after: endCursor 
          }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Shopify GraphQL API returned status ${response.status}: ${errText}`);
      }

      const result = await response.json() as any;
      if (result.errors && result.errors.length > 0) {
        throw new Error(`Shopify GraphQL returned errors: ${result.errors.map((e: any) => e.message).join(', ')}`);
      }

      const pageInfo = result?.data?.products?.pageInfo;
      hasNextPage = pageInfo?.hasNextPage || false;
      endCursor = pageInfo?.endCursor || null;

      const edges = (result?.data?.products?.edges || []) as Array<{ node: ShopifyGraphQLProduct }>;
      log(`Fetched ${edges.length} raw products in this page.`);
      
      if (edges.length === 0) {
        break;
      }

      for (const edge of edges) {
        if (insertsCount >= targetNewInserts) {
          log(`Target new inserts reached (${insertsCount}/${targetNewInserts}). Breaking product processing.`);
          break;
        }

        const node = edge.node;
        const numericId = node.id ? node.id.split('/').pop() : String(Math.floor(Math.random() * 10000000));
        const variants = node.variants?.edges?.map((ve) => ve.node) || [];
        const firstVariant = variants[0] || {};
        const firstImage = node.featuredImage?.url || '';
        const rawDescription = node.descriptionHtml || '';
        const plainDescription = rawDescription.replace(/<[^>]*>/g, '').trim();

        const tags = Array.isArray(node.tags) ? node.tags : [];
        const categoryMatch = params.autoCategory 
          ? matchCategory(node.productType || '', tags)
          : { matchedCategory: params.category || 'Shopify Catalog', reason: 'Preset categories mapping' };

        const product: SyncedProduct = {
          id: `shopify-${numericId}`,
          name: node.title || 'Unnamed Shopify Product',
          price: parseFloat(firstVariant.price || '0') || 49.99,
          image: firstImage,
          category: categoryMatch.matchedCategory,
          stock: node.totalInventory !== undefined ? node.totalInventory : (firstVariant.inventoryQuantity !== undefined ? firstVariant.inventoryQuantity : 100),
          in_stock: node.status === 'ACTIVE' || node.status === 'active' || (node.totalInventory !== undefined && node.totalInventory > 0),
          sku: firstVariant.sku || `SHPF-${numericId}`,
          description: plainDescription || node.title,
          seller: node.vendor || 'Shopify Supplier',
          badge: params.badge || 'Shopify',
          rating: params.defaultRating !== undefined ? params.defaultRating : 4.5,
        };

        const { data: skuCheck } = await supabase
          .from('products')
          .select('id, sku')
          .eq('sku', product.sku)
          .maybeSingle();

        if (skuCheck) {
          log(`[SKIP] Product with SKU "${product.sku}" ("${product.name}") is already in database. Skipped to prevent overwrite.`);
          skippedCount++;
          continue;
        }

        const { data: nameCheck } = await supabase
          .from('products')
          .select('id, name')
          .eq('name', product.name)
          .maybeSingle();

        if (nameCheck) {
          log(`[SKIP] Product with Name "${product.name}" is already in database (ID: ${nameCheck.id}). Skipped to prevent overwrite.`);
          skippedCount++;
          continue;
        }

        const { error: insertErr } = await supabase.from('products').insert({
          id: product.id,
          name: product.name,
          price: product.price,
          image: product.image,
          category: product.category,
          stock: product.stock,
          in_stock: product.in_stock,
          sku: product.sku,
          description: product.description,
          seller: product.seller,
          badge: product.badge,
          rating: product.rating,
          created_at: new Date().toISOString()
        });

        if (insertErr) {
          log(`[ERROR] Failed to save "${product.name}" into database: ${insertErr.message}`);
        } else {
          log(`[INSERT] Imported product "${product.name}" successfully (SKU: ${product.sku}).`);
          insertsCount++;
        }

        parsedProducts.push(product);
      }
    }
  } else {
    log(`Querying Shopify REST API (limit: ${limitValue}).`);
    const restUrl = `https://${cleanDomain}/admin/api/2024-01/products.json?limit=${limitValue}`;
    
    const response = await fetch(restUrl, {
      headers: {
        'X-Shopify-Access-Token': activeToken,
        'Content-Type': 'application/json',
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Shopify REST API responded with status ${response.status}: ${errText}`);
    }

    const data = await response.json() as any;
    const shopifyProducts = data.products || [];
    log(`Successfully fetched ${shopifyProducts.length} raw products via REST.`);

    parsedProducts = shopifyProducts.map((p: any) => {
      const firstVariant = p.variants?.[0] || {};
      const firstImage = p.images?.[0]?.src || p.image?.src || '';
      const rawDescription = p.body_html || '';
      const plainDescription = rawDescription.replace(/<[^>]*>/g, '').trim();

      const tagsArray = typeof p.tags === 'string' 
        ? p.tags.split(',').map((t: string) => t.trim()) 
        : (Array.isArray(p.tags) ? p.tags : []);

      const categoryMatch = params.autoCategory 
        ? matchCategory(p.product_type || '', tagsArray)
        : { matchedCategory: params.category || 'Shopify Catalog', reason: 'Preset categories mapping' };

      return {
        id: `shopify-${p.id}`,
        name: p.title || 'Unnamed Shopify Product',
        price: parseFloat(firstVariant.price || '0') || 49.99,
        image: firstImage,
        category: categoryMatch.matchedCategory,
        stock: firstVariant.inventory_quantity !== undefined ? firstVariant.inventory_quantity : 100,
        in_stock: firstVariant.inventory_quantity !== undefined ? (firstVariant.inventory_quantity > 0) : true,
        sku: firstVariant.sku || `SHPF-${p.id}`,
        description: plainDescription || p.title,
        seller: p.vendor || 'Shopify Supplier',
        badge: params.badge || 'Shopify',
        rating: params.defaultRating !== undefined ? params.defaultRating : 4.5,
      };
    });

    if (parsedProducts.length === 0) {
      log(`Shopify sync finished: No products returned from host server.`);
      return { count: 0, inserts: 0, skipped: 0, logs, message: 'No Shopify products found.' };
    }

    for (const product of parsedProducts) {
      const { data: skuCheck } = await supabase
        .from('products')
        .select('id, sku')
        .eq('sku', product.sku)
        .maybeSingle();

      if (skuCheck) {
        log(`[SKIP] Product with SKU "${product.sku}" ("${product.name}") is already in database. Skipped to prevent overwrite.`);
        skippedCount++;
        continue;
      }

      const { data: nameCheck } = await supabase
        .from('products')
        .select('id, name')
        .eq('name', product.name)
        .maybeSingle();

      if (nameCheck) {
        log(`[SKIP] Product with Name "${product.name}" is already in database (ID: ${nameCheck.id}). Skipped to prevent overwrite.`);
        skippedCount++;
        continue;
      }

      const { error: insertErr } = await supabase.from('products').insert({
        id: product.id,
        name: product.name,
        price: product.price,
        image: product.image,
        category: product.category,
        stock: product.stock,
        in_stock: product.in_stock,
        sku: product.sku,
        description: product.description,
        seller: product.seller,
        badge: product.badge,
        rating: product.rating,
        created_at: new Date().toISOString()
      });

      if (insertErr) {
        log(`[ERROR] Failed to save "${product.name}" into database: ${insertErr.message}`);
      } else {
        log(`[INSERT] Imported product "${product.name}" successfully (SKU: ${product.sku}).`);
        insertsCount++;
      }
    }
  }

  await supabase.from('system_settings').upsert({
    key: 'shopify_last_sync_time',
    value: new Date().toISOString(),
    category: 'shopify',
    label: 'Shopify Last Sync Timestamp'
  }, { onConflict: 'key' });

  log(`Synchronization transaction completed: processed ${parsedProducts.length} items (${insertsCount} inserted, ${skippedCount} skipped).`);

  return {
    count: parsedProducts.length,
    inserts: insertsCount,
    skipped: skippedCount,
    logs,
    message: `Import complete. Inserted ${insertsCount} new unique items, skipped ${skippedCount} existing products.`
  };
}

export async function performShopifySync(
  domain: string,
  token: string,
  category: string,
  limit: number,
  extra?: {
    clientId?: string;
    clientSecret?: string;
    useGraphQL?: boolean | string;
    autoCategory?: boolean | string;
    overwritePrice?: boolean | string;
    overwriteStock?: boolean | string;
    defaultRating?: number | string;
    badge?: string;
  }
): Promise<{ count: number; skipped: number }> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl) {
    throw new Error("Missing Supabase URL in environment variables");
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '');

  // Fetch settings from system_settings table to resolve Graphql & client credentials configurations
  const { data: dbSettings } = await supabase.from('system_settings').select('*');
  const settingsMap: Record<string, string> = {};
  (dbSettings || []).forEach(s => {
    if (s.key) settingsMap[s.key] = s.value || '';
  });

  const parseBool = (val: any, defaultVal: boolean): boolean => {
    if (val === undefined || val === null) return defaultVal;
    if (typeof val === 'boolean') return val;
    return val !== 'false';
  };

  const clientId = extra?.clientId !== undefined ? extra.clientId : (settingsMap['shopify_client_id'] || '');
  const clientSecret = extra?.clientSecret !== undefined ? extra.clientSecret : (settingsMap['shopify_client_secret'] || '');
  const useGraphQL = parseBool(extra?.useGraphQL, settingsMap['shopify_use_graphql'] !== 'false');
  const autoCategory = parseBool(extra?.autoCategory, settingsMap['shopify_auto_category'] !== 'false');
  const overwritePrice = parseBool(extra?.overwritePrice, settingsMap['shopify_overwrite_price'] !== 'false');
  const overwriteStock = parseBool(extra?.overwriteStock, settingsMap['shopify_overwrite_stock'] !== 'false');
  const defaultRating = extra?.defaultRating !== undefined ? (typeof extra.defaultRating === 'number' ? extra.defaultRating : parseFloat(String(extra.defaultRating)) || 4.5) : (parseFloat(settingsMap['shopify_default_rating'] || '4.5') || 4.5);
  const badge = extra?.badge !== undefined ? extra.badge : (settingsMap['shopify_badge'] || 'Shopify');

  const result = await syncShopifyCatalog(supabase, {
    domain,
    token,
    clientId,
    clientSecret,
    category,
    useGraphQL,
    autoCategory,
    overwritePrice,
    overwriteStock,
    defaultRating,
    badge,
    syncLimit: limit
  });

  return {
    count: result.inserts || 0,
    skipped: result.skipped || 0
  };
}
