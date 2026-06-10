import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { useUnifiedResellers } from "@/lib/unified-hooks";
import { useAdminAccess } from "@/hooks/use-admin-access";

export function AdminGlobalNotifications() {
  const resellers = useUnifiedResellers();
  const { canSeeAll, hasAccessToReseller } = useAdminAccess();

  const stateRef = useRef({ resellers, canSeeAll, hasAccessToReseller });
  useEffect(() => {
    stateRef.current = { resellers, canSeeAll, hasAccessToReseller };
  }, [resellers, canSeeAll, hasAccessToReseller]);

  useEffect(() => {
    const startListener = (
      tableName: string,
      title: string,
      messageCallback: (data: Record<string, unknown>) => string,
      filterConditions: { field: string, value: unknown }[] = [],
      shouldNotify?: (data: Record<string, unknown>) => boolean | Promise<boolean>
    ) => {
      const channelName = `global_notifs_${tableName}_${Math.random().toString(36).substring(2,9)}`;
      const channel = supabase
        .channel(channelName)
        .on('postgres_changes', { 
          event: 'INSERT', 
          schema: 'public', 
          table: tableName 
        }, (payload) => {
          const handlePayload = async () => {
            const data = payload.new as Record<string, unknown>;
            
            let match = true;
            for (const cond of filterConditions) {
              if (data[cond.field] !== cond.value) {
                match = false;
                break;
              }
            }

            if (match && shouldNotify) {
              const allowed = await shouldNotify(data);
              if (!allowed) match = false;
            }

            if (match) {
              const body = messageCallback(data);
              toast(title, {
                description: body,
                duration: 300000,
                action: {
                  label: "Dismiss",
                  onClick: () => {}
                }
              });

              playNotificationSound();
              if (document.hidden) startTabFlash(title);
            }
          };

          handlePayload().catch(console.error);
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    };

    const checkResellerAccess = (resellerId: string | null | undefined) => {
      const { resellers: list, canSeeAll: seeAll, hasAccessToReseller: hasAccess } = stateRef.current;
      if (seeAll) return true;
      if (!resellerId) return false;
      const reseller = list.find(r => r.id === resellerId);
      if (!reseller) return false;
      return hasAccess({
        referredBy: reseller.referredBy,
        memberOfAdminId: reseller.memberOfAdminId
      });
    };

    const formatChatNotification = (data: Record<string, string | null>, prefix: string) => {
      let content = data.content || data.message || '';
      
      if (content.includes('[IMG_ATTACH:')) {
        content = content.replace(/\s*\[IMG_ATTACH:[^\]]+\]\s*/g, ' ').trim();
        if (!content) return `${prefix}: [Image attachment]`;
        return `${prefix}: ${content} [Image attachment]`;
      }
      if (content.includes('[PRODUCT_ATTACH:')) {
        content = content.replace(/\s*\[PRODUCT_ATTACH:[^\]]+\]\s*/g, ' ').trim();
        if (!content) return `${prefix}: [Product attachment]`;
        return `${prefix}: ${content} [Product attachment]`;
      }
      
      return `${prefix}: ${content}`;
    };

    // 1. Reseller Chat Messages
    const unsubResellerMsgs = startListener(
      "reseller_chat_messages",
      "New Message (Reseller 2 Admin)",
      (data) => formatChatNotification(data, data.sender === "reseller" ? "Reseller" : "System"),
      [{ field: "sender", value: "reseller" }],
      async (data) => {
        if (!data.session_id) return false;
        try {
          const { data: sessionData } = await supabase
            .from('reseller_chat_sessions')
            .select('reseller_id')
            .eq('id', data.session_id)
            .single();
          if (sessionData && sessionData.reseller_id) {
            return checkResellerAccess(sessionData.reseller_id);
          }
        } catch (e) {
          console.error("Error checking session access:", e);
        }
        return false;
      }
    );

    // 2. Virtual Customer Chat Messages
    const unsubVirtualMsgs = startListener(
      "reseller_chat_messages", // Both use the same table now in Supabase refactor
      "New Message (Virtual Chat)",
      (data) => formatChatNotification(data, "Reseller"),
      [{ field: "sender", value: "reseller" }],
      async (data) => {
        if (!data.session_id) return false;
        try {
          const { data: sessionData } = await supabase
            .from('reseller_chat_sessions')
            .select('reseller_id')
            .eq('id', data.session_id)
            .single();
          if (sessionData && sessionData.reseller_id) {
            return checkResellerAccess(sessionData.reseller_id);
          }
        } catch (e) {
          console.error("Error checking session access:", e);
        }
        return false;
      }
    );

    // 3. Deposit Requests
    const unsubDeposits = startListener(
      "deposit_requests",
      "New Deposit Request",
      (data) => `Reseller ${data.reseller_name || "Unknown"} requested a deposit of $${data.amount}`,
      [],
      (data) => checkResellerAccess(data.resellerDocId as string)
    );

    // 4. Withdrawal Requests
    const unsubWithdrawals = startListener(
      "withdrawal_requests",
      "New Withdrawal Request",
      (data) => `Reseller ${data.reseller_name || "Unknown"} requested a withdrawal of $${data.amount}`,
      [],
      (data) => checkResellerAccess(data.resellerDocId as string)
    );

    // 5. New Reseller Registration
    const unsubResellers = startListener(
      "reseller_profiles",
      "New Reseller Registered",
      (data) => `Shop: ${data.shop_name || "Unknown"} (ID: ${data.reseller_id})`,
      [],
      (data) => {
        const { canSeeAll: seeAll, hasAccessToReseller: hasAccess } = stateRef.current;
        if (seeAll) return true;
        return hasAccess({
          referredBy: data.referred_by_staff_id as string,
          memberOfAdminId: data.member_of_admin_id as string
        });
      }
    );

    // 6. New Orders
    const unsubOrders = startListener(
      "orders",
      "New Order Received",
      (data) => `Reseller ID: ${data.reseller_id || "Unknown"} placed an order for $${data.total_amount || 0}`,
      [],
      (data) => checkResellerAccess(data.reseller_id as string)
    );

    return () => {
      unsubResellerMsgs();
      unsubVirtualMsgs();
      unsubDeposits();
      unsubWithdrawals();
      unsubResellers();
      unsubOrders();
    };
  }, []);

  return null;
}


function playNotificationSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof window.AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880; // slightly higher pitch A5
    osc.type = "sine";
    gain.gain.setValueAtTime(0.1, ctx.currentTime); // Lower volume to not be too intrusive
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  } catch (err) {
    console.error("Audio playback failed", err);
  }
}

let flashInterval: ReturnType<typeof setInterval> | null = null;
function startTabFlash(title: string) {
  if (flashInterval) return;
  const original = document.title;
  let on = false;
  flashInterval = setInterval(() => {
    document.title = on ? `🔔 ${title}` : original;
    on = !on;
  }, 1000);
  const stopFlash = () => {
    if (flashInterval) { clearInterval(flashInterval); flashInterval = null; }
    document.title = original;
    window.removeEventListener("focus", stopFlash);
  };
  window.addEventListener("focus", stopFlash);
}
