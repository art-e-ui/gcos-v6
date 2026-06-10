import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { playNotificationSound, startTabFlash } from './use-notifications';

export interface CustomerChatMessage {
  id: string;
  session_id: string;
  sender: 'customer' | 'reseller';
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface ChatSession {
  id: string;
  reseller_id: string;
  customer_id: string;
  customer_name: string;
  last_message_at: string;
  created_at: string;
}

export async function getOrCreateResellerChatSession(
  customerId: string, 
  customerName: string, 
  resellerId: string
): Promise<string> {
  try {
    const { data: existing, error: queryError } = await supabase
      .from('reseller_chat_sessions')
      .select('id')
      .eq('reseller_id', resellerId)
      .eq('customer_id', customerId)
      .maybeSingle();
    
    if (queryError) {
      console.warn("[CHAT] Session fetch warning:", queryError);
    }
    
    if (existing) {
      return existing.id;
    }
    
    const { data, error } = await supabase.from('reseller_chat_sessions').insert({
      reseller_id: resellerId,
      customer_id: customerId,
      customer_name: customerName,
      last_message_at: new Date().toISOString(),
      created_at: new Date().toISOString()
    }).select().single();
    
    if (error) throw error;
    return data.id;
  } catch (error) {
    console.error("Error in getOrCreateResellerChatSession:", error);
    throw error;
  }
}

export function useResellerChat(sessionId: string | null) {
  const [messages, setMessages] = useState<CustomerChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }

    setLoading(true);

    const channel = supabase
      .channel(`reseller_chat_messages:${sessionId}`)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'reseller_chat_messages',
        filter: `session_id=eq.${sessionId}` 
      }, () => {
        fetchMessages();
      })
      .subscribe();

    const fetchMessages = async () => {
      const { data, error } = await supabase
        .from('reseller_chat_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (!error && data) {
        const mapped = data.map((m: { id: string; session_id: string; sender: 'customer' | 'reseller'; is_read: boolean; created_at: string; content?: string | null; message?: string | null }) => ({
          ...m,
          message: m.content || m.message || ""
        }));
        const sorted = mapped.reverse();
        setMessages(prev => {
          const prevIds = new Set(prev.map(m => m.id));
          const newResellerMsgs = sorted.filter(m => !prevIds.has(m.id) && m.sender === 'reseller');
          if (newResellerMsgs.length > 0) {
            playNotificationSound();
            if (document.hidden) startTabFlash();
          }
          return sorted;
        });
        setLoading(false);
      }
    };

    fetchMessages();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId]);

  const sendMessage = async (message: string, sender: 'customer' | 'reseller' = 'customer') => {
    if (!sessionId || !message.trim()) return;

    try {
      await supabase.from('reseller_chat_messages').insert({
        session_id: sessionId,
        sender,
        content: message.trim(),
        is_read: false,
        created_at: new Date().toISOString()
      });

      await supabase.from('reseller_chat_sessions').update({
        last_message_at: new Date().toISOString()
      }).eq('id', sessionId);
    } catch (error) {
      console.error("Error sending message:", error);
      throw error;
    }
  };

  return { messages, loading, sendMessage };
}
