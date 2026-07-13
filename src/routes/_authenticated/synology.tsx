import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { HardDrive, RefreshCw, CircleCheck, CircleX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useRoles } from "@/hooks/use-auth";
import { getSynologyStatus } from "@/lib/synology.functions";

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
  const fn = useServerFn(getSynologyStatus);
  const q = useQuery({
    queryKey: ["synology-status"],
    queryFn: () => fn(),
    refetchInterval: 30_000,
  });

  if (!isAdmin) {
    return <Card className="p-6 text-sm">Accès réservé aux administrateurs.</Card>;
  }

  const data = q.data;
  const online = data?.online === true;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Stockage & Synology</h1>
          <p className="text-sm text-muted-foreground">GECO Synology Connector</p>
        </div>
        <Button variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
          Tester la connexion
        </Button>
      </div>

      <Card className="p-6">
        <div className="flex items-center gap-3">
          <HardDrive className="h-6 w-6 text-accent" />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold">GECO Synology Connector</span>
              {online ? (
                <Badge className="bg-emerald-600 text-white">
                  <CircleCheck className="mr-1 h-3 w-3" /> En ligne
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <CircleX className="mr-1 h-3 w-3" /> Hors ligne
                </Badge>
              )}
            </div>
            {!online && (
              <p className="mt-1 text-sm text-muted-foreground">
                {data?.configured === false
                  ? "Connecteur non configuré. Renseignez SYNOLOGY_CONNECTOR_URL, SYNOLOGY_CONNECTOR_ID et SYNOLOGY_CONNECTOR_SECRET."
                  : (data?.message ?? "Impossible de joindre le NAS.")}
              </p>
            )}
          </div>
        </div>

        {online && data?.health && (
          <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2 md:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Version</dt>
              <dd className="font-medium">{(data.health as { version?: string }).version ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Connecteur</dt>
              <dd className="font-medium">{(data.health as { connectorId?: string }).connectorId ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Heure serveur</dt>
              <dd className="font-medium">
                {(data.health as { serverTime?: string }).serverTime
                  ? new Date((data.health as { serverTime: string }).serverTime).toLocaleString("fr-FR")
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Dernière vérification</dt>
              <dd className="font-medium">
                {data.lastCheckedAt ? new Date(data.lastCheckedAt).toLocaleTimeString("fr-FR") : "—"}
              </dd>
            </div>
          </dl>
        )}
      </Card>

      {online && data?.storage != null && (
        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase text-muted-foreground">Espace disque</h2>
          {(() => {
            const s = (data.storage as { storage?: Record<string, unknown>; queue?: Record<string, unknown> })
              .storage as
              | {
                  totalBytes: number;
                  usedBytes: number;
                  availableBytes: number;
                  usagePercent: number;
                  root: string;
                  readable: boolean;
                  writable: boolean;
                }
              | undefined;
            const queue = (data.storage as { queue?: { pending: number; withErrors: number; lastProcessedAt: string | null } })
              .queue;
            if (!s) return <p className="text-sm text-muted-foreground">Indisponible</p>;
            return (
              <>
                <div className="mb-2 h-3 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${Math.min(100, s.usagePercent)}%` }}
                  />
                </div>
                <div className="grid gap-4 text-sm sm:grid-cols-2 md:grid-cols-4">
                  <Info label="Utilisé" value={`${bytes(s.usedBytes)} (${s.usagePercent}%)`} />
                  <Info label="Disponible" value={bytes(s.availableBytes)} />
                  <Info label="Total" value={bytes(s.totalBytes)} />
                  <Info label="Racine" value={s.root} />
                  <Info label="Lecture" value={s.readable ? "OK" : "Refusée"} />
                  <Info label="Écriture" value={s.writable ? "OK" : "Refusée"} />
                  {queue && <Info label="File d'attente" value={String(queue.pending)} />}
                  {queue && <Info label="Erreurs" value={String(queue.withErrors)} />}
                  {queue && (
                    <Info
                      label="Dernière synchro"
                      value={queue.lastProcessedAt ? new Date(queue.lastProcessedAt).toLocaleString("fr-FR") : "—"}
                    />
                  )}
                </div>
              </>
            );
          })()}
        </Card>
      )}
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
