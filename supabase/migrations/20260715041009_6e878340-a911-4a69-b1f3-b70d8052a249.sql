CREATE TABLE IF NOT EXISTS public.gateway_request_nonces (
  nonce TEXT PRIMARY KEY,
  gateway_id TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.gateway_request_nonces TO service_role;

ALTER TABLE public.gateway_request_nonces ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_gateway_request_nonces_received_at
  ON public.gateway_request_nonces(received_at);