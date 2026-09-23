import { Link, useRouterState } from "@tanstack/react-router";
import {
  Map,
  LayoutDashboard,
  Play,
  Route as RouteIcon,
  History,
  Sparkles,
  FlaskConical,
  ScanEye,
  Boxes,
  HeartPulse,
  BarChart3,
  Landmark,
  Users,
  Shield,
  ChevronLeft,
  FileEdit,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface NavItem {
  to: string;
  label: string;
  code: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
  plannerOnly?: boolean; // visible to planner + admin
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Live Map", code: "S3", icon: Map },
  { to: "/dashboard", label: "Dashboard", code: "S2", icon: LayoutDashboard },
  { to: "/run", label: "Run Control", code: "S4", icon: Play },
  { to: "/planner", label: "Mission Planner", code: "S5", icon: RouteIcon },
  { to: "/doctrine", label: "Doctrine & SOPs", code: "S17", icon: BookOpen },
  { to: "/replay", label: "Replay", code: "S6", icon: History },
  { to: "/sitrep", label: "AI Sitrep", code: "S7", icon: Sparkles },
  { to: "/whatif", label: "What-If Theater", code: "S8", icon: FlaskConical },
  { to: "/vision", label: "Vision Review", code: "S9", icon: ScanEye },
  { to: "/logistics", label: "Logistics", code: "S10", icon: Boxes },
  { to: "/personnel", label: "Personnel", code: "S11", icon: HeartPulse },
  { to: "/analytics", label: "Analytics", code: "S12", icon: BarChart3 },
  { to: "/advisor", label: "Investment Advisor", code: "S13", icon: Landmark },
  { to: "/warroom", label: "War-Room", code: "S14", icon: Users },
  // P2-1: Scenario DSL Editor — planner and admin roles
  {
    to: "/scenario-editor",
    label: "Scenario Editor",
    code: "S16",
    icon: FileEdit,
    plannerOnly: true,
  },
  { to: "/admin", label: "Admin", code: "S15", icon: Shield, adminOnly: true },
];

export function SideNav({
  collapsed,
  onToggle,
  role,
}: {
  collapsed: boolean;
  onToggle: () => void;
  role: string | null;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const items = NAV_ITEMS.filter(
    (i) =>
      (!i.adminOnly || role === "admin") &&
      (!i.plannerOnly || role === "admin" || role === "planner"),
  );

  return (
    <nav
      className={cn(
        "flex shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200",
        collapsed ? "w-14" : "w-56",
      )}
      aria-label="Primary"
    >
      <div className="flex h-11 items-center gap-2 border-b border-border px-2">
        <span className="font-mono text-sm font-bold tracking-[0.2em] text-primary">DOIP</span>
        {!collapsed && (
          <span className="truncate text-[10px] uppercase tracking-widest text-muted-foreground">
            Ops Intelligence
          </span>
        )}
      </div>
      <ul className="flex-1 overflow-y-auto p-2">
        {items.map((item) => {
          const active = pathname === item.to;
          const Icon = item.icon;
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                title={item.label}
                className={cn(
                  "mb-0.5 flex items-center gap-2  px-2 py-1.5 text-xs transition-colors",
                  active
                    ? "bg-raised text-primary"
                    : "text-muted-foreground hover:bg-raised hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {!collapsed && (
                  <>
                    <span className="truncate">{item.label}</span>
                    <span className="ml-auto font-mono text-[9px] text-muted-foreground/60">
                      {item.code}
                    </span>
                  </>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      <button
        onClick={onToggle}
        className="flex items-center gap-2 border-t border-border px-2 py-2 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
        {!collapsed && "Collapse"}
      </button>
    </nav>
  );
}
