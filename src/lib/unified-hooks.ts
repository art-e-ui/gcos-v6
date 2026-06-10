import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Reseller } from "@/lib/types";
import { supabase } from "@/lib/supabase";

export function useUnifiedResellers() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Setup real-time listener for profiles and retail_shops
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    
    const profilesChannel = supabase
      .channel(`public:reseller_profiles_${randomSuffix}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reseller_profiles' }, () => {
        queryClient.invalidateQueries({ queryKey: ["resellers"] });
      })
      .subscribe();

    const retailShopsChannel = supabase
      .channel(`public:retail_shops_${randomSuffix}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'retail_shops' }, () => {
        queryClient.invalidateQueries({ queryKey: ["resellers"] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(profilesChannel);
      supabase.removeChannel(retailShopsChannel);
    };
  }, [queryClient]);

  const { data = [] } = useQuery({
    queryKey: ["resellers"],
    queryFn: async () => {
      try {
        console.log("[UNIFIED_HOOKS] Fetching unified resellers...");
        
        const [
          usersRes,
          profilesRes,
          adminsRes,
          staffRes,
          retailShopsRes
        ] = await Promise.all([
          supabase.from('users').select('*').eq('role', 'reseller').limit(500),
          supabase.from('reseller_profiles').select('*').limit(500),
          supabase.from('sla_admins').select('*').limit(100),
          supabase.from('sla_staff').select('*').limit(100),
          supabase.from('retail_shops').select('*').limit(500)
        ]);

        const users = usersRes.data || [];
        const profiles = profilesRes.data || [];
        const admins = adminsRes.data || [];
        const staff = staffRes.data || [];
        const retailShops = retailShopsRes.data || [];

        console.log(`[UNIFIED_HOOKS] Fetched: ${users.length} users, ${profiles.length} profiles, ${retailShops.length} shops`);

        const usersMap = new Map();
        users.forEach(u => usersMap.set(u.id, u));

        const retailShopsMap = new Map();
        retailShops.forEach(s => retailShopsMap.set(s.id, s));
        
        const adminsNameMap = new Map<string, string>();
        const adminsIdToAccountIdMap = new Map<string, string>();
        
        admins.forEach(a => {
          adminsNameMap.set(a.id, a.name || a.username || a.account_id || a.id);
          if (a.account_id) {
            adminsNameMap.set(a.account_id, a.name || a.username || a.account_id);
            adminsIdToAccountIdMap.set(a.id, a.account_id);
          }
        });

        const staffMap = new Map<string, Record<string, unknown>>();
        staff.forEach(s => {
          if (s.referral_id) {
            staffMap.set(s.referral_id, s);
          }
          staffMap.set(s.id, s);
        });

        const resellers: Reseller[] = (profiles || []).map(profileData => {
          const userData = (usersMap.get(profileData.id) || {}) as Record<string, unknown>;
          const retailShopData = (retailShopsMap.get(profileData.id) || {}) as Record<string, unknown>;
          
          let adminName = '';
          let staffName = '';
          
          const memberOfAdminIdRaw = profileData.member_of_admin_id as string || '';
          let inferredAdminId = memberOfAdminIdRaw ? (adminsIdToAccountIdMap.get(memberOfAdminIdRaw) || memberOfAdminIdRaw) : '';
          
          if (memberOfAdminIdRaw && adminsNameMap.has(memberOfAdminIdRaw)) {
            adminName = adminsNameMap.get(memberOfAdminIdRaw)!;
          } 
          
          if (profileData.referred_by_staff_id && staffMap.has(profileData.referred_by_staff_id)) {
            const staffData = staffMap.get(profileData.referred_by_staff_id)!;
            staffName = (staffData.username as string) || (staffData.name as string) || (profileData.referred_by_staff_id as string);
            
            const staffAdminIdRaw = staffData.created_by_admin_id as string || '';
            const staffAdminAccountId = staffAdminIdRaw ? (adminsIdToAccountIdMap.get(staffAdminIdRaw) || staffAdminIdRaw) : '';
            
            if (!inferredAdminId) {
              inferredAdminId = staffAdminAccountId;
            }

            if (!adminName && staffAdminIdRaw && adminsNameMap.has(staffAdminIdRaw)) {
              adminName = adminsNameMap.get(staffAdminIdRaw)!;
            }
          }

          const firstNameRaw = (userData.first_name as string) || (profileData.first_name as string) || (retailShopData.first_name as string) || '';
          const lastNameRaw = (userData.last_name as string) || (profileData.last_name as string) || (retailShopData.last_name as string) || '';
          const shopName = (profileData.shop_name as string) || (retailShopData.shop_name as string) || (userData.shop_name as string) || '';

          const firstName = firstNameRaw || (shopName ? shopName.split(' ')[0] : 'Unknown');
          const lastName = lastNameRaw || (shopName ? shopName.split(' ')[1] || '' : 'Reseller');

          const referralId = (profileData.referral_code as string) || (profileData.referral_id as string) || '';

          let customSettings: Record<string, unknown> = {};
          try {
            if (profileData.payment_method) {
              customSettings = typeof profileData.payment_method === 'string'
                ? JSON.parse(profileData.payment_method)
                : (profileData.payment_method as unknown as Record<string, unknown>) || {};
            }
          } catch(e) { /* ignore parse error */ }
          
          let bankInfoVal: Record<string, unknown> | undefined;
          const rawBankInfo = customSettings.bankInfo;
          if (rawBankInfo) {
             try {
                bankInfoVal = typeof rawBankInfo === 'string' ? JSON.parse(rawBankInfo) : rawBankInfo;
             } catch(e) { /* ignore parse error */ }
          }
          
          const usdtAddressVal = (customSettings.usdtAddress as string) || '';

          return {
            id: profileData.id,
            firstName,
            lastName,
            name: firstNameRaw || lastNameRaw ? `${firstNameRaw} ${lastNameRaw}`.trim() : (shopName || 'Unknown Reseller'),
            shopName,
            shopSlug: (retailShopData.shop_slug as string) || '',
            email: (userData.email as string) || (profileData.email as string) || '',
            registrationDate: (profileData.registration_date as string) || (userData.created_at as string) || '',
            referredBy: (profileData.referred_by_staff_id as string) || '',
            staffName,
            adminMember: adminName,
            memberOfAdminId: inferredAdminId,
            hasRequestedPasswordReset: profileData.password_reset_requested === true,
            referralId,
            level: `VIP-${String((profileData.level as string) || (retailShopData.level as string) || 'VIP-0').match(/\d+/)?.[0] || '0'}`,
            productLimit: (retailShopData.product_limit as number) || 20,
            isSuspended: (retailShopData.is_suspended as boolean) || false,
            starRating: (retailShopData.star_rating as number) || 2.0,
            creditScore: (retailShopData.credit_score as number) || 100,
            selectedProductIds: [],
            resellerId: profileData.reseller_id as number,
            // Financial fields
            balance: Number(profileData.balance || 0),
            pendingBalance: Number(profileData.pending_balance || 0),
            unpickedBalance: Number(profileData.unpicked_balance || 0),
            totalDeposits: Number(profileData.total_deposits || 0),
            totalWithdrawals: Number(profileData.total_withdrawals || 0),
            totalEarnings: Number(profileData.total_earnings || 0),
            totalOrders: Number(profileData.total_orders || 0),
            bankInfo: bankInfoVal as { bankName: string; accountName: string; accountNumber: string } | undefined,
            usdtAddress: usdtAddressVal
          };
        });

        return resellers;
      } catch (error) {
        console.error("Error in useUnifiedResellers queryFn:", error);
        return [];
      }
    },
    staleTime: 5000, 
    refetchOnWindowFocus: true,
    placeholderData: (previousData: Reseller[] | undefined) => previousData,
  });

  return data;
}
