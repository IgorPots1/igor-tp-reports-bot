import type { ReactNode } from "react";

import AdminShell from "@/app/admin/AdminShell";
import { isAdminAccessBypassedForLocalDev } from "@/lib/admin-auth";

type PublicAdminLayoutProps = {
  children: ReactNode;
};

export default function PublicAdminLayout({ children }: PublicAdminLayoutProps) {
  return (
    <AdminShell
      hasAdminSession={false}
      showAdminNav={false}
      showDevBypassWarning={isAdminAccessBypassedForLocalDev()}
    >
      {children}
    </AdminShell>
  );
}
