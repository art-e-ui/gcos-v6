import { useCallback, useContext } from 'react';
import { supabase } from '@/lib/supabase';
import { AdminAuthContext } from '@/lib/admin-auth-context-hooks';

export type AdminActionType = 
  | 'LOGIN'
  | 'LOGOUT'
  | 'VIEW_PAGE'
  | 'BUTTON_CLICK'
  | 'ERROR'
  | 'DATA_UPDATE'
  | 'DATA_DELETE'
  | 'DATA_CREATE';

let cachedIp: string | null = null;
const getIpAddress = async () => {
  if (cachedIp) return cachedIp;
  try {
    const res = await fetch('/api/ip');
    if (res.ok) {
      const data = await res.json();
      cachedIp = data.ip;
      if (cachedIp) return cachedIp;
    }
  } catch (e) {
    console.warn("[ADMIN_LOGGER] Failed to get client IP from server API:", e);
  }

  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(2000) });
    const data = await res.json();
    cachedIp = data.ip;
  } catch {
    try {
      const res = await fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(2000) });
      const data = await res.json();
      cachedIp = data.ip;
    } catch {
      cachedIp = 'unknown';
    }
  }
  return cachedIp || 'unknown';
};

export function useAdminLogger() {
  const context = useContext(AdminAuthContext);
  const session = context?.session;

  const logActivity = useCallback(async (
    action: AdminActionType, 
    target: string, 
    details?: Record<string, unknown> | string | null
  ) => {
    try {
      const adminId = session?.uid || 'anonymous';
      const adminEmail = session?.email || 'unknown';
      
      if (action === 'VIEW_PAGE') {
        return;
      }
      
      const ip_address = await getIpAddress();
      
      const { error } = await supabase.from('admin_audit_logs').insert({
        admin_id: adminId,
        admin_email: adminEmail,
        action,
        target,
        details: details || {},
        ip_address,
        created_at: new Date().toISOString()
      });

      if (error) {
        console.error('Failed to log admin activity:', error);
      }
    } catch (e) {
      console.error('Error logging admin activity:', e);
    }
  }, [session]);

  return { logActivity };
}
