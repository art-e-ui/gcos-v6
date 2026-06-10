import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function main() {
  const { data, error } = await supabase.from('order_items').select('*').limit(1);
  console.log('Error:', error);
  console.log('Columns:', data && data[0] ? Object.keys(data[0]) : 'None');
  console.log('Data:', data && data[0]);
}
main();
