
INSERT INTO public.gateway_alert_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.check_gateway_offline_alerts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s record;
  hb record;
  admin_user record;
  is_stale boolean;
  st record;
  should_notify boolean;
BEGIN
  SELECT * INTO s FROM public.gateway_alert_settings WHERE id = true;
  IF NOT FOUND THEN RETURN; END IF;

  FOR hb IN SELECT * FROM public.gateway_heartbeats LOOP
    is_stale := hb.updated_at < now() - make_interval(mins => s.offline_threshold_minutes);

    INSERT INTO public.gateway_alert_state (connector_id, is_offline, last_checked_at)
    VALUES (hb.connector_id, is_stale, now())
    ON CONFLICT (connector_id) DO UPDATE
      SET last_checked_at = now();

    SELECT * INTO st FROM public.gateway_alert_state WHERE connector_id = hb.connector_id;

    IF is_stale THEN
      should_notify := st.last_notified_at IS NULL
        OR st.last_notified_at < now() - make_interval(mins => s.notify_frequency_minutes);

      IF should_notify THEN
        FOR admin_user IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
          INSERT INTO public.notifications(user_id, type, title, message, link)
          VALUES (
            admin_user.user_id,
            'systeme'::notification_type,
            'Gateway hors ligne',
            'Le Gateway ' || hb.connector_id || ' n''a pas envoyé de heartbeat depuis plus de '
              || s.offline_threshold_minutes || ' min. Dernière erreur: '
              || COALESCE(hb.last_error, 'aucune'),
            '/gateways'
          );
        END LOOP;
        UPDATE public.gateway_alert_state
          SET last_notified_at = now(), is_offline = true
          WHERE connector_id = hb.connector_id;
      ELSE
        UPDATE public.gateway_alert_state
          SET is_offline = true
          WHERE connector_id = hb.connector_id;
      END IF;
    ELSE
      UPDATE public.gateway_alert_state
        SET is_offline = false
        WHERE connector_id = hb.connector_id;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.check_gateway_offline_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_gateway_offline_alerts() TO service_role;

-- Schedule job (unschedule first if it exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('check-gateway-offline')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-gateway-offline');
    PERFORM cron.schedule(
      'check-gateway-offline',
      '* * * * *',
      $c$SELECT public.check_gateway_offline_alerts();$c$
    );
  END IF;
END $$;
