-- Remove the foreign key constraint on user_id
ALTER TABLE public.telegram_sessions 
DROP CONSTRAINT IF EXISTS telegram_sessions_user_id_fkey;

-- Disable RLS since we don't have authentication
ALTER TABLE public.telegram_sessions DISABLE ROW LEVEL SECURITY;

-- Drop all existing policies
DROP POLICY IF EXISTS "Users can create their own sessions" ON public.telegram_sessions;
DROP POLICY IF EXISTS "Users can delete their own sessions" ON public.telegram_sessions;
DROP POLICY IF EXISTS "Users can update their own sessions" ON public.telegram_sessions;
DROP POLICY IF EXISTS "Users can view their own sessions" ON public.telegram_sessions;