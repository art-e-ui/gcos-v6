import React, { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { CustomerAuthContext, type CustomerUser } from "./customer-auth-context-hooks";
import { supabase } from "./supabase";

export function CustomerAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CustomerUser | null>(null);
  const [loading, setLoading] = useState(true);
  const initialCheckComplete = useRef(false);

  useEffect(() => {
    let mounted = true;

    // Safety fallback: Never stay stuck on loading indefinitely
    const timeoutId = setTimeout(() => {
      if (mounted) {
        console.warn("[CUSTOMER_AUTH] Context loading timed out after 15s");
        setLoading(false);
      }
    }, 15000);

    const initializeSession = async () => {
      try {
        const { data: { session: sbSession } } = await supabase.auth.getSession();
        initialCheckComplete.current = true;
        if (sbSession?.user) {
          if (mounted) {
            await fetchCustomerProfile(sbSession.user.id, sbSession.user.email || '');
          }
        } else if (mounted) {
          setUser(null);
          setLoading(false);
        }
      } catch (err) {
        console.error("Customer init session error", err);
        initialCheckComplete.current = true;
        if (mounted) {
          setLoading(false);
        }
      } finally {
        if (mounted) clearTimeout(timeoutId);
      }
    };

    initializeSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, sbSession) => {
      console.log(`[CUSTOMER_AUTH] onAuthStateChange event: ${event}, session: ${!!sbSession}`);
      if (event === 'INITIAL_SESSION') return; // Ignore initial to avoid race condition with getSession

      if (!initialCheckComplete.current) {
        console.log(`[CUSTOMER_AUTH] Discarding event ${event} because initialCheckComplete is false`);
        return;
      }

      if (sbSession?.user) {
        if (mounted) {
          try {
            await fetchCustomerProfile(sbSession.user.id, sbSession.user.email || '');
          } catch (error) {
            console.error("[CUSTOMER_AUTH] Failed to fetch profile inside onAuthStateChange", error);
            if (mounted) setLoading(false);
          }
        }
      } else if (event === 'SIGNED_OUT') {
        console.log("[CUSTOMER_AUTH] SIGNED_OUT event, setting user to null.");
        if (mounted) {
          setUser(null);
          setLoading(false);
        }
      }
    });

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    }
  }, []);

  const fetchCustomerProfile = async (userId: string, email: string) => {
    try {
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (userError) {
        console.error("Customer profile fetch failed:", userError);
        setUser(null);
        return;
      }
      
      if (!userData.role) {
        console.log("Customer profile fetch - role missing, defaulting to customer");
        await supabase.from('users').update({ role: 'customer' }).eq('id', userId);
        userData.role = 'customer';
      }

      // Only allow customer role (or others as specified in the logic)
      if (!['customer', 'reseller', 'owner', 'admin'].includes(userData.role)) {
        console.error("Unauthorized role for customer portal:", userData.role);
      }

      setUser({
        id: userId,
        name: `${userData.first_name || ''} ${userData.last_name || ''}`.trim() || 'Customer',
        email: email,
        customerId: `GCID-${userId.substring(0, 6).toUpperCase()}`
      });
    } catch (err) {
      console.error("Error fetching customer profile:", err);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const login = useCallback(async (emailOrPhone: string, password: string) => {
    try {
      const email = emailOrPhone.toLowerCase().trim();
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      
      if (data.user) {
        await fetchCustomerProfile(data.user.id, data.user.email || email);
        return { success: true };
      }
      return { success: false, message: error?.message || "Login failed" };
    } catch (e: unknown) {
      const err = e as { message?: string };
      console.error("Login exception:", err);
      return { success: false, message: err.message || "An unexpected error occurred" };
    }
  }, []);

  const register = useCallback(async (name: string, emailOrPhone: string, password: string) => {
    try {
      const email = emailOrPhone.toLowerCase().trim();
      
      // Split name into first and last
      const nameParts = name.trim().split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (data.user) {
        const userId = data.user.id;
        
        await supabase.from('users').insert({
          id: userId,
          email: email,
          first_name: firstName,
          last_name: lastName,
          role: 'customer'
        });

        await fetchCustomerProfile(userId, data.user.email || email);

        return { success: true };
      }
      return { success: false, message: error?.message || "Registration failed" };
    } catch (e: unknown) {
      const err = e as { message?: string };
      console.error("Registration exception:", err);
      return { success: false, message: err.message || "Registration failed. Please try again." };
    }
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  return (
    <CustomerAuthContext.Provider value={{ user, isAuthenticated: !!user, login, register, logout }}>
      {children}
    </CustomerAuthContext.Provider>
  );
}
