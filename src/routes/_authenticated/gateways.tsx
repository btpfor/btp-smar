import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  CircleCheck,
  CircleX,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Settings2,
  Bell,
  AlertTriangle,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useRoles } from "@/hooks/use-auth";
import {
  listGateways,
  listGatewayErrorHistory,
  getAlertSettings,
  updateAlertSettings,
} from "@/lib/gateway.functions";

export const Route = createFileRoute("/_authenticated/gateways")({
  head: () => ({ meta: [{ title: "Gateways — GECO" }] }),
  component: GatewaysPage,
});

function GatewaysPage() {
  const { isAdmin } = useRoles();
  const listFn = useServerFn(listGateways);
  const settingsFn = useServerFn(getAlertSettings);

  const gateways = useQuery({
    queryKey: ["gateways-list"],
    queryFn: () => listFn(),
    refetchInterval: 20_000,
    enabled: isAdmin,
  });
  const settings = useQuery({
    queryKey: ["gateway-alert-settings"],
    queryFn: () => settingsFn(),
    enabled: isAdmin,
  });

  if (!isAdmin) {
    return <Card className="p-6 text-sm">Accès réservé aux administrateurs.</Card>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Gateways</h1>
          <p className="text-sm text-muted-foreground">
            Vue admin — dernier heartbeat, dernière erreur et étape d'échec par gateway.
          </p>
        </div>
        <Button variant="outline" onClick={() => gateways.refetch()} disabled={gateways.isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${gateways.isFetching ? "animate-spin" : ""}`} />
          Rafraîchir
        </Button>
      </div>

      <Card className="p-4">
        {gateways.isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Chargement…</p>
        ) : (gateways.data?.length ?? 0) === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            Aucun gateway n'a encore envoyé de heartbeat. Démarrez le service GECO Synology Gateway
            pour qu'il apparaisse ici.
          </p>
        ) : (
          <ul className="divide-y">
            {gateways.data!.map((g) => (
              <GatewayRow key={g.connectorId} g={g} />
            ))}
          </ul>
        )}
      </Card>

      <AlertSettingsCard current={settings.data} />
    </div>
  );
}

type Gateway = Awaited<ReturnType<typeof listGateways>>[number];

function GatewayRow({ g }: { g: Gateway }) {
  const [open, setOpen] = useState(false);
  const historyFn = useServerFn(listGatewayErrorHistory);
  const history = useQuery({
    queryKey: ["gateway-history", g.connectorId],
    queryFn: () => historyFn({ data: { connectorId: g.connectorId, limit: 20 } }),
    enabled: open,
  });

  return (
    <li className="py-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 text-left"
      >
        {open ? (
          <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{g.connectorId}</span>
            {g.online ? (
              <Badge className="bg-emerald-600 text-white">
                <CircleCheck className="mr-1 h-3 w-3" /> En ligne
              </Badge>
            ) : (
              <Badge variant="destructive">
                <CircleX className="mr-1 h-3 w-3" /> Hors ligne
              </Badge>
            )}
            {g.gatewayVersion && (
              <Badge variant="outline" className="text-xs">
                v{g.gatewayVersion}
              </Badge>
            )}
            {g.failureStep && (
              <Badge variant="destructive" className="text-xs">
                étape: {g.failureStep}
              </Badge>
            )}
          </div>
          <div className="mt-1 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
            <span>NAS: {g.nasHost ?? "—"}</span>
            <span>
              Dernier heartbeat : {new Date(g.updatedAt).toLocaleString("fr-FR")}
            </span>
            <span>
              Tâches: {g.pendingJobs} en attente · {g.failedJobs} en échec
            </span>
          </div>
          {g.lastError && (
            <pre className="mt-2 max-w-full whitespace-pre-wrap break-all rounded bg-destructive/5 p-2 text-xs text-destructive/90">
              {g.lastError}
            </pre>
          )}
        </div>
      </button>

      {open && (
        <div className="mt-3 ml-7 rounded-md border bg-muted/30 p-3">
          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            Historique des erreurs (20 dernières)
          </div>
          {history.isLoading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : (history.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune erreur récente.</p>
          ) : (
            <ul className="divide-y">
              {history.data!.map((e) => (
                <li key={e.id} className="py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="destructive" className="text-xs">
                      {e.status}
                    </Badge>
                    <span className="font-medium">{e.operation}</span>
                    {e.failureStep && (
                      <Badge variant="outline" className="text-xs">
                        {e.failureStep}
                      </Badge>
                    )}
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
        </div>
      )}
    </li>
  );
}

function AlertSettingsCard({
  current,
}: {
  current:
    | {
        offline_threshold_minutes: number;
        notify_frequency_minutes: number;
        email_enabled: boolean;
        email_recipients: string[];
      }
    | undefined;
}) {
  const qc = useQueryClient();
  const saveFn = useServerFn(updateAlertSettings);
  const [threshold, setThreshold] = useState<number>(current?.offline_threshold_minutes ?? 5);
  const [frequency, setFrequency] = useState<number>(current?.notify_frequency_minutes ?? 30);
  const [emailEnabled, setEmailEnabled] = useState<boolean>(current?.email_enabled ?? false);
  const [emailsText, setEmailsText] = useState<string>((current?.email_recipients ?? []).join(", "));

  // Hydrate quand les données arrivent
  const key = JSON.stringify(current ?? {});
  const [hydratedKey, setHydratedKey] = useState<string>("");
  if (current && key !== hydratedKey) {
    setThreshold(current.offline_threshold_minutes);
    setFrequency(current.notify_frequency_minutes);
    setEmailEnabled(current.email_enabled);
    setEmailsText((current.email_recipients ?? []).join(", "));
    setHydratedKey(key);
  }

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          offlineThresholdMinutes: threshold,
          notifyFrequencyMinutes: frequency,
          emailEnabled,
          emailRecipients: emailsText
            .split(/[,;\s]+/)
            .map((s) => s.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: () => {
      toast.success("Paramètres d'alerte enregistrés");
      qc.invalidateQueries({ queryKey: ["gateway-alert-settings"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Erreur d'enregistrement"),
  });

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center gap-3">
        <Settings2 className="h-5 w-5 text-accent" />
        <div>
          <h2 className="text-sm font-semibold uppercase text-muted-foreground">
            Notifications hors ligne
          </h2>
          <p className="text-xs text-muted-foreground">
            Vérification automatique toutes les minutes. Les admins reçoivent une notification si
            aucun heartbeat n'est reçu au-delà du seuil configuré.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="threshold">Seuil "hors ligne" (minutes)</Label>
          <Input
            id="threshold"
            type="number"
            min={1}
            max={1440}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Alerte déclenchée si le dernier heartbeat date de plus de X minutes.
          </p>
        </div>
        <div>
          <Label htmlFor="frequency">Fréquence de notification (minutes)</Label>
          <Input
            id="frequency"
            type="number"
            min={1}
            max={1440}
            value={frequency}
            onChange={(e) => setFrequency(Number(e.target.value))}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Délai minimum entre deux notifications pour le même gateway.
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-3 rounded-md border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-accent" />
            <Label htmlFor="email-enabled" className="cursor-pointer">
              Envoyer aussi par email
            </Label>
          </div>
          <Switch
            id="email-enabled"
            checked={emailEnabled}
            onCheckedChange={setEmailEnabled}
          />
        </div>
        <div>
          <Label htmlFor="emails">Destinataires email (séparés par virgules)</Label>
          <Input
            id="emails"
            placeholder="ops@example.com, admin@example.com"
            value={emailsText}
            onChange={(e) => setEmailsText(e.target.value)}
            disabled={!emailEnabled}
          />
        </div>
        {emailEnabled && (
          <p className="flex items-start gap-2 text-xs text-amber-600">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            L'envoi effectif d'emails nécessite qu'un domaine email soit configuré côté serveur
            (sinon seules les notifications in-app sont émises).
          </p>
        )}
      </div>

      <div className="mt-6 flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          <Save className="mr-2 h-4 w-4" />
          Enregistrer
        </Button>
      </div>
    </Card>
  );
}
