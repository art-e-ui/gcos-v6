const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function main() {
  const { data, error } = await supabase.from('reseller_profiles').select('*').limit(1);
  console.log('Error:', error);
  console.log('Columns:', data && data[0] ? Object.keys(data[0]) : 'None');
}
main();
