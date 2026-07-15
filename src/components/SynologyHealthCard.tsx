import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { CircleCheck, CircleX, Loader2, RefreshCw, Settings, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getGatewayStatus } from "@/lib/gateway.functions";

/**
 * Statut Synology basé sur le vrai heartbeat du GECO Synology Gateway
 * installé sur le LAN. Le cloud ne peut pas atteindre 192.168.1.21 :
 * on affiche donc la santé remontée par le Gateway (SMB + partage réels).
 */
export function SynologyHealthCard() {
  const fn = useServerFn(getGatewayStatus);
  const q = useQuery({
    queryKey: ["gateway-status"],
    queryFn: () => fn(),
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  const d = q.data;
  const hb = d?.heartbeat as
    | {
        nas_host: string | null;
        nas_reachable: boolean;
        smb_connected: boolean;
        share_accessible?: boolean;
        last_error: string | null;
        updated_at: string;
      }
    | null
    | undefined;

  const nasOk = Boolean(hb?.nas_reachable);
  const online = d?.online === true;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-semibold">Synology DSM</CardTitle>
        <Wifi className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {q.isLoading ? (
            <Badge variant="secondary">
              <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Vérification
            </Badge>
          ) : online && nasOk ? (
            <Badge className="bg-emerald-600 text-white">
              <CircleCheck className="mr-1 h-3 w-3" /> Joignable
            </Badge>
          ) : (
            <Badge variant="destructive">
              <CircleX className="mr-1 h-3 w-3" /> Injoignable
            </Badge>
          )}
          {hb?.nas_host && (
            <span className="text-xs text-muted-foreground">{hb.nas_host}</span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {!online
            ? d?.configured === false
              ? "Gateway non configuré."
              : "Gateway hors ligne — aucun heartbeat récent."
            : nasOk
              ? `SMB : ${hb?.smb_connected ? "connecté" : "déconnecté"} · Partage : ${hb?.share_accessible === false ? "inaccessible" : "OK"}`
              : (hb?.last_error ?? "NAS injoignable depuis le Gateway.")}
        </div>
        {hb && (
          <div className="text-xs text-muted-foreground">
            Dernier heartbeat : {new Date(hb.updated_at).toLocaleTimeString("fr-FR")}
          </div>
        )}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => q.refetch()}
            disabled={q.isFetching}
          >
            <RefreshCw
              className={`mr-2 h-3 w-3 ${q.isFetching ? "animate-spin" : ""}`}
            />
            Actualiser
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/synology-config">
              <Settings className="mr-2 h-3 w-3" /> Configurer
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
