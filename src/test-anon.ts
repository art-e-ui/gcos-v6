import { createClient } from '@supabase/supabase-js';

// get actual from env
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await supabase.from('support_messages').select('*').limit(5);
  console.log('Result SELECT support_messages:', { data, error });
}
test();
