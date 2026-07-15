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
            onClick={() => health.mutate()}
            disabled={health.isPending}
          >
            {health.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Wifi className="mr-2 h-4 w-4" />
            )}
            Tester la connectivité
          </Button>
        </div>

        {health.data && (
          <div className="rounded-md border p-4 text-sm">
            <div className="flex items-center gap-2">
              {health.data.ok ? (
                <Badge className="bg-emerald-600 text-white">
                  <CircleCheck className="mr-1 h-3 w-3" /> Joignable
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <CircleX className="mr-1 h-3 w-3" /> Injoignable
                </Badge>
              )}
              <span className="text-muted-foreground">{health.data.url}</span>
            </div>
            <dl className="mt-3 grid gap-2 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Statut HTTP</dt>
                <dd className="font-medium">{health.data.status || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Latence</dt>
                <dd className="font-medium">{health.data.latencyMs} ms</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Vérifié à</dt>
                <dd className="font-medium">
                  {new Date(health.data.checkedAt).toLocaleTimeString("fr-FR")}
                </dd>
              </div>
            </dl>
            {health.data.error && (
              <p className="mt-2 text-destructive">{health.data.error}</p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
