/* eslint-disable @typescript-eslint/no-explicit-any */
import { schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { syncShopifyCatalog } from './utils/shopify';

const runScheduledSync = async (event: any) => {
  console.log('[Scheduled Cron] Core sync cycle starting...');
  
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl) {
    console.error('[Scheduled Cron] Failed: SUPABASE_URL is not configured in Netlify system.');
    return { statusCode: 500, body: 'Missing database connection config' };
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey || process.env.VITE_SUPABASE_ANON_KEY || '');
  
  try {
    // Read all Shopify settings from system_settings table
    const { data: dbSettings, error } = await supabase.from('system_settings').select('*');
    if (error) throw error;
    
    const settingsMap: Record<string, string> = {};
    if (dbSettings) {
      dbSettings.forEach(s => { settingsMap[s.key] = s.value; });
    }
    
    const backgroundSyncEnabled = settingsMap['shopify_background_sync'] === 'true';
    if (!backgroundSyncEnabled) {
      console.log('[Scheduled Cron] Shopify background synchronization is disabled in settings. Skipping run.');
      return { statusCode: 200, body: 'Background sync is turned off in UI settings' };
    }
    
    const domain = (settingsMap['shopify_domain'] || '').trim();
    const token = (settingsMap['shopify_token'] || '').trim();
    const clientId = (settingsMap['shopify_client_id'] || '').trim();
    const clientSecret = (settingsMap['shopify_client_secret'] || '').trim();
    const category = settingsMap['shopify_category'] || 'GC-Special';
    const useGraphQL = settingsMap['shopify_use_graphql'] !== 'false';
    const autoCategory = settingsMap['shopify_auto_category'] !== 'false';
    const overwritePrice = settingsMap['shopify_overwrite_price'] !== 'false';
    const overwriteStock = settingsMap['shopify_overwrite_stock'] !== 'false';
    const defaultRating = parseFloat(settingsMap['shopify_default_rating'] || '4.5') || 4.5;
    const badge = settingsMap['shopify_badge'] || 'Shopify';
    const syncLimit = parseInt(settingsMap['shopify_sync_limit'] || '50') || 50;
    
    if (!domain) {
      console.warn('[Scheduled Cron] Shopify domain setting is empty. Cannot initiate sync.');
      return { statusCode: 400, body: 'Domain not configured' };
    }
    
    console.log('[Scheduled Cron] Dispatching Shopify sync helper...');
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
      syncLimit
    });
    
    console.log('[Scheduled Cron] Sync succeeded:', result.message);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, ...result })
    };
  } catch (err: any) {
    console.error('[Scheduled Cron] Fatal execution error encountered:', err);
    return {
      statusCode: 500,
      body: `Scheduled sync failed: ${err.message || String(err)}`
    };
  }
};

// Netlify Cron Spec: Trigger every 15 minutes
export const handler = schedule("*/15 * * * *", runScheduledSync);
