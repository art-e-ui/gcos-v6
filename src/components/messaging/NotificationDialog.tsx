import { useState, useEffect } from 'react';
import { X, Bell } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { markAsRead, type SystemNotification } from '@/hooks/use-notifications';
import { useReseller } from '@/lib/reseller-context-hooks';
import { detectPortal } from '@/lib/subdomain';

export default function NotificationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { reseller } = useReseller();
  const queryClient = useQueryClient();
  const portal = detectPortal();
  const isResellerPortal = portal === 'reseller';

  const { data: notifications = [], refetch } = useQuery({
    queryKey: ['broadcast_notifications_all', reseller?.id, isResellerPortal],
    queryFn: async () => {
      const { data: broadcastData, error: bError } = await supabase
        .from('broadcast_notifications')
        .select('*')
        .eq('is_archived', false)
        .order('broadcast_date', { ascending: false });
        
      const broadcastNotifs = (broadcastData || []).map(item => ({
        id: item.id,
        title: item.label || item.title,
        message: item.message,
        department: item.department,
        timestamp: item.broadcast_date,
        read: false,
        type: 'broadcast'
      }));

      let resellerNotifs: Record<string, unknown>[] = [];
      if (reseller?.id && isResellerPortal) {
        const { data: rData } = await supabase
          .from('reseller_notifications')
          .select('*')
          .eq('reseller_id', reseller.id)
          .order('created_at', { ascending: false });
          
        const genericTitle = reseller ? `System Alert for ${reseller.shopName || reseller.firstName} (GRS-${reseller.resellerId || "000"})` : "System Alert";
        resellerNotifs = (rData || []).map(item => ({
          id: item.id,
          title: item.title || genericTitle,
          message: item.message || item.content,
          department: "Admin",
          timestamp: item.created_at,
          read: item.read || false,
          type: item.type || 'alert'
        }));
      }

      // Combine and sort by timestamp descending
      const allNotifs = [...broadcastNotifs, ...resellerNotifs];
      allNotifs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      
      return allNotifs;
    },
    refetchInterval: 2 * 60 * 1000, 
  });

  const markResellerNotifsRead = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        await supabase.from('reseller_notifications').update({ read: true }).eq('id', id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['broadcast_notifications_all'] });
      queryClient.invalidateQueries({ queryKey: ['broadcast_notifications_unread'] });
    }
  });

  const [selectedNotif, setSelectedNotif] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (open && notifications.length > 0) {
      const broadcastIds = notifications.filter(n => n.type === 'broadcast').map(n => n.id);
      if (broadcastIds.length > 0) {
        markAsRead(broadcastIds);
      }

      const unreadResellerIds = notifications.filter(n => n.type !== 'broadcast' && !n.read).map(n => n.id);
      if (unreadResellerIds.length > 0) {
        markResellerNotifsRead.mutate(unreadResellerIds);
      }
      
      refetch();
    }
    if (!open) setSelectedNotif(null);
  }, [open, notifications, refetch, markResellerNotifsRead]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end sm:justify-center items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full h-[85vh] sm:h-auto sm:max-h-[80vh] max-w-md bg-background rounded-t-2xl sm:rounded-2xl border border-border shadow-xl flex flex-col animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            <h2 className="font-bold text-base text-foreground">
              {selectedNotif ? "View Notification" : "Notifications"}
            </h2>
          </div>
          <button onClick={selectedNotif ? () => setSelectedNotif(null) : onClose} className="p-1 rounded-full hover:bg-accent transition-colors">
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {selectedNotif ? (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-foreground">{selectedNotif.title}</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{selectedNotif.message}</p>
              <div className="pt-3 border-t border-border space-y-1">
                <p className="text-xs text-muted-foreground">
                  Released by: <span className="font-medium text-foreground">{selectedNotif.department}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {selectedNotif.department.toLowerCase()}@globalcart-onlineshop.com
                </p>
                <p className="text-[10px] text-muted-foreground/60 mt-2">
                  {new Date(selectedNotif.timestamp).toLocaleString()}
                </p>
              </div>
            </div>
          ) : notifications.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <Bell className="h-10 w-10 mx-auto mb-3 opacity-30" />
              No notifications yet
            </div>
          ) : (
            notifications.map((n: Record<string, unknown>) => (
              <button
                key={n.id}
                onClick={() => setSelectedNotif(n)}
                className="w-full text-left rounded-xl bg-muted/50 p-3 space-y-1 hover:bg-accent/50 transition-colors"
              >
                <p className="font-semibold text-sm text-foreground">{n.title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{n.message}</p>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-primary font-medium">{n.department}</span>
                  <span className="text-[10px] text-muted-foreground/60">{new Date(n.timestamp).toLocaleDateString()}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
