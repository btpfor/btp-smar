export type AppRole = "admin" | "chef_projet" | "ingenieur" | "client";

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrateur",
  chef_projet: "Chef de projet",
  ingenieur: "Ingénieur / Conducteur",
  client: "Client",
};

export type ProjectStatus = "en_preparation" | "en_cours" | "suspendu" | "termine";

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  en_preparation: "En préparation",
  en_cours: "En cours",
  suspendu: "Suspendu",
  termine: "Terminé",
};

export const STATUS_COLORS: Record<ProjectStatus, string> = {
  en_preparation: "bg-muted text-muted-foreground",
  en_cours: "bg-accent/15 text-accent border-accent/30",
  suspendu: "bg-warning/15 text-warning-foreground border-warning/30",
  termine: "bg-success/15 text-success border-success/30",
};
