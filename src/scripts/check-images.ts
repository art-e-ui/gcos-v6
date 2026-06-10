import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function main() {
  const { data, error } = await supabase.from('products').select('image').limit(5);
  console.log('Error:', error);
  console.log('Images:', data);
  
  const { data: order_items, error: error2 } = await supabase.from('order_items').select('image').limit(5);
  console.log('Order Images:', order_items);
}
main();
