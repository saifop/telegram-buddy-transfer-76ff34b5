
-- Monitoring sessions table
CREATE TABLE public.monitoring_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'stopped')),
  groups JSONB NOT NULL DEFAULT '[]'::jsonb,
  accounts JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMP WITH TIME ZONE,
  stopped_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  total_members_found INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.monitoring_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to monitoring_sessions"
ON public.monitoring_sessions FOR ALL
USING (true)
WITH CHECK (true);

-- Monitored members table (deduplicated)
CREATE TABLE public.monitored_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.monitoring_sessions(id) ON DELETE CASCADE,
  telegram_user_id TEXT NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  access_hash TEXT,
  source_group TEXT,
  message_text TEXT,
  discovered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(session_id, telegram_user_id)
);

ALTER TABLE public.monitored_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to monitored_members"
ON public.monitored_members FOR ALL
USING (true)
WITH CHECK (true);

-- Index for fast lookups
CREATE INDEX idx_monitored_members_session ON public.monitored_members(session_id);
CREATE INDEX idx_monitored_members_dedup ON public.monitored_members(session_id, telegram_user_id);
