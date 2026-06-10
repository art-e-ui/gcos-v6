import React, { useState, useEffect, useRef } from "react";
import { useDbProducts } from "@/hooks/use-db-products";
import type { Product } from "@/lib/types";
import { ResellerContext, type ResellerProfile, type StoreTheme, getLevelByDeposit } from "@/lib/reseller-context-hooks";
import { supabase } from "./supabase";
import { useFcmToken } from "@/hooks/use-fcm-token";

interface CustomSettings {
  shopLogo?: string;
  shopHeroBanner?: string;
  storeTheme?: string;
  profilePicture?: string;
  usdtAddress?: string;
  bankInfo?: {
    bankName: string;
    accountName: string;
    accountNumber: string;
  };
}

const DEFAULT_PROFILE_TEMPLATE: Omit<ResellerProfile, "id" | "resellerId" | "firstName" | "lastName" | "email" | "shopName"> = {
  profilePicture: "",
  phone: "",
  shopLogo: "",
  shopHeroBanner: "",
  storeTheme: "minimal",
  level: "VIP-0",
  verified: false,
  balance: 0,
  pendingBalance: 0,
  unpickedBalance: 0,
  guaranteeBalance: 0,
  totalEarnings: 0,
  totalOrders: 0,
  totalDeposits: 0,
  pendingOrders: 0,
  selectedProductIds: [],
  joinedAt: new Date().toISOString(),
  shopLevel: "VIP-0",
  storeRating: 2.0,
  creditLimit: 100,
  creditScore: 100,
  productLimit: 20,
  starRating: 2.0,
  usdtAddress: "",
  bankInfo: { bankName: "", accountName: "", accountNumber: "" },
};

import { RealtimeChannel } from "@supabase/supabase-js";

