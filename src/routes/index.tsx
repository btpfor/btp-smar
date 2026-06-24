import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, HardHat, ShieldCheck, FolderKanban, BarChart3, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Well Done Services — Plateforme collaborative BTP" },
      {
        name: "description",
        content:
          "Centralisez vos projets BTP, équipes et documents. Conçue pour les conducteurs de travaux, ingénieurs et chefs de projet.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <HardHat className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-bold text-primary">Well Done Services</div>
              <div className="text-xs text-muted-foreground">Company SARL</div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="ghost">
              <Link to="/auth">Connexion</Link>
            </Button>
            <Button asChild className="bg-accent hover:bg-accent/90 text-accent-foreground">
              <Link to="/auth">Accéder à la plateforme</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section
        className="relative overflow-hidden"
        style={{ background: "var(--gradient-primary)" }}
      >
        <div className="container mx-auto px-6 py-20 md:py-28">
          <div className="max-w-3xl text-primary-foreground">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs backdrop-blur">
              <span className="h-2 w-2 rounded-full bg-accent" />
              Plateforme BTP collaborative
            </div>
            <h1 className="text-4xl font-bold leading-tight md:text-6xl">
              Gérez vos chantiers,
              <span className="block text-accent">simplement.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-primary-foreground/80">
              Centralisez vos projets BTP, partagez vos documents en temps réel et suivez
              l'avancement de vos travaux avec vos équipes terrain et vos clients.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                asChild
                size="lg"
                className="bg-accent hover:bg-accent/90 text-accent-foreground"
              >
                <Link to="/auth">Commencer maintenant</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="bg-white/10 text-white border-white/30 hover:bg-white/20"
              >
                <a href="#features">Découvrir les modules</a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="container mx-auto px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold md:text-4xl">Tout ce qu'il faut pour piloter vos chantiers</h2>
          <p className="mt-4 text-muted-foreground">
            Une plateforme pensée pour les équipes BTP : du bureau d'études au pied du chantier.
          </p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {[
            {
              icon: FolderKanban,
              title: "Gestion de projets",
              desc: "Suivez chaque chantier : budget, planning, statut et avancement en temps réel.",
            },
            {
              icon: Users,
              title: "Équipes & rôles",
              desc: "Administrateur, chef de projet, ingénieur, client : chacun voit ce qu'il doit voir.",
            },
            {
              icon: Building2,
              title: "Tableau de bord",
              desc: "Vision consolidée des projets en cours, terminés, et indicateurs clés.",
            },
            {
              icon: ShieldCheck,
              title: "Sécurité",
              desc: "Authentification sécurisée et permissions par rôle au niveau base de données.",
            },
            {
              icon: BarChart3,
              title: "Suivi d'avancement",
              desc: "Graphiques et statistiques sur l'état de votre portefeuille de projets.",
            },
            {
              icon: HardHat,
              title: "Pensée chantier",
              desc: "Interface claire, adaptée mobile et tablette, pour le terrain et le bureau.",
            },
          ].map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="rounded-xl border bg-card p-6 transition-shadow hover:shadow-[var(--shadow-elegant)]"
            >
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t bg-secondary/40">
        <div className="container mx-auto flex flex-col items-center gap-4 px-6 py-16 text-center">
          <h2 className="text-3xl font-bold">Prêt à structurer vos chantiers ?</h2>
          <p className="max-w-xl text-muted-foreground">
            Rejoignez la plateforme et démarrez la collaboration avec vos équipes en quelques minutes.
          </p>
          <Button
            asChild
            size="lg"
            className="bg-accent hover:bg-accent/90 text-accent-foreground"
          >
            <Link to="/auth">Créer un compte</Link>
          </Button>
        </div>
      </section>

      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} Well Done Services Company SARL — Tous droits réservés.
      </footer>
    </div>
  );
}
