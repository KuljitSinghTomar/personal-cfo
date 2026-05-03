import { Link, useLocation } from "wouter";
import { LayoutDashboard, ReceiptText, Bot, LineChart, Target, TrendingUp, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/transactions", label: "Transactions", icon: ReceiptText },
    { href: "/budget", label: "Budget Goals", icon: Target },
    { href: "/net-worth", label: "Net Worth", icon: TrendingUp },
    { href: "/scenarios", label: "Scenarios", icon: LineChart },
    { href: "/ai-advisor", label: "AI Advisor", icon: Bot },
    { href: "/category-rules", label: "Rules", icon: Zap },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row text-foreground selection:bg-primary/30">
      {/* Sidebar */}
      <aside className="w-full md:w-64 border-b md:border-r border-border bg-sidebar flex-shrink-0">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded bg-primary flex items-center justify-center">
              <span className="text-primary-foreground text-xs font-bold font-mono">FC</span>
            </div>
            <span className="font-bold tracking-tight text-sm uppercase">Family CFO</span>
          </div>
        </div>
        <nav className="p-4 flex md:flex-col gap-1 overflow-x-auto">
          {navItems.map((item) => {
            const isActive = location === item.href;
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className="flex-shrink-0 outline-none">
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors cursor-pointer outline-none",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden md:inline">{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-background">
        {children}
      </main>
    </div>
  );
}
