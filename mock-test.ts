import { supabase } from './src/lib/supabase';

async function test() {
  const { data, error } = await supabase.from('reseller_profiles').select('id').limit(1);
  if (error) { console.error("Select error:", error); return; }
  
  if (data && data.length > 0) {
    const { error: updErr } = await supabase.from('reseller_profiles').update({ shop_logo: 'test' }).eq('id', data[0].id);
    if (updErr) {
      console.error("Update error:", updErr);
    } else {
      console.log("Update success!");
    }
  } else {
    console.log("No users found");
  }
}
test();
