import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function main() {
  const { error } = await supabase.from('reseller_profiles').update({ phone: '123' }).eq('email', 'fake@example.com');
  console.log('Update Error:', error);
}
main();
