import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function useAchCustomers() {
  return useQuery({
    queryKey: ["ach_customers"],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from("ach_customers").select("*");
        if (error) throw error;
        return data || [];
      } catch (error) {
        console.error("Error fetching ACH customers from Supabase:", error);
        return [];
      }
    },
    staleTime: 30 * 60 * 1000,
  });
}

export function useAchFinancials() {
  return useQuery({
    queryKey: ["ach_financials"],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from("ach_financials").select("*");
        if (error) throw error;
        return data || [];
      } catch (error) {
        console.error("Error fetching ACH financials from Supabase:", error);
        return [];
      }
    },
    staleTime: 30 * 60 * 1000,
  });
}
