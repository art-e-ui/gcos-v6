import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

interface Message {
  id: string;
  session_id: string;
  sender: string;
  message: string;
  created_at: string;
  [key: string]: unknown;
}

export function usePaginatedMessages(collectionName: string, sessionId: string | null, pageSize: number = 5) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }

    setLoading(true);

    const channel = supabase
      .channel(`paginated_messages:${sessionId}`)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: collectionName,
        filter: `session_id=eq.${sessionId}` 
      }, () => {
        fetchMessages();
      })
      .subscribe();

    const fetchMessages = async () => {
      const { data, error } = await supabase
        .from(collectionName)
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(pageSize); // Enforcing the limit here
      
      if (!error && data) {
        const mapped = data.map((m: { id: string; session_id: string; sender: string; created_at: string; content?: string | null; message?: string | null }) => ({
          ...m,
          message: m.content || m.message || ""
        }));
        setMessages(mapped.reverse());
        setLoading(false);
      }
    };

    fetchMessages();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, collectionName, pageSize]);

  // Load more is disabled per user request to limit to only last 5 messages
  const loadMore = useCallback(async () => {
    // No-op per user requirement
  }, []);

  return { messages: messages || [], loadMore, hasMore: false, loadingMore: loading };
}
