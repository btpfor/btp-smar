import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CircleCheck, CircleX, Info, Loader2, RefreshCw, Save, Wifi } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  getSynologyConfig,
  saveSynologyConfig,
} from "@/lib/synology.functions";
import { getGatewayStatus } from "@/lib/gateway.functions";

export const Route = createFileRoute("/_authenticated/synology-config")({
  head: () => ({ meta: [{ title: "Configuration Synology — GECO" }] }),
  component: SynologyConfigPage,
});

function SynologyConfigPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [host, setHost] = useState("192.168.1.21");
  const [port, setPort] = useState<number>(5000);

  const projects = useQuery({
    queryKey: ["projects", "mini"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, project_number")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const getFn = useServerFn(getSynologyConfig);
  const cfg = useQuery({
    queryKey: ["synology-config", projectId],
    queryFn: async () => {
      const r = await getFn({ data: { projectId } });
      setHost(r.host);
      setPort(r.port);
      return r;
    },
  });

  const saveFn = useServerFn(saveSynologyConfig);
  const save = useMutation({
    mutationFn: () => saveFn({ data: { projectId, host, port } }),
    onSuccess: () => {
      toast.success("Configuration enregistrée");
      qc.invalidateQueries({ queryKey: ["synology-config"] });
      qc.invalidateQueries({ queryKey: ["synology-health"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Le contrôle de santé s'appuie sur le heartbeat réel du GECO Synology
  // Gateway installé sur le LAN — le serveur cloud ne peut pas atteindre
  // directement une IP privée type 192.168.x.x.
  const gwFn = useServerFn(getGatewayStatus);
  const health = useQuery({
    queryKey: ["gateway-status"],
    queryFn: () => gwFn(),
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  const projectOptions = useMemo(
    () => [
      { id: "__global__", label: "Configuration globale (tous projets)" },
      ...(projects.data ?? []).map((p) => ({
        id: p.id,
        label: `${p.project_number ?? ""} · ${p.name}`.trim(),
      })),
    ],
    [projects.data],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configuration Synology</h1>
        <p className="text-sm text-muted-foreground">
          Définissez l'hôte du NAS Synology (DSM) par défaut ou par projet.
        </p>
      </div>

      <Card className="p-6 space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Portée</Label>
            <Select
              value={projectId ?? "__global__"}
              onValueChange={(v) => setProjectId(v === "__global__" ? null : v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {projectOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="host">Hôte Synology (SYNOLOGY_HOST)</Label>
            <Input
              id="host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="192.168.1.21"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="port">Port DSM</Label>
            <Input
              id="port"
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value) || 5000)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending || cfg.isLoading}>
            {save.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Enregistrer
          </Button>
          <Button
            variant="outline"
            onClick={() => health.refetch()}
            disabled={health.isFetching}
          >
            {health.isFetching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Actualiser le statut
          </Button>
        </div>

        <HealthPanel
          host={host}
          port={port}
          loading={health.isLoading}
          data={health.data}
        />
      </Card>
    </div>
  );
}

function HealthPanel({
  host,
  port,
  loading,
  data,
}: {
  host: string;
  port: number;
  loading: boolean;
  data:
    | {
        online: boolean;
        configured: boolean;
        heartbeat:
          | {
              nas_host: string | null;
              nas_reachable: boolean;
              smb_connected: boolean;
              share_accessible?: boolean;
              last_error: string | null;
              updated_at: string;
            }
          | null;
      }
    | undefined;
}) {
  const hb = data?.heartbeat;
  const online = data?.online === true;
  const nasOk = Boolean(hb?.nas_reachable);
  const reachable = online && nasOk;

  return (
    <div className="rounded-md border p-4 text-sm space-y-3">
      <div className="flex items-center gap-2">
        {loading ? (
          <Badge variant="secondary">
            <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Vérification
          </Badge>
        ) : reachable ? (
          <Badge className="bg-emerald-600 text-white">
            <CircleCheck className="mr-1 h-3 w-3" /> Joignable
          </Badge>
        ) : (
          <Badge variant="destructive">
            <CircleX className="mr-1 h-3 w-3" /> Injoignable
          </Badge>
        )}
        <span className="text-muted-foreground">
          {host}:{port}
        </span>
      </div>

      <dl className="grid gap-2 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Gateway local</dt>
          <dd className="font-medium">
            {online ? "En ligne" : data?.configured === false ? "Non configuré" : "Hors ligne"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">SMB / Partage</dt>
          <dd className="font-medium">
            {hb
              ? `${hb.smb_connected ? "connecté" : "déconnecté"} · ${hb.share_accessible === false ? "partage KO" : "partage OK"}`
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Dernier heartbeat</dt>
          <dd className="font-medium">
            {hb ? new Date(hb.updated_at).toLocaleTimeString("fr-FR") : "—"}
          </dd>
        </div>
      </dl>

      {hb?.last_error && !reachable && (
        <p className="text-destructive">{hb.last_error}</p>
      )}

      <div className="flex items-start gap-2 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Le statut ci-dessus provient du <strong>GECO Synology Gateway</strong> installé sur
          votre LAN — la seule machine capable d'atteindre {host} sur votre réseau privé. Le
          serveur cloud ne peut pas tester directement une IP interne (192.168.x.x).
        </span>
      </div>
    </div>
  );
}
