import { supabase } from './src/lib/supabase.ts';

async function test() {
  const { data, error } = await supabase.from('retail_shops').select('*').limit(1);
  if (data && data.length > 0) {
    console.log(Object.keys(data[0]));
  }
}
test();
