import { useState, useEffect } from "react";
import { ArrowDownToLine, Clock, CheckCircle2, XCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/lib/supabase";
import { useReseller } from "@/lib/reseller-context-hooks";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface ResellerWithdrawalSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface WithdrawalRecord {
  id: string;
  amount: number;
  status: "pending" | "approved" | "rejected";
  date: string;
}

export default function ResellerWithdrawalSheet({ open, onOpenChange }: ResellerWithdrawalSheetProps) {
  const { reseller } = useReseller();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [amount, setAmount] = useState("");
  const [history, setHistory] = useState<WithdrawalRecord[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const statusConfig = {
    pending: { icon: Clock, label: t("reseller.pending"), className: "text-yellow-500 bg-yellow-500/10" },
    approved: { icon: CheckCircle2, label: t("reseller.approved"), className: "text-emerald-500 bg-emerald-500/10" },
    rejected: { icon: XCircle, label: t("reseller.rejected"), className: "text-destructive bg-destructive/10" },
  };

  useEffect(() => {
    if (!reseller || !open) return;

    const fetchHistory = async () => {
      const { data, error } = await supabase
        .from("withdrawal_requests")
        .select("*")
        .eq("resellerDocId", reseller.id)
        .order("createdAt", { ascending: false });

      if (error) {
        console.error("Error fetching withdrawal history:", error);
        return;
      }

      const records = (data || []).map(row => ({
        id: row.id,
        amount: Number(row.amount),
        status: row.status.toLowerCase() as "pending" | "approved" | "rejected" | "completed" | "failed",
        date: row.createdAt ? row.createdAt.split('T')[0] : "-",
        createdAt: row.createdAt
      }));
      
      setHistory(records);
    };

    fetchHistory();

    const channel = supabase
      .channel('withdrawals_realtime')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'withdrawal_requests',
        filter: `reseller_doc_id=eq.${reseller.id}`
      }, () => {
        fetchHistory();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [reseller, open]);

  const handleSubmit = async () => {
    if (!reseller) return;
    const num = parseFloat(amount);
    if (!num || num <= 0) {
      toast({ title: t("common.invalidAmount"), description: t("common.enterValidAmount"), variant: "destructive" });
      return;
    }
    
    // Refresh reseller data to get latest balance
    const { data: profile, error: profileError } = await supabase
      .from('reseller_profiles')
      .select('balance')
      .eq('id', reseller.id)
      .single();

    if (profileError || !profile) {
      toast({ title: t("common.error"), description: "Could not fetch reseller profile.", variant: "destructive" });
      return;
    }

    if (num > (profile.balance || 0)) {
      toast({ title: t("common.insufficientBalance"), description: t("common.withdrawalExceedsBalance"), variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      // 1. Deduct balance
      const { error: updateError } = await supabase
        .from('reseller_profiles')
        .update({
          balance: (profile.balance || 0) - num,
          updated_at: new Date().toISOString()
        })
        .eq('id', reseller.id);

      if (updateError) throw updateError;

      // 2. Create withdrawal request
      const { error: insertError } = await supabase
        .from("withdrawal_requests")
        .insert({
          resellerDocId: reseller.id,
          amount: num,
          status: "Pending",
          method: reseller.usdtAddress ? "USDT (TRC20)" : "Bank Transfer",
          account_info: JSON.stringify({
            usdtAddress: reseller.usdtAddress,
            bankInfo: reseller.bankInfo
          })
        });

      if (insertError) throw insertError;

      toast({ title: t("reseller.withdrawalRequested"), description: `${t("reseller.withdrawalOf")} $${num.toFixed(2)} ${t("reseller.withdrawalSubmitted")}` });
      setAmount("");
      onOpenChange(false);
    } catch (error) {
      console.error("Error submitting withdrawal:", error);
      toast({ title: t("common.error"), description: t("reseller.failedToSubmitWithdrawal"), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto px-4 pb-8">
        <SheetHeader className="pb-3">
          <SheetTitle className="text-base font-bold text-foreground flex items-center gap-2">
            <ArrowDownToLine className="h-5 w-5 text-primary" />
            {t("reseller.withdrawFunds")}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4">
          {/* Balance display */}
          <div className="rounded-xl border border-border bg-card p-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">{t("reseller.availableBalance")}</p>
            <p className="text-2xl font-bold text-foreground">${reseller?.balance?.toFixed(2) || "0.00"}</p>
          </div>

          {/* Amount input */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <Label htmlFor="withdraw-amount" className="text-xs font-medium text-muted-foreground">
              {t("reseller.withdrawalAmount")}
            </Label>
            <Input
              id="withdraw-amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t("reseller.enterAmount")}
              className="rounded-xl text-lg font-semibold h-12"
              min={0}
              max={reseller?.balance || 0}
            />
            <p className="text-[11px] text-muted-foreground">
              {t("reseller.fundsWillBeSentToSavedMethod")}
            </p>
          </div>

          {/* Submit button */}
          <Button
            onClick={handleSubmit}
            disabled={!amount || parseFloat(amount) <= 0 || submitting || parseFloat(amount) > (reseller?.balance || 0)}
            className="w-full rounded-xl gap-2 h-12 text-sm font-semibold"
          >
            <Send className="h-4 w-4" />
            {submitting ? t("common.submitting") : t("reseller.requestWithdrawal")}
          </Button>

          <Separator />

          {/* Withdrawal status / history */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">{t("reseller.withdrawalStatus")}</h3>
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">{t("reseller.noWithdrawalRequestsYet")}</p>
            ) : (
              <div className="space-y-2">
                {history.map((record) => {
                  const config = statusConfig[record.status];
                  const StatusIcon = config.icon;
                  return (
                    <div
                      key={record.id}
                      className="flex items-center justify-between rounded-xl border border-border bg-card p-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${config.className}`}>
                          <StatusIcon className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">${record.amount.toFixed(2)}</p>
                          <p className="text-[11px] text-muted-foreground">{record.date}</p>
                        </div>
                      </div>
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${config.className}`}>
                        {config.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
