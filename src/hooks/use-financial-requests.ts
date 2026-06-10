import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

export interface DepositRequest {
  id: string;
  resellerId: string;
  resellerDocId: string;
  resellerName: string;
  amount: number;
  status: "Pending" | "Approved" | "Rejected";
  method: "Bank Transfer" | "USDT (TRC20)";
  bankInfo?: {
    bankName: string;
    accountName: string;
    accountNumber: string;
  };
  usdtAddress?: string;
  proofImage: string;
  remark?: string;
  createdAt: string;
  memberOfAdminId?: string;
  referralId?: string;
  staffId?: string;
  adminId?: string;
}

export interface WithdrawalRequest {
  id: string;
  resellerId: string;
  resellerDocId: string;
  resellerName: string;
  amount: number;
  status: "Pending" | "Approved" | "Rejected";
  method: "Bank Transfer" | "USDT (TRC20)";
  bankInfo?: {
    bankName: string;
    accountName: string;
    accountNumber: string;
  };
  usdtAddress?: string;
  remark?: string;
  createdAt: string;
  memberOfAdminId?: string;
  referralId?: string;
  staffId?: string;
  adminId?: string;
}

export function useDepositRequests() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const channel = supabase
      .channel(`public:deposit_requests_${randomSuffix}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deposit_requests' }, () => {
        queryClient.invalidateQueries({ queryKey: ["deposit-requests"] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return useQuery({
    queryKey: ["deposit-requests"],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("deposit_requests")
          .select("*")
          .order("createdAt", { ascending: false });
        
        if (error) throw error;
        
        return (data || []).map(item => ({
          ...item,
          proofImage: item.screenshot || item.proofImage || "",
          createdAt: item.createdAt || item.created_at
        })) as DepositRequest[];
      } catch (error) {
        console.error("Error fetching deposit requests:", error);
        return [];
      }
    },
    staleTime: 30000,
  });
}

export function useWithdrawalRequests() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const channel = supabase
      .channel(`public:withdrawal_requests_${randomSuffix}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'withdrawal_requests' }, () => {
        queryClient.invalidateQueries({ queryKey: ["withdrawal-requests"] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return useQuery({
    queryKey: ["withdrawal-requests"],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from("withdrawal_requests")
          .select("*")
          .order("createdAt", { ascending: false });
        
        if (error) throw error;
        
        return (data || []).map(item => ({
          ...item,
          bankInfo: item.account_info ? JSON.parse(item.account_info) : undefined,
          createdAt: item.createdAt || item.created_at
        })) as WithdrawalRequest[];
      } catch (error) {
        console.error("Error fetching withdrawal requests:", error);
        return [];
      }
    },
    staleTime: 30000,
  });
}

export function useFinancialMutations() {
  const queryClient = useQueryClient();

  const updateDepositStatus = useMutation({
    mutationFn: async ({ id, status, remark }: { id: string; status: string; remark?: string }) => {
      const { error } = await supabase
        .from("deposit_requests")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deposit-requests"] });
      toast.success("Deposit status updated");
    }
  });

  const updateWithdrawalStatus = useMutation({
    mutationFn: async ({ id, status, remark }: { id: string; status: string; remark?: string }) => {
      const { error } = await supabase
        .from("withdrawal_requests")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["withdrawal-requests"] });
      toast.success("Withdrawal status updated");
    }
  });

  return { updateDepositStatus, updateWithdrawalStatus };
}
