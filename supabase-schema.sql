-- Supabase Schema for Reseller Platform with Row Level Security (RLS) Policies

-- 0. CLEANUP (Careful! This deletes existing data)
DROP TABLE IF EXISTS public.order_items CASCADE;
DROP TABLE IF EXISTS public.orders CASCADE;
DROP TABLE IF EXISTS public.reseller_product_selection CASCADE;
DROP TABLE IF EXISTS public.reviews CASCADE;
DROP TABLE IF EXISTS public.products CASCADE;
DROP TABLE IF EXISTS public.reseller_chat_messages CASCADE;
DROP TABLE IF EXISTS public.reseller_chat_sessions CASCADE;
DROP TABLE IF EXISTS public.support_messages CASCADE;
DROP TABLE IF EXISTS public.support_sessions CASCADE;
DROP TABLE IF EXISTS public.reseller_notifications CASCADE;
DROP TABLE IF EXISTS public.broadcast_notifications CASCADE;
DROP TABLE IF EXISTS public.deposit_requests CASCADE;
DROP TABLE IF EXISTS public.withdrawal_requests CASCADE;
DROP TABLE IF EXISTS public.virtual_customer_profiles CASCADE;
DROP TABLE IF EXISTS public.system_settings CASCADE;
DROP TABLE IF EXISTS public.bank_info CASCADE;
DROP TABLE IF EXISTS public.retail_shops CASCADE;
DROP TABLE IF EXISTS public.admin_audit_logs CASCADE;
DROP TABLE IF EXISTS public.reseller_profiles CASCADE;
DROP TABLE IF EXISTS public.sla_staff CASCADE;
DROP TABLE IF EXISTS public.sla_admins CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. USERS & PROFILES
CREATE TABLE public.users (
  id uuid PRIMARY KEY, -- Matches auth.users id
  email text,
  role text DEFAULT 'reseller',
  first_name text,
  last_name text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.sla_admins (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  name text,
  email text UNIQUE,
  account_id text UNIQUE,
  phone text, -- Supported phone column
  status text DEFAULT 'Active',
  permissions text[], -- Supported permissions column
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.sla_staff (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  name text,
  email text UNIQUE,
  username text,
  referral_id text UNIQUE,
  created_by_admin_id uuid REFERENCES public.sla_admins(id),
  staff_id text, -- Supported staff_id column
  phone text, -- Supported phone column
  department text DEFAULT 'Unassigned', -- Supported department column
  status text DEFAULT 'Active', -- Supported status column
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.reseller_profiles (
  id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  email text,
  first_name text,
  last_name text,
  shop_name text,
  shop_slug text, -- Supported shop_slug column
  shop_logo text,
  shop_hero_banner text,
  store_theme text DEFAULT 'minimal',
  profile_picture text,
  usdt_address text,
  bank_info text,
  member_of_admin_id uuid REFERENCES public.sla_admins(id),
  referred_by_staff_id uuid REFERENCES public.sla_staff(id),
  referral_code text,
  referral_id text,
  verified boolean DEFAULT false,
  balance numeric DEFAULT 0.00,
  pending_balance numeric DEFAULT 0.00,
  unpicked_balance numeric DEFAULT 0.00,
  total_deposits numeric DEFAULT 0.00,
  total_withdrawals numeric DEFAULT 0.00,
  total_earnings numeric DEFAULT 0.00,
  total_orders integer DEFAULT 0,
  level text DEFAULT 'VIP-0',
  credit_score numeric DEFAULT 100,
  star_rating numeric DEFAULT 5.0,
  product_limit integer DEFAULT 20,
  payment_method text,
  usdc_address text,
  fcm_tokens text[],
  last_token_update timestamp with time zone,
  reseller_id integer, -- Supported reseller_id sequential column
  registration_date timestamp with time zone DEFAULT now(), -- Supported registration_date column
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.retail_shops (
  id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  reseller_id integer, -- Changed to integer to align with sequential reseller_id
  shop_name text,
  shop_slug text, -- Supported shop_slug column
  level text DEFAULT 'VIP-0', -- Supported level column
  product_limit integer DEFAULT 20, -- Supported product_limit column
  star_rating numeric DEFAULT 2.0, -- Supported star_rating column
  credit_score numeric DEFAULT 100, -- Supported credit_score column
  is_suspended boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.products (
  id text PRIMARY KEY,
  sku text,
  name text,
  price numeric,
  original_price numeric,
  image text,
  rating numeric,
  category text,
  badge text,
  description text,
  seller text,
  in_stock boolean DEFAULT true,
  stock integer DEFAULT 0,
  specifications jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.reviews (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  product_id text REFERENCES public.products(id) ON DELETE CASCADE,
  user_name text,
  rating integer,
  comment text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.reseller_product_selection (
  reseller_id uuid REFERENCES public.reseller_profiles(id) ON DELETE CASCADE,
  product_id text REFERENCES public.products(id) ON DELETE CASCADE,
  created_at timestamp with time zone DEFAULT now(),
  PRIMARY KEY (reseller_id, product_id)
);

-- 4. ORDERS & ITEMS
CREATE TABLE public.orders (
  id text PRIMARY KEY,
  orderId text,
  order_number text,
  user_id text,
  reseller_id uuid REFERENCES public.reseller_profiles(id),
  human_reseller_id text,
  reseller_name text,
  resellerName text,
  resellerNumericId integer,
  profile_name text,
  profileName text,
  customer_name text,
  customerName text,
  customer_email text,
  customer_phone text,
  shipping_address text,
  staff_username text,
  admin_username text,
  referral_id text,
  referred_by_staff_id text,
  member_of_admin_id text,
  total_amount numeric,
  total_cost numeric,
  service_cost numeric,
  profit numeric,
  profits numeric,
  subtotal numeric,
  tax numeric,
  shipping numeric,
  status text DEFAULT 'Pending',
  focused boolean DEFAULT false,
  items_count integer,
  products_count integer,
  order_items jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  completed_at timestamp with time zone,
  picked_up_at timestamp with time zone
);

CREATE TABLE public.order_items (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  order_id text REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id text REFERENCES public.products(id),
  name text,
  image text,
  cost numeric,
  price numeric,
  price_at_time numeric,
  qty integer,
  quantity integer,
  adjustedPrice numeric,
  created_at timestamp with time zone DEFAULT now()
);

-- 5. CHAT & SUPPORT
CREATE TABLE public.reseller_chat_sessions (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  reseller_id uuid REFERENCES public.reseller_profiles(id),
  customer_id text,
  customer_name text,
  reseller_name text,
  is_online boolean DEFAULT false,
  is_pinned boolean DEFAULT false,
  last_message_at timestamp with time zone DEFAULT now(),
  unread_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.reseller_chat_messages (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  session_id uuid REFERENCES public.reseller_chat_sessions(id) ON DELETE CASCADE,
  sender text,
  content text,
  image_url text,
  is_read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.support_sessions (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  reseller_id uuid REFERENCES public.reseller_profiles(id),
  customer_name text,
  is_online boolean DEFAULT false,
  unread_count integer DEFAULT 0,
  last_message_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.support_messages (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  session_id uuid REFERENCES public.support_sessions(id) ON DELETE CASCADE,
  sender text,
  content text,
  image_url text,
  is_read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

-- 6. NOTIFICATIONS
CREATE TABLE public.categories (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  name text,
  icon text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.reseller_notifications (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  reseller_id uuid REFERENCES public.reseller_profiles(id),
  title text,
  content text,
  type text,
  read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.broadcast_notifications (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  title text,
  label text,
  department text,
  message text,
  active boolean DEFAULT true,
  is_archived boolean DEFAULT false,
  broadcast_date timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now()
);

-- 7. TRANSACTIONS
CREATE TABLE public.deposit_requests (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  "resellerDocId" uuid REFERENCES public.reseller_profiles(id),
  amount numeric,
  status text DEFAULT 'pending',
  screenshot text,
  "createdAt" timestamp with time zone DEFAULT now()
);

CREATE TABLE public.withdrawal_requests (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  "resellerDocId" uuid REFERENCES public.reseller_profiles(id),
  amount numeric,
  status text DEFAULT 'pending',
  method text,
  account_info text,
  "createdAt" timestamp with time zone DEFAULT now()
);

-- 8. VIRTUAL PROFILES
CREATE TABLE public.virtual_customer_profiles (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  name text,
  email text,
  phone text,
  address text,
  created_at timestamp with time zone DEFAULT now()
);

-- 9. SYSTEM SETTINGS
CREATE TABLE public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id text,
  admin_email text,
  action text,
  target text,
  details jsonb,
  ip_address text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.system_settings (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  key text UNIQUE,
  value text,
  category text,
  label text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.seasonal_themes (
  id text PRIMARY KEY,
  slug text,
  is_active boolean DEFAULT false,
  decorations jsonb,
  created_at timestamp with time zone DEFAULT now()
);

-- Ensure Realtime is enabled for these tables
DO $$ 
DECLARE
  t text;
  tables text[] := ARRAY['reseller_profiles', 'retail_shops', 'users', 'reseller_chat_sessions', 'reseller_chat_messages', 'support_sessions', 'support_messages', 'orders', 'broadcast_notifications'];
BEGIN
  FOR t IN SELECT unnest(tables) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END
$$;


-- 10. ROW LEVEL SECURITY (RLS) POLICIES
-- Enable Row Level Security (RLS) for all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sla_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sla_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reseller_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retail_shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reseller_product_selection ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reseller_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reseller_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reseller_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.virtual_customer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasonal_themes ENABLE ROW LEVEL SECURITY;

-- Dynamic functions to determine administrative check without infinite recursion
CREATE OR REPLACE FUNCTION public.is_admin(user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = user_id AND u.role IN ('admin', 'owner')
  ) OR EXISTS (
    SELECT 1 FROM public.sla_admins s
    WHERE s.id = user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_staff(user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = user_id AND u.role = 'staff'
  ) OR EXISTS (
    SELECT 1 FROM public.sla_staff s
    WHERE s.id = user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_sla_user(user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN public.is_admin(user_id) OR public.is_staff(user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- public.users Policies
CREATE POLICY "Allow authenticated users to read profiles" ON public.users FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow individuals to insert their own profile" ON public.users FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Allow individuals to update their own profile" ON public.users FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Allow admins to manage users" ON public.users FOR ALL USING (public.is_admin(auth.uid()));

-- public.sla_admins Policies
CREATE POLICY "Allow authenticated users to view sla admins" ON public.sla_admins FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow admins to manage sla admins" ON public.sla_admins FOR ALL USING (public.is_admin(auth.uid()));

-- public.sla_staff Policies
CREATE POLICY "Allow authenticated users to view sla staff" ON public.sla_staff FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow admins to manage sla staff" ON public.sla_staff FOR ALL USING (public.is_admin(auth.uid()));

-- public.reseller_profiles Policies
CREATE POLICY "Allow users to read reseller profile" ON public.reseller_profiles FOR SELECT USING (true);
CREATE POLICY "Allow users to insert own reseller profile" ON public.reseller_profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Allow users to update own reseller profile" ON public.reseller_profiles FOR UPDATE USING (auth.uid() = id OR public.is_sla_user(auth.uid()));
CREATE POLICY "Allow admins to manage all reseller profiles" ON public.reseller_profiles FOR ALL USING (public.is_admin(auth.uid()));

-- public.retail_shops Policies
CREATE POLICY "Allow public/authenticated read retail shops" ON public.retail_shops FOR SELECT USING (true);
CREATE POLICY "Allow individuals to insert their own retail shop" ON public.retail_shops FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Allow individuals to update their retail shop" ON public.retail_shops FOR UPDATE USING (auth.uid() = id OR public.is_sla_user(auth.uid()));
CREATE POLICY "Allow admins/staff to manage retail shops" ON public.retail_shops FOR ALL USING (public.is_sla_user(auth.uid()));

-- public.products Policies
CREATE POLICY "Allow public read products" ON public.products FOR SELECT USING (true);
CREATE POLICY "Allow admins/staff to manage products" ON public.products FOR ALL USING (public.is_sla_user(auth.uid()));

-- public.reviews Policies
CREATE POLICY "Allow public read reviews" ON public.reviews FOR SELECT USING (true);
CREATE POLICY "Allow authenticated users to create reviews" ON public.reviews FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Allow admins/staff to delete reviews" ON public.reviews FOR ALL USING (public.is_sla_user(auth.uid()));

-- public.reseller_product_selection Policies
CREATE POLICY "Allow public read product selections" ON public.reseller_product_selection FOR SELECT USING (true);
CREATE POLICY "Allow resellers to view and modify their selections" ON public.reseller_product_selection FOR ALL USING (reseller_id = auth.uid() OR public.is_sla_user(auth.uid()));

-- public.orders Policies
CREATE POLICY "Allow users to view their own orders" ON public.orders FOR SELECT USING (reseller_id = auth.uid() OR public.is_sla_user(auth.uid()));
CREATE POLICY "Allow users to update/insert their own orders" ON public.orders FOR ALL USING (reseller_id = auth.uid() OR public.is_sla_user(auth.uid()));

-- public.order_items Policies
CREATE POLICY "Allow users to view order items" ON public.order_items FOR SELECT USING (EXISTS (
  SELECT 1 FROM public.orders o WHERE o.id = order_id AND (o.reseller_id = auth.uid() OR public.is_sla_user(auth.uid()))
));
CREATE POLICY "Allow users to insert order items" ON public.order_items FOR INSERT WITH CHECK (EXISTS (
  SELECT 1 FROM public.orders o WHERE o.id = order_id AND (o.reseller_id = auth.uid() OR public.is_sla_user(auth.uid()))
));

-- Chat and Support Policies
CREATE POLICY "Chat sessions access" ON public.reseller_chat_sessions FOR ALL USING (reseller_id = auth.uid() OR public.is_sla_user(auth.uid()));
CREATE POLICY "Chat messages access" ON public.reseller_chat_messages FOR ALL USING (EXISTS (
  SELECT 1 FROM public.reseller_chat_sessions s WHERE s.id = session_id AND (s.reseller_id = auth.uid() OR public.is_sla_user(auth.uid()))
));
CREATE POLICY "Support sessions access" ON public.support_sessions FOR ALL USING (reseller_id = auth.uid() OR public.is_sla_user(auth.uid()));
CREATE POLICY "Support messages access" ON public.support_messages FOR ALL USING (EXISTS (
  SELECT 1 FROM public.support_sessions s WHERE s.id = session_id AND (s.reseller_id = auth.uid() OR public.is_sla_user(auth.uid()))
));

-- Notifications
CREATE POLICY "Reseller notifications" ON public.reseller_notifications FOR ALL USING (reseller_id = auth.uid() OR public.is_sla_user(auth.uid()));
CREATE POLICY "Broadcast notifications read" ON public.broadcast_notifications FOR SELECT USING (true);
CREATE POLICY "Broadcast notifications admin" ON public.broadcast_notifications FOR ALL USING (public.is_sla_user(auth.uid()));

-- Deposit / Withdrawal
CREATE POLICY "Deposit requests access" ON public.deposit_requests FOR ALL USING ("resellerDocId" = auth.uid() OR public.is_sla_user(auth.uid()));
CREATE POLICY "Withdrawal requests access" ON public.withdrawal_requests FOR ALL USING ("resellerDocId" = auth.uid() OR public.is_sla_user(auth.uid()));

-- Virtual Customer / System Settings / Seasonal Themes
CREATE POLICY "Admin audit logs read" ON public.admin_audit_logs FOR SELECT USING (public.is_sla_user(auth.uid()));
CREATE POLICY "Admin audit logs insert" ON public.admin_audit_logs FOR INSERT WITH CHECK (public.is_sla_user(auth.uid()));
CREATE POLICY "Virtual customer read" ON public.virtual_customer_profiles FOR SELECT USING (true);
CREATE POLICY "Virtual customer modify" ON public.virtual_customer_profiles FOR ALL USING (public.is_sla_user(auth.uid()));
CREATE POLICY "System settings read" ON public.system_settings FOR SELECT USING (true);
CREATE POLICY "System settings write" ON public.system_settings FOR ALL USING (public.is_admin(auth.uid()));
CREATE POLICY "Seasonal themes read" ON public.seasonal_themes FOR SELECT USING (true);
CREATE POLICY "Seasonal themes write" ON public.seasonal_themes FOR ALL USING (public.is_admin(auth.uid()));

-- 11. STORAGE BUCKET POLICIES (Note: requires Supabase superuser for bucket creation, but included for reference)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('uploads', 'uploads', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public Access" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'uploads');

CREATE POLICY "Allow Auth Uploads" 
ON storage.objects FOR INSERT 
TO authenticated 
WITH CHECK (bucket_id = 'uploads');
