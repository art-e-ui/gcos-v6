import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
  console.log('--- ALL USERS ---');
  const { data: users, error: usersError } = await supabase.from('users').select('*');
  if (usersError) {
    console.error(usersError);
  } else {
    console.log(JSON.stringify(users, null, 2));
  }

  console.log('--- ALL SYSTEM SETTINGS ---');
  const { data: settings, error: settingsError } = await supabase.from('system_settings').select('*');
  if (settingsError) {
    console.error(settingsError);
  } else {
    console.log(JSON.stringify(settings, null, 2));
  }
}

main().catch(console.error);
