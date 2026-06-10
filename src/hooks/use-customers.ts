import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  totalOrders: number;
  totalSpent: number;
  lastOrder: string;
  status: "Active" | "Inactive" | "Blocked";
  referralId?: string;
  referredBy?: string;
  memberOfAdminId?: string;
}

export function useCustomers() {
  return useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("users")
          .select("*")
          .eq("role", "customer");
        
        if (error) throw error;

        return (data || []).map(user => ({
          id: user.id,
          name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unknown User',
          email: user.email || '',
          phone: "N/A",
          totalOrders: 0,
          totalSpent: 0,
          lastOrder: user.created_at || '',
          status: "Active",
          referralId: user.referral_code || "",
          referredBy: user.referred_by || "",
          memberOfAdminId: user.member_of_admin_id || "",
        })) as Customer[];
      } catch (error) {
        console.error("Error fetching customers from Supabase:", error);
        return [];
      }
    },
    staleTime: 5000, 
  });
}
