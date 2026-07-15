
-- Add systeme notification type
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'systeme';

-- Alert settings (singleton row)
CREATE TABLE IF NOT EXISTS public.gateway_alert_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  offline_threshold_minutes int NOT NULL DEFAULT 5,
  notify_frequency_minutes int NOT NULL DEFAULT 30,
  email_enabled boolean NOT NULL DEFAULT false,
  email_recipients text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.gateway_alert_settings TO authenticated;
GRANT ALL ON public.gateway_alert_settings TO service_role;
ALTER TABLE public.gateway_alert_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage gateway_alert_settings" ON public.gateway_alert_settings
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

-- Per-gateway alert state
CREATE TABLE IF NOT EXISTS public.gateway_alert_state (
  connector_id text PRIMARY KEY,
  is_offline boolean NOT NULL DEFAULT false,
  last_notified_at timestamptz,
  last_checked_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.gateway_alert_state TO authenticated;
GRANT ALL ON public.gateway_alert_state TO service_role;
ALTER TABLE public.gateway_alert_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read gateway_alert_state" ON public.gateway_alert_state
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'));
