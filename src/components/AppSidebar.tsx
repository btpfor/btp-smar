import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, FolderKanban, Users, HardHat, FolderOpen, ListTodo } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useRoles } from "@/hooks/use-auth";

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const currentPath = useRouterState({ select: (r) => r.location.pathname });
  const { isAdmin, hasRole } = useRoles();
  const isClient = hasRole("client");

  const items = [
    { title: "Tableau de bord", url: "/dashboard", icon: LayoutDashboard },
    { title: "Projets", url: "/projects", icon: FolderKanban },
    { title: "Documents", url: "/documents", icon: FolderOpen },
  ];
  if (!isClient) items.push({ title: "Tâches", url: "/tasks", icon: ListTodo });
  if (isAdmin) items.push({ title: "Utilisateurs", url: "/users", icon: Users });


  const isActive = (p: string) =>
    p === "/dashboard" ? currentPath === p : currentPath.startsWith(p);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <HardHat className="h-4 w-4" />
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-sm font-bold">Well Done</div>
              <div className="text-[10px] text-sidebar-foreground/70">Services SARL</div>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <Link to={item.url} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
