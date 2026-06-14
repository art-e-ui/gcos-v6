# Guide: Reseller Profits Card & VIP Level Fixes

This guide documents the changes made to fix:
1. The reseller portal dashboard profit card (calculating actual net profits from completed orders in real-time).
2. Reseller VIP level resets (preventing downgrades of existing manual/promoted reseller levels while ensuring new signups start at VIP-0 and qualify for VIP-1 only after depositing $1,000+).

Use this guide as a reference for any AI agent (e.g. in Google AI Studio) to replicate or extend these changes.

---

## 1. Reseller Dashboard Net Profit Calculation
**File**: `src/pages/reseller/ResellerDashboard.tsx`

### Goal:
Instead of showing the static `totalEarnings` field from `reseller_profiles` (which frequently gets out of sync), query the `orders` table directly for the sum of profit of all orders with a status of `Completed`, and update this value in real-time using a Supabase Postgres changes subscription.

### Modifications:
1. **Imports**:
   Add `import { supabase } from "@/lib/supabase";` if not already imported.

2. **State & Fetch Logic**:
   Inside `ResellerDashboard`, declare state for `totalNetProfit`:
   ```typescript
   const [totalNetProfit, setTotalNetProfit] = useState<number | null>(null);
   ```

   Implement a `useEffect` targeting `reseller?.id` to fetch the sum of profits and listen for realtime updates:
   ```typescript
   useEffect(() => {
     if (!reseller?.id) return;

     const fetchNetProfit = async () => {
       try {
         const { data, error } = await supabase
           .from("orders")
           .select("profit, profits")
           .eq("reseller_id", reseller.id)
           .eq("status", "Completed");

         if (error) throw error;

         const sum = (data || []).reduce((acc, o) => acc + Number(o.profit || o.profits || 0), 0);
         setTotalNetProfit(sum);
       } catch (err) {
         console.error("Error fetching net profit:", err);
       }
     };

     fetchNetProfit();

     // Listen to any order insertions/updates/deletions for this reseller in real-time
     const channel = supabase
       .channel(`reseller_dashboard_profit_${reseller.id}`)
       .on('postgres_changes', { 
         event: '*', 
         schema: 'public', 
         table: 'orders',
         filter: `reseller_id=eq.${reseller.id}`
       }, () => {
         fetchNetProfit();
       })
       .subscribe();

     return () => {
       supabase.removeChannel(channel);
     };
   }, [reseller?.id]);
   ```

3. **UI Rendering**:
   Locate the "Total Profit" card markup. Replace the paragraph displaying the static balance with:
   ```tsx
   <p className="text-xl font-bold text-foreground">
     ${(totalNetProfit ?? reseller.totalEarnings).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
   </p>
   ```

---

## 2. Reseller VIP Level Syncing & Priority
**File**: `src/lib/reseller-context.tsx`

### Goal:
Resolve VIP levels using the profile's main database level first (configured by admins) to prevent VIP downgrades, auto-provision missing shop records with the profile's level, and update the context state reactively when profile data changes in real-time.

### Modifications:
1. **Real-time Listener Update**:
   In `fetchProfile`'s database listener channel callback, calculate net deposits (`deposits - withdrawals`) and compute the qualified VIP level. Update the local context state with these values:
   ```typescript
   const totalDeps = Number(profileData.total_deposits || 0);
   const totalWids = Number(profileData.total_withdrawals || 0);
   const netDeps = totalDeps - totalWids;
   const dbLevel = (profileData.level as string) || prev.level || "VIP-0";
   const lvlInfo = getLevelByDeposit(netDeps, dbLevel);

   return {
     ...prev,
     // ...other fields...
     totalDeposits: totalDeps,
     level: lvlInfo.level,
     productLimit: lvlInfo.productLimit,
   };
   ```

2. **Auto-provisioning missing Shops**:
   When inserting a missing entry in `retail_shops`, carry over the profile's level:
   ```typescript
   await supabase.from('retail_shops').upsert({
     id: profileData.id,
     reseller_id: profileData.reseller_id || 0,
     shop_name: profileData.shop_name || 'My Store',
     shop_slug: activeShopSlug,
     level: profileData.level || 'VIP-0', // Carry over profile level
     star_rating: 2.0,
     credit_score: 100,
     status: 'active',
     product_limit: 20
   }, { onConflict: 'id' });
   ```

3. **Current Level Priority**:
   When resolving the current level label during the initial profile fetch, prioritize `profileData.level`:
   ```typescript
   const currentLevelLabel = profileData.level || (currentShopData?.level as string) || "VIP-0";
   const levelInfo = getLevelByDeposit(netDeposits, currentLevelLabel);
   ```

---

## 3. Reseller Registration & Manual Creation Default Level
**File**: `netlify/functions/api.ts`

### Goal:
Prevent new reseller profiles from inheriting any database-wide level default configuration (e.g. `'VIP 1'` or `'VIP-1'`). Explicitly insert new reseller profiles with `'VIP-0'`.

### Modifications:
1. **Manual/Admin Reseller Creation (`POST /api/admin/create-reseller`)**:
   Add `level: 'VIP-0'` to the insert payload for `reseller_profiles`:
   ```typescript
   await supabase.from('reseller_profiles').insert({
     id: userId,
     shop_name: shopName,
     shop_slug: shopSlug + '-' + Math.random().toString(36).substring(2, 6),
     referral_id: referralId,
     balance: 0,
     total_earnings: 0,
     verified: true,
     level: 'VIP-0', // Explicit default
     reseller_id: newResellerId,
     referred_by_staff_id: referredByStaffId,
     member_of_admin_id: memberOfAdminId,
     registration_date: new Date().toISOString(),
   });
   ```

2. **Self Reseller Registration (`POST /api/register-reseller`)**:
   Add `level: 'VIP-0'` to the insert payload for `reseller_profiles`:
   ```typescript
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
     level: 'VIP-0', // Explicit default
     reseller_id: newResellerId,
     referred_by_staff_id: referredByStaffId,
     member_of_admin_id: memberOfAdminId,
     registration_date: new Date().toISOString(),
   });
   ```
