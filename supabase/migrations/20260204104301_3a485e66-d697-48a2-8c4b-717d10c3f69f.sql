-- Create telegram_sessions table for persistent session storage
CREATE TABLE public.telegram_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  api_id INTEGER NOT NULL,
  api_hash TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  phone_code_hash TEXT,
  step TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT now() + interval '10 minutes'
);

-- Create index for faster expiry lookups
CREATE INDEX idx_telegram_sessions_expires ON public.telegram_sessions(expires_at);
CREATE INDEX idx_telegram_sessions_user ON public.telegram_sessions(user_id);

-- Enable Row Level Security
ALTER TABLE public.telegram_sessions ENABLE ROW LEVEL SECURITY;

-- Users can only access their own sessions
CREATE POLICY "Users can view their own sessions"
  ON public.telegram_sessions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own sessions"
  ON public.telegram_sessions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sessions"
  ON public.telegram_sessions
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own sessions"
  ON public.telegram_sessions
  FOR DELETE
  USING (auth.uid() = user_id);

-- Create function to clean up expired sessions
CREATE OR REPLACE FUNCTION public.cleanup_expired_telegram_sessions()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.telegram_sessions WHERE expires_at < now();
$$;