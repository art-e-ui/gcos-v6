import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

export { playNotificationSound, startTabFlash } from './use-notifications';
import { playNotificationSound, startTabFlash } from './use-notifications';

export const SESSION_KEY = 'support_session_id';

export interface ChatMessage {
  id: string;
  session_id: string;
  sender: string;
  message: string;
  attachment_product_id: string | null;
  is_read: boolean;
  created_at: string;
}

export function useUnreadSupport() {
  const [count, setCount] = useState(0);
  const prevCount = useRef(0);
  const isInitialRender = useRef(true);
  
  const [sessionId, setSessionId] = useState<string | null>(localStorage.getItem(SESSION_KEY));
  
  useEffect(() => {
    const checkSession = () => {
      const current = localStorage.getItem(SESSION_KEY);
      if (current !== sessionId) setSessionId(current);
    };
    const interval = setInterval(checkSession, 2000);
    return () => clearInterval(interval);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    const channel = supabase
      .channel(`support_messages:${sessionId}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'support_messages',
        filter: `session_id=eq.${sessionId}` 
      }, (payload) => {
        const newMessage = payload.new as ChatMessage;
        if (newMessage.sender === 'support' && !newMessage.is_read) {
          setCount(prev => prev + 1);
          playNotificationSound();
          if (document.hidden) startTabFlash();
        }
      })
      .subscribe();

    // Initial count fetch
    const fetchCount = async () => {
      const { count: unreadCount, error } = await supabase
        .from('support_messages')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', sessionId)
        .eq('sender', 'support')
        .eq('is_read', false);
      
      if (!error && unreadCount !== null) {
        setCount(unreadCount);
      }
    };
    fetchCount();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId]);
  
  return count;
}

export async function getOrCreateSession(userName?: string, resellerId?: string): Promise<string> {
  const existing = localStorage.getItem(SESSION_KEY);
  if (existing) {
    try {
      const { data: sessionDoc, error } = await supabase
        .from('support_sessions')
        .select('*')
        .eq('id', existing)
        .single();
      
      if (sessionDoc && !error) {
        const updates: Record<string, unknown> = { is_online: true };
        if (userName && sessionDoc.customer_name !== userName) {
          updates.customer_name = userName;
        }
        if (resellerId && sessionDoc.reseller_id !== resellerId) {
          updates.reseller_id = resellerId;
        }
        await supabase.from('support_sessions').update(updates).eq('id', existing);
        return existing;
      }
    } catch (e) {
      console.error("Error verifying existing session", e);
    }
  }
  
  const name = userName || ('Customer ' + Math.floor(Math.random() * 9000 + 1000));
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const sessionData = { 
      customer_name: name, 
      is_online: true,
      last_message_at: new Date().toISOString(),
      user_id: user?.id ?? null,
      reseller_id: resellerId || null
    };
    
    // Use API endpoint to bypass RLS for unauthenticated customers
    const res = await fetch('/api/create-support-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionData)
    });
    
    if (!res.ok) {
      throw new Error(`Failed to create session: ${res.statusText}`);
    }
    
    const { session } = await res.json();
    const id = session.id;
    localStorage.setItem(SESSION_KEY, id);
    return id;
  } catch (err) {
    console.error("Exception creating support session", err);
    return '';
  }
}
