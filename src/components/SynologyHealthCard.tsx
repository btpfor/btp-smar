import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { CircleCheck, CircleX, Loader2, RefreshCw, Settings, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { checkSynologyHealth } from "@/lib/synology.functions";

export function SynologyHealthCard() {
  const fn = useServerFn(checkSynologyHealth);
  // Ping automatique au montage puis toutes les 60 s.
  const q = useQuery({
    queryKey: ["synology-health"],
    queryFn: () => fn({ data: {} }),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  const manual = useMutation({
    mutationFn: () => fn({ data: {} }),
    onSuccess: () => q.refetch(),
  });

  const d = q.data;
  const loading = q.isLoading || manual.isPending;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-semibold">Synology DSM</CardTitle>
        <Wifi className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          {loading ? (
            <Badge variant="secondary">
              <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Test en cours
            </Badge>
          ) : d?.ok ? (
            <Badge className="bg-emerald-600 text-white">
              <CircleCheck className="mr-1 h-3 w-3" /> Joignable
            </Badge>
          ) : (
            <Badge variant="destructive">
              <CircleX className="mr-1 h-3 w-3" /> Injoignable
            </Badge>
          )}
          {d && (
            <span className="text-xs text-muted-foreground">
              {d.host}:{d.port}
            </span>
          )}
        </div>
        {d && (
          <div className="text-xs text-muted-foreground">
            {d.ok
              ? `HTTP ${d.status} · ${d.latencyMs} ms`
              : d.error ?? "Erreur inconnue"}
          </div>
        )}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => manual.mutate()}
            disabled={loading}
          >
            <RefreshCw className={`mr-2 h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            Retester
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
