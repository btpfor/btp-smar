import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  Activity,
  CircleCheck,
  CircleX,
  Loader2,
  PlayCircle,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useRoles } from "@/hooks/use-auth";
import {
  getGatewayDiagnostic,
  listGatewayErrors,
  startGatewayDiagnostic,
} from "@/lib/gateway.functions";

export const Route = createFileRoute("/_authenticated/gateway-diagnostic")({
  head: () => ({ meta: [{ title: "Diagnostic Gateway — GECO" }] }),
  component: DiagnosticPage,
});

interface DiagStep {
  name: string;
  ok: boolean;
  detail?: string;
  ms: number;
}
interface DiagResult {
  allOk?: boolean;
  steps?: DiagStep[];
  nasHost?: string;
  share?: string;
  root?: string;
  rootStat?: { size: number; mtime: string; isDirectory: boolean } | null;
  checkedAt?: string;
}

function DiagnosticPage() {
  const { isAdmin } = useRoles();
  const startFn = useServerFn(startGatewayDiagnostic);
  const getFn = useServerFn(getGatewayDiagnostic);
  const listErrFn = useServerFn(listGatewayErrors);

  const [jobId, setJobId] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: () => startFn(),
    onSuccess: (r) => setJobId(r.jobId),
  });

  const job = useQuery({
    queryKey: ["gateway-diagnostic", jobId],
    queryFn: () => getFn({ data: { jobId: jobId! } }),
    enabled: !!jobId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s && (s === "COMPLETED" || s === "FAILED" || s === "CONFLICT") ? false : 2000;
    },
  });

  const errors = useQuery({
    queryKey: ["gateway-errors"],
    queryFn: () => listErrFn(),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (job.data?.status === "COMPLETED" || job.data?.status === "FAILED") {
      errors.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.data?.status]);

  if (!isAdmin) {
    return <Card className="p-6 text-sm">Accès réservé aux administrateurs.</Card>;
  }

  const running =
    start.isPending || (jobId && job.data && (job.data.status === "PENDING" || job.data.status === "PROCESSING"));
  const result = (job.data?.result as DiagResult | null) ?? null;
  const timedOut =
    jobId &&
    job.data?.status === "PENDING" &&
    Date.now() - new Date(job.data.created_at).getTime() > 60_000;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Diagnostic Gateway</h1>
          <p className="text-sm text-muted-foreground">
            Teste la connexion SMB, vérifie l'accès en écriture sur le partage GECO du DS112 et
            affiche les erreurs récentes remontées par le Gateway.
          </p>
        </div>
        <Button onClick={() => start.mutate()} disabled={!!running}>
          {running ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <PlayCircle className="mr-2 h-4 w-4" />
          )}
          Lancer le diagnostic
        </Button>
      </div>

      <Card className="p-6">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-accent" />
          <h2 className="text-sm font-semibold uppercase text-muted-foreground">
            Dernier test exécuté
          </h2>
          {job.data?.status && (
            <Badge variant={result?.allOk ? "secondary" : job.data.status === "PENDING" || job.data.status === "PROCESSING" ? "outline" : "destructive"}>
              {job.data.status}
            </Badge>
          )}
        </div>

        {!jobId && (
          <p className="mt-4 text-sm text-muted-foreground">
            Cliquez sur « Lancer le diagnostic ». Le Gateway installé sur le réseau du DS112
            prendra la tâche en charge (≈ 5–10 s) et remontera le résultat détaillé ici.
          </p>
        )}

        {jobId && job.data?.status && (job.data.status === "PENDING" || job.data.status === "PROCESSING") && (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {job.data.status === "PENDING"
              ? "En attente que le Gateway prenne la tâche…"
              : "Diagnostic en cours sur le Gateway…"}
          </p>
        )}

        {timedOut && (
          <p className="mt-4 flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            Aucun Gateway n'a récupéré la tâche depuis plus d'une minute — vérifiez que le service
            « GECO Synology Gateway » est démarré sur le réseau du DS112.
          </p>
        )}

        {job.data?.status === "FAILED" && (
          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <div className="font-medium text-destructive">Le diagnostic a échoué</div>
            <pre className="mt-2 whitespace-pre-wrap break-all text-xs text-destructive/90">
              {job.data.last_error ?? "erreur inconnue"}
            </pre>
          </div>
        )}

        {result?.steps && (
          <div className="mt-4 space-y-2">
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <Info label="Hôte NAS" value={result.nasHost ?? "—"} />
              <Info label="Partage" value={result.share ?? "—"} />
              <Info label="Racine" value={result.root || "(racine du partage)"} />
            </dl>
            <ul className="mt-4 divide-y rounded-md border">
              {result.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-3 p-3 text-sm">
                  {s.ok ? (
                    <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-xs text-muted-foreground">{s.ms} ms</span>
                    </div>
                    {s.detail && (
                      <pre className="mt-1 whitespace-pre-wrap break-all text-xs text-muted-foreground">
                        {s.detail}
                      </pre>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {result.checkedAt && (
              <p className="mt-2 text-xs text-muted-foreground">
                Exécuté le {new Date(result.checkedAt).toLocaleString("fr-FR")}
              </p>
            )}
          </div>
        )}
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <h2 className="text-sm font-semibold uppercase text-muted-foreground">
              Erreurs récentes du Gateway
            </h2>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => errors.refetch()}
            disabled={errors.isFetching}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${errors.isFetching ? "animate-spin" : ""}`} />
            Rafraîchir
          </Button>
        </div>

        {(errors.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune erreur récente enregistrée. Les tâches remontées par le Gateway avec le statut
            FAILED ou CONFLICT apparaîtront ici avec leur message d'erreur détaillé.
          </p>
        ) : (
          <ul className="divide-y">
            {errors.data!.map((e) => (
              <li key={e.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="destructive">{e.status}</Badge>
                  <span className="font-medium">{e.operation}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(e.completed_at ?? e.created_at).toLocaleString("fr-FR")}
                  </span>
                </div>
                {(e.source_path || e.destination_path) && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {e.source_path && <span>src: {e.source_path}</span>}
                    {e.destination_path && (
                      <span className="ml-3">dest: {e.destination_path}</span>
                    )}
                  </div>
                )}
                {e.last_error && (
                  <pre className="mt-1 whitespace-pre-wrap break-all rounded bg-destructive/5 p-2 text-xs text-destructive/90">
                    {e.last_error}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}
