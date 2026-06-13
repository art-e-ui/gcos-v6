import type { Handler } from '@netlify/functions';
import * as cheerio from 'cheerio';
import Papa from 'papaparse';
import { createClient } from '@supabase/supabase-js';

// Lazy initialize supabase client
let supabase: ReturnType<typeof createClient> | null = null;

const getSupabase = () => {
  if (supabase) return supabase;
  
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
  if (!supabaseUrl) {
    throw new Error("Missing Supabase URL in environment variables");
  }
  
  if (!supabaseServiceKey) {
    console.warn("WARNING: SUPABASE_SERVICE_ROLE_KEY is missing. Admin endpoints will fail.");
  }
  
  supabase = createClient(supabaseUrl, supabaseServiceKey || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '');
  return supabase;
};

export const handler: Handler = async (event) => {
  // Normalize path mapping
  let path = event.path;
  
  // Strip query string if present (e.g. locally in Express)
  if (path.includes('?')) {
    path = path.split('?')[0];
  }
  
  // If Netlify rewrite provided the route via query param, use it
  if (event.queryStringParameters && event.queryStringParameters.route) {
    path = '/api/' + event.queryStringParameters.route;
  } else if (path.startsWith('/.netlify/functions/api')) {
    path = path.replace('/.netlify/functions/api', '/api');
  }

  // Remove any trailing or duplicate slashes
  path = path.replace(/\/+/g, '/').replace(/\/$/, '');
  if (!path.startsWith('/api')) {
    path = '/api' + path;
  }

  // Helper to parse JSON body safely
  const getBody = () => {
    if (!event.body) return {};
    try {
      return event.isBase64Encoded
        ? JSON.parse(Buffer.from(event.body, 'base64').toString('utf8'))
        : JSON.parse(event.body);
    } catch {
      return {};
    }
  };

  // Helper for JSON responses
  const jsonResponse = (statusCode: number, data: unknown) => {
    return {
      statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(data),
    };
  };

  // Handle CORS Preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      },
      body: '',
    };
  }

  try {
    const supabase = getSupabase();
    switch (path) {
      case '/api/ip': {
        const clientIp = event.headers['client-ip'] || 
                         event.headers['x-nf-client-connection-ip'] || 
                         event.headers['x-forwarded-for'] || 
                         'unknown';
        const ip = (clientIp as string).split(',')[0].trim();
        return jsonResponse(200, { ip });
      }

      case '/api/health':
        return jsonResponse(200, { status: 'ok', timestamp: new Date().toISOString() });

      case '/api/reseller/request-reset': {
        const { email } = getBody();
        if (!email) return jsonResponse(400, { error: 'Email is required' });

        const { data: user, error } = await supabase
          .from('users')
          .select('id')
          .eq('email', email)
          .single();

        if (error || !user) {
          return jsonResponse(404, { error: 'Reseller not found with this email' });
        }

        await supabase
          .from('reseller_profiles')
          .update({
            password_reset_requested: true,
            password_reset_requested_at: new Date().toISOString(),
          })
          .eq('id', user.id);

        return jsonResponse(200, { success: true });
      }

      case '/api/admin/reset-reseller-password': {
        const { resellerId } = getBody();
        if (!resellerId) return jsonResponse(400, { error: 'Reseller ID is required' });

        const { error: authError } = await supabase.auth.admin.updateUserById(resellerId, {
          password: '12345678',
        });

        if (authError) throw authError;

        await supabase
          .from('reseller_profiles')
          .update({
            password_reset_requested: false,
            last_password_reset_at: new Date().toISOString(),
          })
          .eq('id', resellerId);

        return jsonResponse(200, { success: true });
      }

      case '/api/admin/reset-admin-password': {
        const { userId, password } = getBody();
        if (!userId) return jsonResponse(400, { error: 'User ID is required' });
        if (!password) return jsonResponse(400, { error: 'Password is required' });

        const { data: user, error: userError } = await supabase
          .from('users')
          .select('id, role')
          .eq('id', userId)
          .single();

        if (userError || !user) {
          return jsonResponse(404, { error: 'Account not found' });
        }

        if (!['owner', 'admin', 'staff'].includes(user.role.toLowerCase())) {
          return jsonResponse(403, { error: 'Unauthorized: can only reset password for admin, staff, or owner accounts' });
        }

        const { error: authError } = await supabase.auth.admin.updateUserById(userId, {
          password: password,
        });

        if (authError) {
          return jsonResponse(400, { error: authError.message });
        }

        return jsonResponse(200, { success: true });
      }

      case '/api/admin/create-reseller': {
        const { firstName, lastName, email, password, shopName, session } = getBody();

        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (authError) throw authError;

        const userId = authData.user.id;

        await supabase.from('users').insert({
          id: userId,
          email,
          first_name: firstName,
          last_name: lastName,
          role: 'reseller',
          created_at: new Date().toISOString(),
        });

        const shopSlug = shopName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const referralId = 'GC-' + userId.substring(0, 4).toUpperCase();

        const { data: lastReseller } = await supabase
          .from('reseller_profiles')
          .select('reseller_id')
          .order('reseller_id', { ascending: false })
          .limit(1)
          .single();

        const lastResellerId = lastReseller?.reseller_id || 25030;
        const newResellerId = lastResellerId + 1;

        let referredByStaffId = null;
        let memberOfAdminId = null;

        if (session) {
          if (session.role === 'Admin' || session.role === 'Owner') {
            const { data: adminData } = await supabase
              .from('sla_admins')
              .select('id')
              .eq('account_id', session.accountId)
              .single();
            memberOfAdminId = adminData?.id || session.uid;
          } else if (session.role === 'User') {
            const { data: staffData } = await supabase
              .from('sla_staff')
              .select('id, created_by_admin_id')
              .eq('referral_id', session.accountId)
              .single();
            if (staffData) {
              referredByStaffId = staffData.id;
              memberOfAdminId = staffData.created_by_admin_id;
            } else {
              referredByStaffId = session.uid;
              const { data: fallbackStaff } = await supabase
                .from('sla_staff')
                .select('created_by_admin_id')
                .eq('id', referredByStaffId)
                .single();
              if (fallbackStaff) memberOfAdminId = fallbackStaff.created_by_admin_id;
            }
          }
        }

        await supabase.from('reseller_profiles').insert({
          id: userId,
          shop_name: shopName,
          shop_slug: shopSlug + '-' + Math.random().toString(36).substring(2, 6),
          referral_id: referralId,
          balance: 0,
          total_earnings: 0,
          verified: true,
          level: 'VIP-0',
          reseller_id: newResellerId,
          referred_by_staff_id: referredByStaffId,
          member_of_admin_id: memberOfAdminId,
          registration_date: new Date().toISOString(),
        });

        await supabase.from('retail_shops').insert({
          id: userId,
          reseller_id: newResellerId,
          shop_name: shopName,
          level: 'VIP-0',
          product_limit: 20,
          star_rating: 2.0,
          credit_score: 100,
          created_at: new Date().toISOString(),
        });

        return jsonResponse(200, { success: true, userId });
      }

      case '/api/admin/create-admin': {
        const { firstName, lastName, email, password, role, creatorId } = getBody();

        if (!firstName || !lastName || !email || !password || !role) {
          return jsonResponse(400, { error: 'Missing required fields.' });
        }

        const normalizedEmail = email.toLowerCase().trim();

        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
          email: normalizedEmail,
          password,
          email_confirm: true,
        });
        if (authError) throw authError;

        const userId = authData.user.id;

        try {
          const { error: userError } = await supabase.from('users').insert({
            id: userId,
            email: normalizedEmail,
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            role: role.toLowerCase(),
            created_at: new Date().toISOString(),
          });
          if (userError) throw userError;

          const nameCombined = `${firstName.trim()} ${lastName.trim()}`;

          if (role.toLowerCase() === 'admin') {
            const accountId = 'ADM-' + Math.random().toString(36).substring(2, 8).toUpperCase();
            const { error: adminError } = await supabase.from('sla_admins').insert({
              id: userId,
              name: nameCombined,
              email: normalizedEmail,
              account_id: accountId,
              status: 'Active',
              created_at: new Date().toISOString(),
            });
            if (adminError) throw adminError;
          } else if (role.toLowerCase() === 'staff' || role.toLowerCase() === 'user') {
            let createdByAdminId = null;
            let adminAccountId = null;
            if (creatorId) {
              const { data: adminRecord } = await supabase
                .from('sla_admins')
                .select('id, account_id')
                .eq('id', creatorId)
                .limit(1)
                .maybeSingle();

              if (adminRecord) {
                createdByAdminId = adminRecord.id;
                adminAccountId = adminRecord.account_id;
              } else {
                const { data: adminRecordAlt } = await supabase
                  .from('sla_admins')
                  .select('id, account_id')
                  .eq('account_id', creatorId)
                  .limit(1)
                  .maybeSingle();
                if (adminRecordAlt) {
                  createdByAdminId = adminRecordAlt.id;
                  adminAccountId = adminRecordAlt.account_id;
                }
              }
            }

            if (!createdByAdminId) {
              const { data: adminFallback } = await supabase
                .from('sla_admins')
                .select('id, account_id')
                .limit(1)
                .maybeSingle();
              createdByAdminId = adminFallback?.id || null;
              adminAccountId = adminFallback?.account_id || null;
            }

            let generatedStaffId = null;
            if (adminAccountId) {
              const { data: existingStaff } = await supabase
                .from('sla_staff')
                .select('id')
                .eq('created_by_admin_id', createdByAdminId);
              const staffCount = existingStaff ? existingStaff.length : 0;
              generatedStaffId = `${adminAccountId}S${String(staffCount + 1).padStart(2, '0')}`;
            }

            const referralId = generatedStaffId
              ? `${generatedStaffId}${Math.random().toString(36).substring(2, 5).toUpperCase()}`
              : 'STF-' + Math.random().toString(36).substring(2, 8).toUpperCase();

            const { error: staffError } = await supabase.from('sla_staff').insert({
              id: userId,
              name: nameCombined,
              email: normalizedEmail,
              username: normalizedEmail.split('@')[0],
              referral_id: referralId,
              created_by_admin_id: createdByAdminId,
              staff_id: generatedStaffId,
              created_at: new Date().toISOString(),
            });
            if (staffError) throw staffError;
          }

          return jsonResponse(200, { success: true, userId });
        } catch (dbError) {
          console.error('Database insert failed. Slicing/rolling back Supabase Auth User:', dbError);
          await supabase.auth.admin.deleteUser(userId);
          throw dbError;
        }
      }

      case '/api/register-reseller': {
        const { firstName, lastName, emailOrPhone, password, shopName, referralCode, isPhone, uid } =
          getBody();

        if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
          console.error("FATAL: SUPABASE_SERVICE_ROLE_KEY is required for reseller registration");
          return jsonResponse(500, { error: 'Server configuration error: SUPABASE_SERVICE_ROLE_KEY is missing in the production environment. Please add it to your environment variables.' });
        }

        let createdAuthUserId: string | null = null;
        let userId = uid;

        if (!isPhone && !uid) {
          const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: emailOrPhone,
            password: password,
            email_confirm: true,
          });
          if (authError) throw authError;
          userId = authData.user.id;
          createdAuthUserId = userId;
        }

        try {
          const { error: userError } = await supabase.from('users').insert({
            id: userId,
            email: isPhone ? null : emailOrPhone,
            first_name: firstName,
            last_name: lastName,
            role: 'reseller',
            created_at: new Date().toISOString(),
          });
          if (userError) throw userError;

          const shopNameVal = shopName || `${firstName}'s Store`;
          const shopSlug = shopNameVal.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          const referralId = 'GC-' + userId.substring(0, 4).toUpperCase();

          const { data: lastReseller } = await supabase
            .from('reseller_profiles')
            .select('reseller_id')
            .order('reseller_id', { ascending: false })
            .limit(1)
            .maybeSingle();

          const lastResellerId = lastReseller?.reseller_id || 25030;
          const newResellerId = lastResellerId + 1;

          let referredByStaffId = null;
          let memberOfAdminId = null;
          if (referralCode) {
            const { data: staffData } = await supabase
              .from('sla_staff')
              .select('id, created_by_admin_id')
              .eq('referral_id', referralCode.trim().toUpperCase())
              .maybeSingle();

            if (staffData) {
              referredByStaffId = staffData.id;
              memberOfAdminId = staffData.created_by_admin_id;
            } else {
              const { data: adminData } = await supabase
                .from('sla_admins')
                .select('id')
                .eq('account_id', referralCode.trim().toUpperCase())
                .maybeSingle();
              if (adminData) {
                memberOfAdminId = adminData.id;
              }
            }
          }

          const { error: profileError } = await supabase.from('reseller_profiles').insert({
            id: userId,
            first_name: firstName,
            last_name: lastName,
            email: isPhone ? null : emailOrPhone,
            shop_name: shopNameVal,
            shop_slug: shopSlug + '-' + Math.random().toString(36).substring(2, 6),
            referral_id: referralId,
            referral_code: referralCode || null,
            balance: 0,
            total_earnings: 0,
            verified: true,
            level: 'VIP-0',
            reseller_id: newResellerId,
            referred_by_staff_id: referredByStaffId,
            member_of_admin_id: memberOfAdminId,
            registration_date: new Date().toISOString(),
          });
          if (profileError) throw profileError;

          const { error: shopError } = await supabase.from('retail_shops').insert({
            id: userId,
            reseller_id: newResellerId,
            shop_name: shopNameVal,
            shop_slug: shopSlug + '-' + Math.random().toString(36).substring(2, 6),
            level: 'VIP-0',
            product_limit: 20,
            star_rating: 2.0,
            credit_score: 100,
            created_at: new Date().toISOString(),
          });
          if (shopError) throw shopError;

          return jsonResponse(200, { success: true, userId });
        } catch (dbError) {
          console.error('Database registration records failed. Rolling back:', dbError);
          if (createdAuthUserId) {
            await supabase.auth.admin.deleteUser(createdAuthUserId);
          }
          throw dbError;
        }
      }

      case '/api/admin/verify-all': {
        const { data: profiles, error: profilesError } = await supabase
          .from('reseller_profiles')
          .select('*')
          .eq('verified', false);
        if (profilesError) throw profilesError;

        let count = 0;
        for (const profile of profiles || []) {
          await supabase.from('reseller_profiles').update({ verified: true }).eq('id', profile.id);

          const { data: shop } = await supabase
            .from('retail_shops')
            .select('id')
            .eq('id', profile.id)
            .single();
          if (!shop) {
            await supabase.from('retail_shops').insert({
              id: profile.id,
              reseller_id: profile.reseller_id || 0,
              shop_name: profile.shop_name || 'My Retail Shop',
              level: 'VIP-0',
              product_limit: 20,
              star_rating: 2.0,
              credit_score: 100,
              created_at: new Date().toISOString(),
            });
          }
          count++;
        }

        return jsonResponse(200, { success: true, count });
      }

      case '/api/scrape': {
        const { category } = getBody();
        let { url } = getBody();
        if (!url) return jsonResponse(400, { error: 'URL is required' });

        const iframeMatch = url.match(/src=["']([^"']+)["']/);
        if (iframeMatch && iframeMatch[1]) url = iframeMatch[1];
        url = url.replace(/&amp;/g, '&');

        if (url.includes('docs.google.com/spreadsheets')) {
          if (url.includes('/pubhtml')) {
            url = url.includes('?') ? url.replace('/pubhtml?', '/pub?output=csv&') : url.replace('/pubhtml', '/pub?output=csv');
          } else if (url.includes('/pub') && !url.includes('output=csv')) {
            url = url.includes('?') ? `${url}&output=csv` : `${url}?output=csv`;
          } else if (!url.includes('/pub') && !url.includes('/export')) {
            const pubMatch = url.match(/\/d\/e\/([^/?]+)/);
            const standardMatch = url.match(/\/d\/([^/]+)/);
            if (pubMatch && pubMatch[1]) url = `https://docs.google.com/spreadsheets/d/e/${pubMatch[1]}/pub?output=csv`;
            else if (standardMatch && standardMatch[1] && standardMatch[1] !== 'e') url = `https://docs.google.com/spreadsheets/d/${standardMatch[1]}/export?format=csv`;
          }
        }

        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!response.ok) throw new Error(`Failed to fetch URL: ${response.status}`);

        const contentType = response.headers.get('content-type') || '';
        const products: unknown[] = [];

        if (contentType.includes('text/csv') || url.includes('output=csv')) {
          const csvText = await response.text();
          const results = Papa.parse(csvText, { header: true, skipEmptyLines: true });
          const data = results.data as Record<string, unknown>[];

          for (const row of data) {
            const getVal = (keys: string[]) => {
              const foundKey = Object.keys(row).find(k => keys.some(sk => k.trim().toLowerCase() === sk.toLowerCase()));
              return foundKey ? String(row[foundKey] || '').trim() : undefined;
            };
            const name = getVal(['name', 'product name', 'title']);
            const price = parseFloat(String(getVal(['price', 'cost']) || '0').replace(/[^0-9.]/g, ''));
            if (name && price > 0) {
              const stockVal = parseInt(String(getVal(['stock', 'quantity', 'qty']) || '50')) || 50;
              const description = getVal(['description', 'desc']) || name;
              products.push({
                id: `prod-${Math.random().toString(36).substring(2, 9).toUpperCase()}`,
                name,
                price,
                image: getVal(['image url', 'image']) || `https://picsum.photos/seed/${encodeURIComponent(name)}/400/400`,
                category: getVal(['category']) || category || 'uncategorized',
                stock: stockVal,
                in_stock: stockVal > 0,
                sku: getVal(['sku']) || `CSV-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
                description: description,
              });
            }
          }
        } else {
          const html = await response.text();
          const $ = cheerio.load(html);
          $('img').each((i, el) => {
            if (products.length >= 10) return;
            const alt = $(el).attr('alt');
            const src = $(el).attr('src');
            if (alt && alt.length > 10 && src) {
              products.push({
                id: `scrape-${Math.random().toString(36).substring(2, 9).toUpperCase()}`,
                name: alt,
                price: 49.99,
                image: src,
                category: category || 'uncategorized',
                stock: 50,
                in_stock: true,
                sku: `SCRAPE-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
              });
            }
          });
        }
        return jsonResponse(200, { products });
      }

      case '/api/sync': {
        const { products } = getBody();
        if (!Array.isArray(products)) return jsonResponse(400, { error: 'Products array required' });
        for (const product of products) {
          const { data: existing } = await supabase.from('products').select('id').eq('name', product.name).single();
          if (!existing) {
            await supabase.from('products').insert({ ...product, created_at: new Date().toISOString() });
          } else {
            const { id: newId, ...updateData } = product as Record<string, unknown>;
            await supabase.from('products').update({ ...updateData, updated_at: new Date().toISOString() }).eq('id', existing.id);
          }
        }
        return jsonResponse(200, { success: true });
      }

      case '/api/create-support-session': {
        try {
          const { customer_name, is_online, reseller_id, last_message_at } = getBody();
          const { data, error } = await supabase.from('support_sessions').insert({
            customer_name,
            is_online: is_online ?? true,
            reseller_id: reseller_id ?? null,
            last_message_at: last_message_at ?? new Date().toISOString()
          }).select().single();
          if (error) throw error;
          return jsonResponse(200, { success: true, session: data });
        } catch (e) {
          const err = e as Error;
          return jsonResponse(400, { error: err?.message || String(e), details: err });
        }
      }

      case '/api/send-reseller-message': {
        const { session_id, sender, content } = getBody();
        if (!session_id || !content) return jsonResponse(400, { error: 'session_id and content required' });
        
        try {
          const { data, error } = await supabase.from('reseller_chat_messages').insert({
            session_id,
            sender: sender || 'admin',
            content,
            is_read: false,
            created_at: new Date().toISOString()
          }).select().single();
          
          if (error) throw error;
          
          await supabase.from('reseller_chat_sessions').update({ 
            last_message_at: new Date().toISOString() 
          }).eq('id', session_id);
          
          return jsonResponse(200, { success: true, data });
        } catch (e) {
          const err = e as Error;
          return jsonResponse(400, { error: err?.message || String(e), details: err });
        }
      }

      case '/api/send-support-message': {
        try {
          const { session_id, sender, content } = getBody();
          if (!session_id || !content) return jsonResponse(400, { error: 'session_id and content required' });
          
          const { data, error } = await supabase.from('support_messages').insert({
            session_id,
            sender: sender || 'customer',
            content,
            is_read: false,
            created_at: new Date().toISOString()
          }).select().single();
          if (error) throw error;
          
          await supabase.from('support_sessions').update({ 
            last_message_at: new Date().toISOString() 
          }).eq('id', session_id);
          
          return jsonResponse(200, { success: true, data });
        } catch (e) {
          const err = e as Error;
          console.error("send-support-message error:", err);
          return jsonResponse(500, { error: err?.message || String(e) });
        }
      }

      case '/api/get-support-messages': {
        if (event.httpMethod === 'OPTIONS') return jsonResponse(200, {});
        
        let sessionId;
        if (event.httpMethod === 'POST') {
          const body = getBody();
          sessionId = body.session_id;
        } else {
          sessionId = event.queryStringParameters?.session_id;
        }
        
        if (!sessionId) return jsonResponse(400, { error: 'session_id required' });
        
        const { data, error } = await supabase
          .from('support_messages')
          .select('*')
          .eq('session_id', sessionId)
          .order('created_at', { ascending: false })
          .limit(30);
          
        if (error) throw error;
        return jsonResponse(200, { success: true, data });
      }

      case '/api/mark-support-read': {
        const { message_ids } = getBody();
        if (!message_ids || !Array.isArray(message_ids)) return jsonResponse(400, { error: 'message_ids array required' });
        
        const { data, error } = await supabase
          .from('support_messages')
          .update({ is_read: true })
          .in('id', message_ids)
          .select();
          
        if (error) throw error;
        return jsonResponse(200, { success: true, data });
      }

      case '/api/send-notification': {
        return jsonResponse(200, { success: true, message: 'Notification sent successfully (stub)' });
      }

      case '/api/upload-image': {
        const { path: storagePath, data } = getBody();
        if (!storagePath || !data) return jsonResponse(400, { error: 'Path and data are required' });
        
        let fileBody: Buffer | string = data;
        let contentType = 'application/octet-stream';

        if (typeof data === 'string' && data.includes(',')) {
          const parts = data.split(',');
          contentType = parts[0].split(':')[1].split(';')[0];
          fileBody = Buffer.from(parts[1], 'base64');
        }

        const bucket = 'uploads';
        
        // Attempt upload
        let { data: uploadData, error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(storagePath, fileBody, {
            contentType,
            upsert: true
          });

        if (uploadError && (uploadError.message.includes("Bucket not found") || uploadError.message.includes("does not exist"))) {
          await supabase.storage.createBucket(bucket, { public: true });
          const retry = await supabase.storage.from(bucket).upload(storagePath, fileBody, { contentType, upsert: true });
          uploadError = retry.error;
          uploadData = retry.data;
        }

        if (uploadError) {
          throw uploadError;
        }
        
        const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(storagePath);
        return jsonResponse(200, { url: publicUrlData.publicUrl });
      }

      case '/api/proxy-image': {
        const imageUrl = event.queryStringParameters?.url;
        if (!imageUrl) return jsonResponse(400, { error: 'URL parameter is required' });

        const serveFallbackError = (url: string, status: number, reason: string) => {
          console.warn(`[IMAGE_PROXY_WARN] Returning ${status} for ${url}. Reason: ${reason}`);
          return {
            statusCode: status,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-store',
            },
            body: JSON.stringify({ error: 'IMAGE_LOAD_FAILED', message: reason }),
          };
        };

        try {
          // Use no-referrer and a reasonable timeout
          const response = await fetch(imageUrl, { 
            headers: { 'Referer': '' },
            signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined 
          });

          if (!response.ok) {
            return serveFallbackError(imageUrl, 410, `Source returned ${response.status}: ${response.statusText}`);
          }

          const contentType = response.headers.get('content-type') || 'image/jpeg';
          const buffer = await response.arrayBuffer();
          
          return {
            statusCode: 200,
            headers: {
              'Content-Type': contentType,
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'public, max-age=86400',
              'X-Content-Type-Options': 'nosniff'
            },
            body: Buffer.from(buffer).toString('base64'),
            isBase64Encoded: true,
          };
        } catch (err: any) {
          return serveFallbackError(imageUrl, 410, err?.message || 'Connection failed');
        }
      }

      case '/api/get-settings': {
        const supabase = getSupabase();
        const { data, error } = await supabase.from('system_settings').select('*');
        if (error) throw error;
        
        const settings: Record<string, string> = {};
        (data || []).forEach(s => {
          if (s.key) settings[s.key] = s.value || '';
        });
        return jsonResponse(200, settings);
      }

      case '/api/save-settings': {
        const supabase = getSupabase();
        const payload = getBody();
        for (const [key, value] of Object.entries(payload)) {
          const { error } = await supabase
            .from('system_settings')
            .upsert({ 
              key, 
              value: String(value),
              category: 'shopify',
              label: key.replace(/_/g, ' ')
            }, { onConflict: 'key' });
          if (error) throw error;
        }
        return jsonResponse(200, { success: true });
      }

      case '/api/shopify-sync': {
        const {
          domain,
          token,
          clientId,
          clientSecret,
          category,
          rawLimit,
          limit,
          useGraphQL,
          autoCategory,
          overwritePrice,
          overwriteStock,
          defaultRating,
          badge
        } = getBody();

        if (!domain || (!token && (!clientId || !clientSecret))) {
          return jsonResponse(400, { error: 'Shopify Store Domain and either an Access Token OR both Client ID & Client Secret are required.' });
        }
        const parsedLimit = parseInt(rawLimit || limit) || 10;
        
        try {
          const { performShopifySync } = await import('./utils/shopify');
          const { count, skipped } = await performShopifySync(domain, token || '', category, parsedLimit, {
            clientId,
            clientSecret,
            useGraphQL,
            autoCategory,
            overwritePrice,
            overwriteStock,
            defaultRating,
            badge
          });
          return jsonResponse(200, { 
            count, 
            skipped,
            message: `Successfully synced ${count} products (skipped ${skipped} already existing) from Shopify store ${domain}!` 
          });
        } catch (shopifyErr: unknown) {
          console.error("Shopify Sync failure:", shopifyErr);
          const errMsg = shopifyErr instanceof Error ? shopifyErr.message : String(shopifyErr);
          return jsonResponse(500, { error: `Shopify Sync Failed: ${errMsg}` });
        }
      }

      default:
        return jsonResponse(404, { error: 'Endpoint not found: ' + path });
    }
  } catch (error) {
    console.error('API Error:', error);
    return jsonResponse(500, { 
      error: error instanceof Error ? error.message : 'Internal Server Error' 
    });
  }
};
