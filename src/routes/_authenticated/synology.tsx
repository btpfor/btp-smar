import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  HardDrive,
  RefreshCw,
  CircleCheck,
  CircleX,
  ListTodo,
  AlertTriangle,
  FileClock,
  FileText,
  UploadCloud,
  CheckCircle2,
  Archive,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useRoles } from "@/hooks/use-auth";
import { getGatewayStatus, runGatewaySync } from "@/lib/gateway.functions";
import { getStorageStats, retryFailedFileJobs } from "@/lib/documents.functions";

export const Route = createFileRoute("/_authenticated/synology")({
  head: () => ({ meta: [{ title: "Stockage & Synology — GECO" }] }),
  component: SynologyPage,
});

function bytes(n?: number | null) {
  if (!n || n <= 0) return "—";
  const u = ["o", "Ko", "Mo", "Go", "To"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${u[i]}`;
}

function SynologyPage() {
  const { isAdmin } = useRoles();
  const statusFn = useServerFn(getGatewayStatus);
  const syncFn = useServerFn(runGatewaySync);
  const q = useQuery({
    queryKey: ["gateway-status"],
    queryFn: () => statusFn(),
    refetchInterval: 15_000,
  });
  const sync = useMutation({ mutationFn: () => syncFn({ data: {} }) });

  if (!isAdmin) {
    return <Card className="p-6 text-sm">Accès réservé aux administrateurs.</Card>;
  }

  const data = q.data;
  const online = data?.online === true;
  const hb = data?.heartbeat as
    | {
        gateway_version: string | null;
        nas_host: string | null;
        nas_reachable: boolean;
        smb_connected: boolean;
        share_accessible?: boolean;
        read_allowed?: boolean;
        write_allowed?: boolean;
        total_bytes: number | null;
        used_bytes: number | null;
        available_bytes: number | null;
        pending_jobs: number;
        failed_jobs: number;
        last_sync_at: string | null;
        last_error: string | null;
        updated_at: string;
      }
    | null
    | undefined;

  const nasOk = Boolean(hb?.nas_reachable);
  const smbOk = Boolean(hb?.smb_connected);
  const shareOk = hb?.share_accessible !== false;
  const usedPercent =
    hb?.total_bytes && hb.used_bytes ? Math.round((hb.used_bytes / hb.total_bytes) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Stockage & Synology</h1>
          <p className="text-sm text-muted-foreground">
            NAS : Synology DS112 (192.168.1.21) — via GECO Synology Gateway
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
            Tester le Gateway
          </Button>
          <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
            Synchroniser maintenant
          </Button>
        </div>
      </div>

      <Card className="p-6">
        <div className="flex items-start gap-3">
          <HardDrive className="mt-1 h-6 w-6 text-accent" />
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">GECO Synology Gateway</span>
              {online ? (
                <Badge className="bg-emerald-600 text-white">
                  <CircleCheck className="mr-1 h-3 w-3" /> Connecté
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <CircleX className="mr-1 h-3 w-3" /> Hors ligne
                </Badge>
              )}
              <Badge variant={nasOk ? "secondary" : "destructive"}>
                NAS DS112 : {nasOk ? "accessible" : "inaccessible"}
              </Badge>
              <Badge variant={smbOk ? "secondary" : "destructive"}>
                SMB : {smbOk ? "connecté" : "déconnecté"}
              </Badge>
              <Badge variant={shareOk ? "secondary" : "destructive"}>
                Partage : {shareOk ? "accessible" : "inaccessible"}
              </Badge>
            </div>

            {!online && (
              <p className="mt-2 text-sm text-muted-foreground">
                {data?.configured === false
                  ? "GECO Synology Gateway non installé ou hors ligne — configurez GECO_GATEWAY_ID et GECO_GATEWAY_SECRET, puis démarrez le Gateway sur le serveur local."
                  : "GECO Synology Gateway non installé ou hors ligne — aucun heartbeat récent reçu."}
              </p>
            )}
            {online && !nasOk && (
              <p className="mt-2 text-sm text-destructive">
                Synology DS112 inaccessible depuis le Gateway ({hb?.last_error ?? "cause inconnue"}).
              </p>
            )}
          </div>
        </div>

        <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2 md:grid-cols-4">
          <Info label="Version Gateway" value={hb?.gateway_version ?? "—"} />
          <Info label="Hôte NAS" value={hb?.nas_host ?? "192.168.1.21"} />
          <Info
            label="Dernière communication"
            value={hb ? new Date(hb.updated_at).toLocaleString("fr-FR") : "—"}
          />
          <Info
            label="Dernière synchronisation"
            value={hb?.last_sync_at ? new Date(hb.last_sync_at).toLocaleString("fr-FR") : "—"}
          />
        </dl>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          icon={<ListTodo className="h-5 w-5" />}
          label="Tâches en attente"
          value={String(data?.pendingJobs ?? 0)}
        />
        <StatCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label="Erreurs de synchronisation"
          value={String(data?.failedJobs ?? 0)}
          tone={(data?.failedJobs ?? 0) > 0 ? "danger" : "default"}
        />
        <StatCard
          icon={<FileClock className="h-5 w-5" />}
          label="Dernier heartbeat"
          value={hb ? new Date(hb.updated_at).toLocaleTimeString("fr-FR") : "—"}
        />
      </div>

      <Card className="p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase text-muted-foreground">
          Espace disque du DS112
        </h2>
        {hb?.total_bytes ? (
          <>
            <div className="mb-2 h-3 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-accent"
                style={{ width: `${Math.min(100, usedPercent)}%` }}
              />
            </div>
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <Info label="Utilisé" value={`${bytes(hb.used_bytes)} (${usedPercent}%)`} />
              <Info label="Disponible" value={bytes(hb.available_bytes)} />
              <Info label="Total" value={bytes(hb.total_bytes)} />
            </dl>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Données d'espace disque non encore reçues du Gateway.
          </p>
        )}
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "default" | "danger";
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div
          className={`grid h-9 w-9 place-items-center rounded-md ${
            tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-accent/10 text-accent"
          }`}
        >
          {icon}
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-lg font-semibold">{value}</div>
        </div>
      </div>
    </Card>
  );
}
