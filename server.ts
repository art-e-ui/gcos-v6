import dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { handler } from "./netlify/functions/api";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Body parser for JSON
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // API proxy logic similar to the vite plugin
  app.use('/api', async (req, res) => {
    const start = Date.now();
    console.log(`[API_REQ] ${req.method} ${req.originalUrl}`);
    try {
      const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
      const event = {
        path: req.originalUrl || req.url,
        httpMethod: req.method,
        body: req.body ? JSON.stringify(req.body) : '',
        isBase64Encoded: false,
        queryStringParameters: req.query,
        headers: {
          ...req.headers,
          'client-ip': clientIp,
          'x-forwarded-for': clientIp
        }
      };
      
      const result = await handler(event as unknown as Parameters<typeof handler>[0], {} as unknown as Parameters<typeof handler>[1]);
      
      console.log(`[API_RES] ${req.method} ${req.originalUrl} -> Status ${result.statusCode} (took ${Date.now() - start}ms)`);
      
      if (result.headers) {
        for (const [k, v] of Object.entries(result.headers)) {
          res.setHeader(k, v as string);
        }
      }
      
      if (result.isBase64Encoded && result.body) {
        res.status(result.statusCode).send(Buffer.from(result.body, 'base64'));
      } else {
        res.status(result.statusCode).send(result.body);
      }
    } catch (e) {
      console.error(`[API_ERR] ${req.method} ${req.originalUrl} failed:`, e);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Local background scheduled sync (every 1 minute it checks if it's time to run)
  const startScheduledSync = () => {
    console.log("[SCHEDULED_SYNC] Initializing background local sync checker...");
    const checkInterval = 1 * 60 * 1000; // Check every 1 minute
    
    setInterval(async () => {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
        
        if (!supabaseUrl || !supabaseKey) return;
        const supabase = createClient(supabaseUrl, supabaseKey);

        const { data: settingsData } = await supabase.from('system_settings').select('*');
        const settings: Record<string, string> = {};
        (settingsData || []).forEach(s => {
          if (s.key) settings[s.key] = s.value || '';
        });

        const isEnabled = settings.shopify_sync_enabled === 'true';
        const domain = settings.shopify_store_domain || settings.shopify_domain || '';
        const token = settings.shopify_access_token || settings.shopify_token || '';
        const category = settings.shopify_sync_category || 'Shopify';
        const limit = parseInt(settings.shopify_sync_limit) || 10;
        const frequency = parseInt(settings.shopify_sync_frequency) || 15; // in minutes

        if (!isEnabled || !domain || !token) return;

        // Check last sync time
        const lastSyncTime = settings.shopify_last_sync_time ? new Date(settings.shopify_last_sync_time).getTime() : 0;
        const now = Date.now();
        const diffMinutes = (now - lastSyncTime) / (60 * 1000);

        if (diffMinutes >= frequency) {
          console.log(`[SCHEDULED_SYNC] Local emulator: executing Shopify sync (frequency: ${frequency}m, limit: ${limit})...`);
          const { performShopifySync } = await import('./netlify/functions/utils/shopify');
          const { count, skipped } = await performShopifySync(domain, token, category, limit);
          console.log(`[SCHEDULED_SYNC] Local emulator: successfully synced ${count} products, skipped ${skipped}.`);
          
          await supabase.from('admin_audit_logs').insert({
            action: 'SYSTEM_SYNC',
            details: {
              message: `Local emulator sync: successfully imported ${count} new products from Shopify (skipped ${skipped} existing).`,
              store: domain,
              count,
              skipped
            },
            ip_address: '127.0.0.1',
            source: 'system'
          });
        }
      } catch (e) {
        console.error("[SCHEDULED_SYNC] Local emulator error:", e);
      }
    }, checkInterval);
  };

  // Run scheduler helper
  startScheduledSync();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
