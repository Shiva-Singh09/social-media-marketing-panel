import type { ReactNode } from "react";
import { ADMIN_NAV, PanelShell } from "@/components/PanelShell";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <PanelShell nav={ADMIN_NAV} adminOnly>
      {children}
    </PanelShell>
  );
}
