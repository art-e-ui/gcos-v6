import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export function useFcmToken() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const requestPermission = async () => {
      // FCM disabled during migration to Supabase
      console.log('[FCM] Push notifications are currently disabled during migration to Supabase.');
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        requestPermission();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return token;
}
