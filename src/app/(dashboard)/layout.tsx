import type { ReactNode } from "react";
import { PanelShell, USER_NAV } from "@/components/PanelShell";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <PanelShell nav={USER_NAV}>{children}</PanelShell>;
}