export function ResellerProvider({ children }: { children: React.ReactNode }) {
  const [reseller, setReseller] = useState<ResellerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const { data: products = [] } = useDbProducts();

  // Register FCM token for push notifications
  useFcmToken();

  const currentUserRef = React.useRef<string | null>(null);
  const initialCheckComplete = useRef(false);
  
  useEffect(() => {
    let mounted = true;
    let profileChannel: RealtimeChannel | null = null;
    let userChannel: RealtimeChannel | null = null;
    let selectionChannel: RealtimeChannel | null = null;
    let shopChannel: RealtimeChannel | null = null;

    // Safety fallback: Never stay stuck on loading indefinitely
    const timeoutId = setTimeout(() => {
      if (mounted) {
        console.warn("[RESELLER] Context loading timed out after 15s");
        setLoading(false);
      }
    }, 15000);

    const initializeResellerSession = async () => {
      try {
        const { data: { session: sbSession } } = await supabase.auth.getSession();
        initialCheckComplete.current = true;
        const user = sbSession?.user;
        if (user && mounted) {
          currentUserRef.current = user.id;
          await fetchProfile(user.id, user.email || '');
        } else if (mounted) {
          console.log("[RESELLER] No session found on initial session check.");
          setReseller(null);
          setLoading(false);
        }
      } catch (e) {
        console.error("Reseller init session error", e);
        initialCheckComplete.current = true;
        if (mounted) setLoading(false);
      } finally {
        clearTimeout(timeoutId);
      }
    };

    initializeResellerSession();

    let channelsSetupUserId: string | null = null;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, sbSession) => {
      console.log(`[RESELLER] onAuthStateChange event: ${event}, session: ${!!sbSession}`);
      if (event === 'INITIAL_SESSION') return; // Ignore initial to avoid race condition with getSession
      
      if (!initialCheckComplete.current) {
        console.log(`[RESELLER] Discarding event ${event} because initialCheckComplete is false`);
        return;
      }
      
      const user = sbSession?.user;
      
      if (user) {
        if (currentUserRef.current !== user.id) {
          currentUserRef.current = user.id;
          try {
            await fetchProfile(user.id, user.email || '');
          } catch (error) {
            console.error("[RESELLER] Failed to fetch profile inside onAuthStateChange", error);
          }
        }
        
        if (!mounted) return;

        if (channelsSetupUserId === user.id) return;
        channelsSetupUserId = user.id;

        // Cleanup previous channels if they exist
        if (profileChannel) supabase.removeChannel(profileChannel);
        if (userChannel) supabase.removeChannel(userChannel);
        if (selectionChannel) supabase.removeChannel(selectionChannel);
        if (shopChannel) supabase.removeChannel(shopChannel);

        // Setup real-time listener for the reseller profile
        profileChannel = supabase
          .channel(`public:reseller_profiles:${user.id}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'reseller_profiles', filter: `id=eq.${user.id}` }, (payload) => {
            const profileData = payload.new as Record<string, unknown>;
            if (profileData && mounted) {
              setReseller(prev => {
                if (!prev) return null;
                
                let custom: CustomSettings = {};
                try {
                  if (profileData.payment_method) {
                    custom = typeof profileData.payment_method === 'string'
                      ? JSON.parse(profileData.payment_method)
                      : profileData.payment_method as unknown as CustomSettings;
                  }
                } catch (e) {
                  console.error("Error parsing payment_method:", e);
                }

                let bankInfoObj = { bankName: '', accountName: '', accountNumber: '' };
                const rawBankInfo = custom.bankInfo;
                if (rawBankInfo) {
                  try {
                    bankInfoObj = typeof rawBankInfo === 'string' ? JSON.parse(rawBankInfo) : rawBankInfo;
                  } catch (e) {
                    console.error("Error parsing bankInfo:", e);
                  }
                }

                return {
                  ...prev,
                  resellerId: profileData.reseller_id || 0,
                  phone: profileData.phone || '',
                  profilePicture: profileData.profile_picture || custom.profilePicture || '',
                  shopName: profileData.shop_name || 'My Shop',
                  shopSlug: profileData.shop_slug || '',
                  shopLogo: profileData.shop_logo || custom.shopLogo || '',
                  shopHeroBanner: profileData.shop_hero_banner || custom.shopHeroBanner || '',
                  storeTheme: profileData.store_theme || (custom.storeTheme as StoreTheme) || 'minimal',
                  verified: profileData.verified || false,
                  balance: Number(profileData.balance || 0),
                  pendingBalance: Number(profileData.pending_balance || 0),
                  unpickedBalance: Number(profileData.unpicked_balance || 0),
                  totalEarnings: Number(profileData.total_earnings || 0),
                  usdtAddress: custom.usdtAddress || '',
                  bankInfo: bankInfoObj,
                };
              });
            }
          })
          .subscribe();

        // Setup real-time listener for user data
        userChannel = supabase
          .channel(`public:users:${user.id}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'users', filter: `id=eq.${user.id}` }, (payload) => {
            const userData = payload.new as Record<string, unknown>;
            if (userData && mounted) {
              setReseller(prev => {
                if (!prev) return null;
                return {
                  ...prev,
                  firstName: userData.first_name || '',
                  lastName: userData.last_name || '',
                  email: userData.email || '',
                };
              });
            }
          })
          .subscribe();

        // Setup real-time listener for product selection
        selectionChannel = supabase
          .channel(`public:reseller_product_selection:${user.id}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'reseller_product_selection', filter: `reseller_id=eq.${user.id}` }, async () => {
             const { data: selectionData } = await supabase
               .from('reseller_product_selection')
               .select('product_id')
               .eq('reseller_id', user.id);
             
             if (selectionData && mounted) {
               const selectedProductIds = selectionData.map(d => d.product_id);
               setReseller(prev => {
                 if (!prev) return null;
                 return { ...prev, selectedProductIds };
               });
             }
          })
          .subscribe();

        // Setup real-time listener for retail_shops
        shopChannel = supabase
          .channel(`public:retail_shops:${user.id}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'retail_shops', filter: `id=eq.${user.id}` }, (payload) => {
            const shopData = payload.new as Record<string, unknown>;
            if (shopData && mounted) {
              setReseller(prev => {
                if (!prev) return null;
                return {
                  ...prev,
                  starRating: shopData.star_rating as number || 2.0,
                  creditScore: shopData.credit_score as number || 100,
                  isSuspended: shopData.is_suspended as boolean || false,
                  level: shopData.level as string || prev.level || "VIP-0",
                  productLimit: shopData.product_limit as number || 20,
                };
              });
            }
          })
          .subscribe();
      } else if (event === 'SIGNED_OUT') {
        console.log("[RESELLER] SIGNED_OUT event, setting reseller to null.");
        currentUserRef.current = null;
        if (mounted) {
          setReseller(null);
          setLoading(false);
        }
      }
    });

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
      subscription.unsubscribe();
      if (profileChannel) supabase.removeChannel(profileChannel);
      if (userChannel) supabase.removeChannel(userChannel);
      if (selectionChannel) supabase.removeChannel(selectionChannel);
      if (shopChannel) supabase.removeChannel(shopChannel);
    };
  }, []);

  const currentProfileFetch = useRef<{ uid: string, promise: Promise<void> } | null>(null);

  const fetchProfile = async (userId: string, email: string) => {
    if (currentProfileFetch.current?.uid === userId) {
      console.log(`[RESELLER_CONTEXT] Returning existing fetch promise for UID: ${userId}`);
      return currentProfileFetch.current.promise;
    }

    setLoading(true);

    const fetchPromise = (async () => {
      console.log(`[RESELLER_CONTEXT] Fetching profile for UID: ${userId}, Email: ${email}`);
      try {
        // 1. Fetch user role
        console.log(`[RESELLER_CONTEXT] Querying users table for UID: ${userId}...`);
        
        const timeoutPromise = new Promise<{data: null, error: { message: string, code?: string }}>((resolve) => {
          setTimeout(() => resolve({data: null, error: {message: "Supabase query timed out after 15s"}}), 15000);
        });

        const { data: userData, error: userError } = await Promise.race([
          supabase.from('users').select('*').eq('id', userId).single(),
          timeoutPromise
        ]) as { data: Record<string, unknown> | null, error: { message: string, code?: string } | null };
        
        console.log(`[RESELLER_CONTEXT] Query users table complete. Error: ${userError?.message || 'None'}`);
      
      if (userError || !userData) {
        console.warn(`[RESELLER_CONTEXT] 'users' document NOT FOUND for UID: ${userId}`);
        setReseller(null);
        setLoading(false);
        return;
      }
      
      console.log(`[RESELLER_CONTEXT] User data found. Role: ${userData.role}`);
      if (!['reseller', 'customer', 'owner', 'admin'].includes(userData.role)) {
        console.warn(`[RESELLER_CONTEXT] Unauthorized role: ${userData.role}`);
        setReseller(null);
        setLoading(false);
        return;
      }

      // 2. Fetch reseller profile
      console.log(`[RESELLER_CONTEXT] Querying reseller_profiles table...`);
      const { data: profileData, error: profileError } = await supabase
        .from('reseller_profiles')
        .select('*')
        .eq('id', userId)
        .single();
      
      console.log(`[RESELLER_CONTEXT] Query reseller_profiles complete. Error: ${profileError?.message || 'None'}`);
      
      if (profileError || !profileData) {
        console.warn(`[RESELLER_CONTEXT] 'reseller_profiles' document NOT FOUND for UID: ${userId}`);
        setReseller(null);
        setLoading(false);
        return;
      }

      // Auto-populate missing shop_slug
      let activeShopSlug = profileData.shop_slug || '';
      if (!activeShopSlug) {
        const baseName = profileData.shop_name || 'my-shop';
        activeShopSlug = baseName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        if (!activeShopSlug) activeShopSlug = 'my-shop';
        activeShopSlug = activeShopSlug + '-' + Math.random().toString(36).substring(2, 6);
        
        console.log(`[RESELLER_CONTEXT] Auto-generating missing shop_slug for reseller: ${activeShopSlug}`);
        
        // Save to DB in background
        supabase.from('reseller_profiles').update({ shop_slug: activeShopSlug }).eq('id', userId)
          .then(({ error }) => {
            if (error) console.error("Failed to auto-update reseller_profiles with shop_slug:", error);
          });
        supabase.from('retail_shops').upsert({ id: userId, shop_slug: activeShopSlug }, { onConflict: 'id' })
          .then(({ error }) => {
            if (error) console.error("Failed to auto-update retail_shops with shop_slug:", error);
          });
      }

      // 3. Fetch retail shop
      console.log(`[RESELLER_CONTEXT] Querying retail_shops table...`);
      const { data: retailShopData, error: shopError } = await supabase
        .from('retail_shops')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      console.log(`[RESELLER_CONTEXT] Query retail_shops complete.`);

      // Auto-create missing retail_shop if it doesn't exist
      let currentShopData = retailShopData;
      if (!retailShopData) {
        console.log(`[RESELLER_CONTEXT] Retail shop missing for ${userId}, auto-creating...`);
        const newShopData = {
          id: userId,
          reseller_id: profileData.reseller_id || 0,
          shop_name: profileData.shop_name || 'My Store',
          shop_slug: activeShopSlug,
          star_rating: 2.0,
          credit_score: 100,
          status: 'active',
          created_at: new Date().toISOString()
        };
        const { data: createdShop } = await supabase.from('retail_shops').insert(newShopData).select().maybeSingle();
        currentShopData = createdShop;
      } else if (!retailShopData.shop_slug) {
        // If shop exists but lacks shop_slug
        await supabase.from('retail_shops').update({ shop_slug: activeShopSlug }).eq('id', userId);
        if (currentShopData) {
          currentShopData.shop_slug = activeShopSlug;
        }
      }
      
      const totalDeposits = Number(profileData.total_deposits || 0);
      const totalWithdrawals = Number(profileData.total_withdrawals || 0);
      const netDeposits = totalDeposits - totalWithdrawals;
      const currentLevelLabel = (currentShopData?.level as string) || "VIP-0";
      const levelInfo = getLevelByDeposit(netDeposits, currentLevelLabel);

      // 4. Fetch selected products
      console.log(`[RESELLER_CONTEXT] Querying reseller_product_selection table...`);
      const { data: selectionData } = await supabase
        .from('reseller_product_selection')
        .select('product_id')
        .eq('reseller_id', userId);
      
      console.log(`[RESELLER_CONTEXT] Query selection complete.`);
      const selectedProductIds = selectionData ? selectionData.map((d: Record<string, unknown>) => String(d.product_id)) : [];

      let custom: CustomSettings = {};
      try {
        if (profileData.payment_method) {
          custom = typeof profileData.payment_method === 'string'
            ? JSON.parse(profileData.payment_method)
            : profileData.payment_method as unknown as CustomSettings;
        }
      } catch (e) {
        console.error("Error parsing custom payment_method inside fetchProfile:", e);
      }

      let bankInfoObj = { bankName: '', accountName: '', accountNumber: '' };
      const rawBankInfo = custom.bankInfo;
      if (rawBankInfo) {
        try {
          bankInfoObj = typeof rawBankInfo === 'string' ? JSON.parse(rawBankInfo) : rawBankInfo;
        } catch (e) {
          console.error("Error parsing bank_info:", e);
        }
      }

      console.log(`[RESELLER_CONTEXT] Setting reseller state...`);
      setReseller({
        ...DEFAULT_PROFILE_TEMPLATE,
        id: userId,
        resellerId: profileData.reseller_id || 0,
        firstName: userData.first_name || '',
        lastName: userData.last_name || '',
        email: email,
        phone: userData.phone || profileData.phone || '',
        profilePicture: profileData.profile_picture || custom.profilePicture || '',
        shopName: profileData.shop_name,
        shopSlug: activeShopSlug,
        shopLogo: profileData.shop_logo || custom.shopLogo || '',
        shopHeroBanner: profileData.shop_hero_banner || custom.shopHeroBanner || '',
        storeTheme: profileData.store_theme || (custom.storeTheme as StoreTheme) || 'minimal',
        verified: profileData.verified,
        balance: Number(profileData.balance || 0),
        pendingBalance: Number(profileData.pending_balance || 0),
        unpickedBalance: Number(profileData.unpicked_balance || 0),
        totalEarnings: Number(profileData.total_earnings || 0),
        totalDeposits: totalDeposits,
        referralCode: profileData.referral_code,
        referredByStaffId: profileData.referred_by_staff_id,
        memberOfAdminId: profileData.member_of_admin_id,
        level: levelInfo.level,
        productLimit: levelInfo.productLimit,
        isSuspended: currentShopData?.is_suspended || false,
        starRating: currentShopData?.star_rating || 2.0,
        creditScore: currentShopData?.credit_score || 100,
        selectedProductIds,
        usdtAddress: custom.usdtAddress || '',
        bankInfo: bankInfoObj,
      });
      console.log(`[RESELLER_CONTEXT] Fetch complete successfully.`);
      } catch (error: unknown) {
      console.error("[RESELLER_CONTEXT] Error fetching reseller profile:", error);
      if (error && typeof error === 'object' && 'message' in error) {
         const errObj = error as { message: string };
         if (errObj.message.includes('JWT') || errObj.message.includes('Auth')) {
            setReseller(null);
         }
      }
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

  const login = async (email: string, password: string): Promise<boolean> => {
    console.log(`[RESELLER_CONTEXT] Attempting login for: ${email}`);
    try {
      setLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      console.log(`[RESELLER_CONTEXT] Supabase Auth login successful for UID: ${data.user?.id}`);
      
      if (data.user) {
        currentUserRef.current = data.user.id;
        await fetchProfile(data.user.id, data.user.email || '');
      }
      return true;
    } catch (e: unknown) {
      console.warn("[RESELLER_CONTEXT] Login error details:", (e as Error).message);
      setLoading(false);
      return false;
    }
  };

  const register = async (data: { firstName: string; lastName: string; emailOrPhone: string; password: string; shopName?: string; referralCode?: string; isPhone?: boolean }): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch("/api/register-reseller", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: data.firstName,
          lastName: data.lastName,
          emailOrPhone: data.emailOrPhone,
          password: data.password,
          shopName: data.shopName,
          referralCode: data.referralCode,
          isPhone: data.isPhone || false,
        }),
      });

      if (!response.ok) {
        let errData;
        const text = await response.text();
        try {
          errData = JSON.parse(text);
        } catch (e) {
          console.error("Netlify returned non-JSON response:", text);
          throw new Error("Registration backend error: " + response.status + " " + text.substring(0, 100));
        }
        throw new Error(errData.error || "Registration backend error");
      }

      const textData = await response.text();
      let resData;
      try {
        resData = JSON.parse(textData);
      } catch (e) {
        throw new Error("Invalid valid JSON response from backend");
      }
      if (!resData.success) {
        throw new Error(resData.error || "Registration failed");
      }

      // Automatically sign them in on the client side after successful registration
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: data.isPhone ? undefined : data.emailOrPhone.toLowerCase().trim(),
        password: data.password,
      });

      if (signInError) {
        console.warn("Auto sign-in failed after registration:", signInError);
      }

      await fetchProfile(resData.userId, data.isPhone ? null : data.emailOrPhone.toLowerCase().trim());
      return { success: true };
    } catch (e: unknown) {
      console.warn("Registration error details:", e);
      return { success: false, error: (e as Error).message || "Registration failed" };
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setReseller(null);
  };

  const changePassword = async (currentPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { success: false, error: error.message };
    return { success: true };
  };

  const updateProfile = async (updates: Partial<ResellerProfile>) => {
    if (!reseller) return;
    
    try {
      const profileUpdates: Record<string, unknown> = {};
      const userUpdates: Record<string, unknown> = {};
      const shopUpdates: Record<string, unknown> = {};

      if (updates.firstName !== undefined) {
        userUpdates.first_name = updates.firstName;
        profileUpdates.first_name = updates.firstName;
      }
      if (updates.lastName !== undefined) {
        userUpdates.last_name = updates.lastName;
        profileUpdates.last_name = updates.lastName;
      }
      if (updates.email !== undefined) {
        userUpdates.email = updates.email;
        profileUpdates.email = updates.email;
      }

      let generatedSlug: string | undefined;
      if (updates.shopName !== undefined) {
        profileUpdates.shop_name = updates.shopName;
        shopUpdates.shop_name = updates.shopName;
        const slug = reseller.shopSlug || updates.shopName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + '-' + Math.random().toString(36).substring(2, 6);
        profileUpdates.shop_slug = slug;
        shopUpdates.shop_slug = slug;
        generatedSlug = slug;
      }

      // Query current custom field or build it from current state
      let custom: Record<string, unknown> = {};
      try {
        const { data: currentProfile } = await supabase
          .from('reseller_profiles')
          .select('payment_method')
          .eq('id', reseller.id)
          .single();
        if (currentProfile?.payment_method) {
          custom = typeof currentProfile.payment_method === 'string'
            ? JSON.parse(currentProfile.payment_method)
            : currentProfile.payment_method as unknown as Record<string, unknown>;
        }
      } catch (err) {
        console.warn("Could not query existing payment_method, fallback to reseller state:", err);
      }

      // Fallback/backfill from current state if key not populated
      if (custom.shopLogo === undefined && reseller.shopLogo !== undefined) custom.shopLogo = reseller.shopLogo;
      if (custom.shopHeroBanner === undefined && reseller.shopHeroBanner !== undefined) custom.shopHeroBanner = reseller.shopHeroBanner;
      if (custom.storeTheme === undefined && reseller.storeTheme !== undefined) custom.storeTheme = reseller.storeTheme;
      if (custom.profilePicture === undefined && reseller.profilePicture !== undefined) custom.profilePicture = reseller.profilePicture;
      if (custom.usdtAddress === undefined && reseller.usdtAddress !== undefined) custom.usdtAddress = reseller.usdtAddress;
      if (custom.bankInfo === undefined && reseller.bankInfo !== undefined) custom.bankInfo = reseller.bankInfo;
      if (custom.phone === undefined && reseller.phone !== undefined) custom.phone = reseller.phone;
      
      let customModified = false;
      if (updates.shopLogo !== undefined) { 
        custom.shopLogo = updates.shopLogo; 
        customModified = true; 
      }
      if (updates.shopHeroBanner !== undefined) { 
        custom.shopHeroBanner = updates.shopHeroBanner; 
        customModified = true; 
      }
      if (updates.storeTheme !== undefined) { 
        custom.storeTheme = updates.storeTheme; 
        customModified = true; 
      }
      if (updates.profilePicture !== undefined) { 
        custom.profilePicture = updates.profilePicture; 
        customModified = true; 
      }
      if (updates.usdtAddress !== undefined) { custom.usdtAddress = updates.usdtAddress; customModified = true; }
      if (updates.bankInfo !== undefined) { custom.bankInfo = updates.bankInfo; customModified = true; }
      if (updates.phone !== undefined) { custom.phone = updates.phone; customModified = true; }

      if (customModified) {
        profileUpdates.payment_method = JSON.stringify(custom);
      }

      // Synchronize updates including the generated shop slug into the component state
      const nextResellerState = { ...updates };
      if (generatedSlug) {
        nextResellerState.shopSlug = generatedSlug;
      }
      setReseller(prev => prev ? { ...prev, ...nextResellerState } : null);

      if (Object.keys(profileUpdates).length > 0) {
        // Try writing to the separate columns if the schema supports them, with fallback to payment_method only
        const fullProfileUpdates = { ...profileUpdates };
        if (updates.shopLogo !== undefined) (fullProfileUpdates as Record<string, unknown>).shop_logo = updates.shopLogo;
        if (updates.shopHeroBanner !== undefined) (fullProfileUpdates as Record<string, unknown>).shop_hero_banner = updates.shopHeroBanner;
        if (updates.storeTheme !== undefined) (fullProfileUpdates as Record<string, unknown>).store_theme = updates.storeTheme;
        if (updates.profilePicture !== undefined) (fullProfileUpdates as Record<string, unknown>).profile_picture = updates.profilePicture;

        try {
          const { error } = await supabase.from('reseller_profiles').update(fullProfileUpdates).eq('id', reseller.id);
          if (error) {
            console.warn("[RESELLER_CONTEXT] Profile direct column update failed (possibly columns don't exist), falling back to payment_method only:", error.message);
            const { error: fallbackError } = await supabase.from('reseller_profiles').update(profileUpdates).eq('id', reseller.id);
            if (fallbackError) { console.error("Error updating reseller_profiles (fallback):", fallbackError); throw fallbackError; }
          }
        } catch (err) {
          console.warn("[RESELLER_CONTEXT] Profile direct column update threw exception, falling back to payment_method only:", err);
          const { error: fallbackError } = await supabase.from('reseller_profiles').update(profileUpdates).eq('id', reseller.id);
          if (fallbackError) { throw fallbackError; }
        }
      }
      if (Object.keys(userUpdates).length > 0) {
        const { error } = await supabase.from('users').update(userUpdates).eq('id', reseller.id);
        if (error) { console.error("Error updating users:", error); throw error; }
      }
      if (Object.keys(shopUpdates).length > 0) {
        const fullShopUpdates = { ...shopUpdates };
        if (updates.shopLogo !== undefined) (fullShopUpdates as Record<string, unknown>).shop_logo = updates.shopLogo;
        if (updates.shopHeroBanner !== undefined) (fullShopUpdates as Record<string, unknown>).shop_hero_banner = updates.shopHeroBanner;
        if (updates.storeTheme !== undefined) (fullShopUpdates as Record<string, unknown>).store_theme = updates.storeTheme;

        try {
          const { error } = await supabase.from('retail_shops').upsert({ id: reseller.id, ...fullShopUpdates }, { onConflict: 'id' });
          if (error) {
            console.warn("[RESELLER_CONTEXT] Shop direct column upsert failed, falling back to basic shop updates:", error.message);
            const { error: fallbackError } = await supabase.from('retail_shops').upsert({ id: reseller.id, ...shopUpdates }, { onConflict: 'id' });
            if (fallbackError) { console.error("Error updating retail_shops (fallback):", fallbackError); throw fallbackError; }
          }
        } catch (err) {
          console.warn("[RESELLER_CONTEXT] Shop direct column upsert threw exception, falling back to basic shop updates:", err);
          const { error: fallbackError } = await supabase.from('retail_shops').upsert({ id: reseller.id, ...shopUpdates }, { onConflict: 'id' });
          if (fallbackError) { throw fallbackError; }
        }
      }

    } catch (e) {
      console.error("[RESELLER_CONTEXT] Error updating profile:", e);
      throw e;
    }
  };

  const toggleProduct = async (productId: string): Promise<{ success: boolean; errorType?: 'limit' | 'permission' | 'error' }> => {
    if (!reseller) return { success: false, errorType: 'error' };
    
    const ids = [...reseller.selectedProductIds];
    const idx = ids.indexOf(productId);
    
    try {
      if (idx >= 0) {
        ids.splice(idx, 1);
        await supabase.from('reseller_product_selection').delete().match({ reseller_id: reseller.id, product_id: productId });
      } else {
        if (reseller.productLimit && ids.length >= reseller.productLimit) return { success: false, errorType: 'limit' };
        ids.push(productId);
        await supabase.from('reseller_product_selection').insert({ reseller_id: reseller.id, product_id: productId });
      }
      
      setReseller({ ...reseller, selectedProductIds: ids });
      return { success: true };
    } catch (e) {
      console.error("[RESELLER_CONTEXT] Error toggling product:", e);
      return { success: false, errorType: 'error' };
    }
  };

  const getMyProducts = (): Product[] => {
    if (!reseller) return [];
    return products.filter(p => reseller.selectedProductIds.includes(p.id));
  };

  const getResellerBySlug = (slug: string): ResellerProfile | null => {
    if (reseller && (reseller.id === slug || reseller.shopSlug === slug)) return reseller;
    return null;
  };

  const fetchResellerBySlug = async (slug: string): Promise<ResellerProfile | null> => {
    if (reseller && (reseller.id === slug || reseller.shopSlug === slug)) return reseller;

    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);
      let query = supabase.from('reseller_profiles').select('*');
      
      if (isUuid) {
        query = query.or(`shop_slug.eq.${slug},id.eq.${slug}`);
      } else {
        query = query.eq('shop_slug', slug);
      }

      const { data: profileData, error } = await query.limit(1).maybeSingle();
      if (error) throw error;
      if (!profileData) return null;

      const { data: shopData } = await supabase
        .from('retail_shops')
        .select('*')
        .eq('id', profileData.id)
        .maybeSingle();

      return await fetchResellerById(profileData.id, { ...profileData, ...shopData });
    } catch (error) {
      console.error("Error fetching reseller by slug:", error);
      return null;
    }
  };

  const fetchResellerByName = async (name: string): Promise<ResellerProfile | null> => {
    const trimmedName = name.trim();
    if (!trimmedName) return null;

    try {
      const { data: profileData } = await supabase
        .from('reseller_profiles')
        .select('*')
        .or(`shop_name.ilike.%${trimmedName}%,shop_slug.ilike.%${trimmedName}%`)
        .limit(1)
        .maybeSingle();
      
      if (!profileData) return null;

      const { data: shopData } = await supabase
        .from('retail_shops')
        .select('*')
        .eq('id', profileData.id)
        .maybeSingle();

      return await fetchResellerById(profileData.id, { ...profileData, ...shopData });
    } catch (error) {
      console.error("Error fetching reseller by name:", error);
      return null;
    }
  };

  const fetchResellerById = async (userId: string, shopData: Record<string, unknown>): Promise<ResellerProfile | null> => {
    try {
      const { data: selectionData } = await supabase
        .from('reseller_product_selection')
        .select('product_id')
        .eq('reseller_id', userId);
      
      const selectedProductIds = selectionData ? selectionData.map(d => d.product_id) : [];

      let custom: CustomSettings = {};
      try {
        if (shopData.payment_method) {
          custom = typeof shopData.payment_method === 'string'
            ? JSON.parse(shopData.payment_method)
            : shopData.payment_method as unknown as CustomSettings;
        }
      } catch (e) {
        console.error("Error parsing custom settings inside fetchResellerById:", e);
      }

      let bankInfoObj = { bankName: '', accountName: '', accountNumber: '' };
      const rawBankInfo = custom.bankInfo;
      if (rawBankInfo) {
        try {
          bankInfoObj = typeof rawBankInfo === 'string' ? JSON.parse(rawBankInfo) : rawBankInfo;
        } catch (e) {
          console.error("Error parsing bank_info:", e);
        }
      }

      const totalDeposits = Number(shopData.total_deposits || 0);
      const totalWithdrawals = Number(shopData.total_withdrawals || 0);
      const netDeposits = totalDeposits - totalWithdrawals;
      const currentLevelLabel = (shopData?.level as string) || "VIP-0";
      const levelInfo = getLevelByDeposit(netDeposits, currentLevelLabel);

      return {
        ...DEFAULT_PROFILE_TEMPLATE,
        id: userId,
        resellerId: shopData.reseller_id || 0,
        firstName: shopData.first_name || '',
        lastName: shopData.last_name || '',
        email: shopData.email || '',
        phone: shopData.phone || '',
        shopName: shopData.shop_name || 'My Shop',
        shopSlug: shopData.shop_slug || userId,
        profilePicture: shopData.profile_picture || custom.profilePicture || '',
        shopLogo: shopData.shop_logo || custom.shopLogo || '',
        shopHeroBanner: shopData.shop_hero_banner || custom.shopHeroBanner || '',
        storeTheme: shopData.store_theme || (custom.storeTheme as StoreTheme) || 'minimal',
        isSuspended: shopData.is_suspended || false,
        starRating: shopData.star_rating || 2.0,
        creditScore: shopData.credit_score || 100,
        level: levelInfo.level || shopData.level || "VIP-0",
        productLimit: levelInfo.productLimit || shopData.product_limit || 20,
        selectedProductIds,
        verified: true,
        usdtAddress: custom.usdtAddress || '',
        bankInfo: bankInfoObj,
      } as ResellerProfile;
    } catch (error) {
      console.error("Error in fetchResellerById:", error);
      return null;
    }
  };

  const refreshProfile = async () => {
    if (reseller) {
      await fetchProfile(reseller.id, reseller.email);
    }
  };

  return (
    <ResellerContext.Provider value={{ reseller, loading, login, register, logout, updateProfile, changePassword, toggleProduct, getMyProducts, getResellerBySlug, fetchResellerBySlug, fetchResellerByName, refreshProfile }}>
      {children}
    </ResellerContext.Provider>
  );
}

