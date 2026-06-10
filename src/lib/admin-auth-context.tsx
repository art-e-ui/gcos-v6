import { useState, useEffect, useRef, type ReactNode } from "react";
import { AdminAuthContext, type AdminSession } from "./admin-auth-context-hooks";
import { supabase } from "./supabase";

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);
  const currentUserRef = useRef<string | null>(null);
  const initialCheckComplete = useRef(false);

  useEffect(() => {
    let mounted = true;

    // Safety fallback: Never stay stuck on loading indefinitely
    const timeoutId = setTimeout(() => {
      if (mounted) {
        console.warn("[ADMIN_AUTH] Session initialization timed out after 8s");
        setLoading(false);
      }
    }, 8000);

    const initializeSession = async () => {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        initialCheckComplete.current = true;
        const user = currentSession?.user;
        if (user && mounted) {
          currentUserRef.current = user.id;
          await fetchAdminProfile(user.id, user.email || '');
        } else if (mounted) {
          console.log("[ADMIN_AUTH] No session found on initial check.");
          setSession(null);
          setLoading(false);
        }
      } catch (e) {
        console.error("Init session error", e);
        initialCheckComplete.current = true;
        if (mounted) setLoading(false);
      } finally {
        if (mounted) clearTimeout(timeoutId);
      }
    };

    initializeSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, sbSession) => {
      console.log(`[ADMIN_AUTH] onAuthStateChange event: ${event}, session: ${!!sbSession}`);
      if (event === 'INITIAL_SESSION') return; // Ignore initial to avoid race condition with getSession
      
      if (!initialCheckComplete.current) {
        console.log(`[ADMIN_AUTH] Discarding event ${event} because initialCheckComplete is false`);
        return;
      }
      
      const user = sbSession?.user;
      if (user) {
        if (currentUserRef.current === user.id) return;
        currentUserRef.current = user.id;
        try {
          await fetchAdminProfile(user.id, user.email || '');
        } catch (error) {
          console.error("[ADMIN_AUTH] Failed to fetch profile inside onAuthStateChange", error);
        }
      } else if (event === 'SIGNED_OUT') {
        console.log("[ADMIN_AUTH] SIGNED_OUT event, setting session to null.");
        currentUserRef.current = null;
        if (mounted) {
          setSession(null);
          setLoading(false);
        }
      }
    });

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []);

  const currentProfileFetch = useRef<{ uid: string, promise: Promise<boolean> } | null>(null);

  const fetchAdminProfile = async (userId: string, email: string): Promise<boolean> => {
    // 1. Concurrency control: prevent duplicate fetches for the same UID
    if (currentProfileFetch.current?.uid === userId) {
      console.log(`[ADMIN_AUTH] Returning existing fetch promise for UID: ${userId}`);
      return currentProfileFetch.current.promise;
    }

    setLoading(true);

    const fetchPromise = (async (): Promise<boolean> => {
      console.log(`[ADMIN_AUTH] Starting profile fetch for UID: ${userId}, Email: ${email}`);
      try {
        const normalizedEmail = email.toLowerCase().trim();
        
        // 2. Fetch timeout protection
        const timeoutPromise = new Promise<{data: null, error: { message: string, code?: string }}>((resolve) => {
          setTimeout(() => resolve({data: null, error: {message: "Supabase query timed out after 15s"}}), 15000);
        });

        // Get user data from 'users' table
        console.log(`[ADMIN_AUTH] Querying users table for UID: ${userId}...`);
        const { data: userData, error: userError } = await Promise.race([
          supabase.from('users').select('*').eq('id', userId).single(),
          timeoutPromise
        ]) as { data: Record<string, unknown> | null, error: { message: string, code?: string } | null };
          
        console.log(`[ADMIN_AUTH] Query users table complete. Error: ${userError?.message || 'None'}`);
        
      if (userError && userError.code !== 'PGRST116') { // PGRST116 is code for no rows returned
        console.error("[ADMIN_AUTH] Failed to get user document:", userError);
        throw userError;
      }

      let currentRole = userData?.role;
      let currentData = userData;

      // 1. Force owner role for specific top-level admin
      if (normalizedEmail === 'arkarnaung009@gmail.com' || normalizedEmail === 'heathercarpe34@gmail.com') {
        if (!currentRole || currentRole !== 'owner') {
          console.log("[ADMIN_AUTH] Provisioning super-owner...");
          const ownerDoc = {
            id: userId,
            email: normalizedEmail,
            first_name: 'System',
            last_name: 'Owner',
            role: 'owner',
            created_at: userData?.created_at || new Date().toISOString()
          };
          console.log("[ADMIN_AUTH] Upserting owner doc...");
          const { data: upsertData, error: upsertError } = await supabase
            .from('users')
            .upsert(ownerDoc)
            .select()
            .single();
          
          if (upsertError) throw upsertError;
          console.log("[ADMIN_AUTH] Upsert owner doc complete.");
          currentData = upsertData;
          currentRole = 'owner';
        }
      }

      console.log(`[ADMIN_AUTH] Validating role: ${currentRole}`);
      // 2. Role validation & Auto-recovery
      const isAuthorizedRole = currentRole && ['owner', 'admin', 'staff'].includes(currentRole);
      
      if (!isAuthorizedRole) {
        console.log("[ADMIN_AUTH] Role unauthorized or missing, searching SLA records for email:", normalizedEmail);
        
        let foundRole: "admin" | "staff" | null = null;
        let foundName = "Admin";
        let foundAccountId = null;

        // Search sla_admins
        console.log("[ADMIN_AUTH] Querying sla_admins...");
        const { data: slaAdminData } = await supabase
          .from('sla_admins')
          .select('*')
          .ilike('email', normalizedEmail)
          .limit(1);
        
        if (slaAdminData && slaAdminData.length > 0) {
          foundRole = 'admin';
          foundName = slaAdminData[0].name || "Admin";
          foundAccountId = slaAdminData[0].account_id;
        } else {
          // Search sla_staff
          console.log("[ADMIN_AUTH] Querying sla_staff...");
          const { data: slaStaffData } = await supabase
            .from('sla_staff')
            .select('*')
            .ilike('email', normalizedEmail)
            .limit(1);
            
          if (slaStaffData && slaStaffData.length > 0) {
            foundRole = 'staff';
            foundName = slaStaffData[0].name || "Staff";
            foundAccountId = slaStaffData[0].staff_id;
          }
        }

        if (foundRole) {
          console.log(`[ADMIN_AUTH] Found valid ${foundRole} record. Provisioning users doc...`);
          const provisionedUser = {
            id: userId,
            email: normalizedEmail,
            first_name: foundName,
            last_name: '',
            role: foundRole,
            created_at: currentData?.created_at || new Date().toISOString()
          };
          console.log("[ADMIN_AUTH] Upserting provisioned user doc...");
          const { data: upsertData, error: upsertError } = await supabase
            .from('users')
            .upsert(provisionedUser)
            .select()
            .single();
            
          if (upsertError) throw upsertError;
          console.log("[ADMIN_AUTH] Upsert provisioned user doc complete.");
          currentData = upsertData;
          currentRole = foundRole;
        }
      }

      if (!currentRole || !['owner', 'admin', 'staff'].includes(currentRole)) {
        console.warn("[ADMIN_AUTH] Final role check failed for UID:", userId);
        setSession(null);
        return false;
      }

      const roleMapping: Record<string, "Owner" | "Admin" | "User"> = {
        owner: "Owner",
        admin: "Admin",
        staff: "User"
      };

      // Ensure accountId is present in session
      let accountId = currentData.account_id || null;
      
      if (!accountId) {
        if (currentRole === 'owner') {
          accountId = 'OWNER-' + userId.substring(0, 8);
        } else if (currentRole === 'admin' || currentRole === 'staff') {
          try {
            const table = currentRole === 'admin' ? 'sla_admins' : 'sla_staff';
            const field = currentRole === 'admin' ? 'account_id' : 'staff_id';
            console.log(`[ADMIN_AUTH] Querying ${table} for accountId...`);
            const { data: slaData } = await supabase
              .from(table)
              .select(field)
              .ilike('email', normalizedEmail)
              .limit(1);
              
            if (slaData && slaData.length > 0) {
              accountId = slaData[0][field];
              console.log(`[ADMIN_AUTH] Found accountId: ${accountId}`);
            }
          } catch (e) {
            console.error(`[ADMIN_AUTH] Error querying SLA tables:`, e);
          }
        }
      }

      console.log("[ADMIN_AUTH] Session establishing for role:", currentRole);
      setSession({
        name: `${currentData.first_name || ''} ${currentData.last_name || ''}`.trim() || 'Admin User',
        email: normalizedEmail,
        role: roleMapping[currentRole],
        accountId: accountId,
        uid: userId
      });
      return true;
    } catch (error: unknown) {
      console.error("[ADMIN_AUTH] Fatal error in fetchAdminProfile:", error);
      // Only clear session on auth-related failure, not network/timeout issues
      if (error && typeof error === 'object' && 'message' in error) {
         const errObj = error as { message: string };
         if (errObj.message.includes('JWT') || errObj.message.includes('Auth')) {
           setSession(null);
         }
      }
      throw error;
    } finally {
      if (currentProfileFetch.current?.uid === userId) {
        currentProfileFetch.current = null;
      }
      setLoading(false);
    }
    })();

    currentProfileFetch.current = { uid: userId, promise: fetchPromise };
    return fetchPromise;
  };

  const signIn = async (email: string, password: string): Promise<{success: boolean, message?: string}> => {
    try {
      setLoading(true);
      const normalizedEmail = email.toLowerCase().trim();
      console.log("Admin sign-in starting for:", normalizedEmail);
      
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: password,
      });

      if (authError) {
        console.error("Supabase Auth sign-in error:", authError.message);
        
        // Auto-provisioning logic if user not found in Auth but exists in SLA
        if (authError.message.includes('Invalid login credentials') || authError.status === 400) {
           console.log("Checking if user is valid for auto-provisioning...");
           
           let isValidToProvision = normalizedEmail === 'arkarnaung009@gmail.com' || normalizedEmail === 'heathercarpe34@gmail.com';
           
           if (!isValidToProvision) {
             const { data: adminMatch } = await supabase.from('sla_admins').select('id').ilike('email', normalizedEmail).limit(1);
             const { data: staffMatch } = await supabase.from('sla_staff').select('id').ilike('email', normalizedEmail).limit(1);
             if ((adminMatch && adminMatch.length > 0) || (staffMatch && staffMatch.length > 0)) {
               isValidToProvision = true;
             }
           }

           if (isValidToProvision) {
             console.log("Auto-provisioning admin user...");
             const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
               email: normalizedEmail,
               password: password,
             });

             if (signUpError) {
               return { success: false, message: signUpError.message };
             }

             if (signUpData.user) {
               const profileSuccess = await fetchAdminProfile(signUpData.user.id, signUpData.user.email || normalizedEmail);
               if (!profileSuccess) {
                 await supabase.auth.signOut();
                 return { success: false, message: "Unauthorized: You do not have admin access." };
               }
               return { success: true };
             }
           }
        }
        
        return { success: false, message: authError.message };
      }

      if (authData.user) {
        currentUserRef.current = authData.user.id;
        const profileSuccess = await fetchAdminProfile(authData.user.id, authData.user.email || normalizedEmail);
        if (!profileSuccess) {
          await supabase.auth.signOut();
          currentUserRef.current = null;
          return { success: false, message: "Unauthorized: You do not have admin access." };
        }
        return { success: true };
      }
      
      return { success: false, message: "Login failed" };
    } catch (e) {
      console.error("Admin sign in error:", e);
      return { success: false, message: e instanceof Error ? e.message : "An unexpected error occurred" };
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  return (
    <AdminAuthContext.Provider value={{ session, signIn, signOut, loading }}>
      {children}
    </AdminAuthContext.Provider>
  );
}
