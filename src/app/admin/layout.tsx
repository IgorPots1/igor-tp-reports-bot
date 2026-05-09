import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import AdminShell from "@/app/admin/AdminShell";
import {
  ADMIN_ACCESS_COOKIE_NAME,
  hasValidAdminAccessCookie,
  isAdminAccessBypassedForLocalDev,
} from "@/lib/admin-auth";

type AdminLayoutProps = {
  children: ReactNode;
};

export default async function AdminLayout({ children }: AdminLayoutProps) {
  const cookieStore = await cookies();
  const hasAdminSession = hasValidAdminAccessCookie(cookieStore.get(ADMIN_ACCESS_COOKIE_NAME)?.value);
  const isLocalDevBypass = isAdminAccessBypassedForLocalDev();

  if (!hasAdminSession && !isLocalDevBypass) {
    redirect("/admin/login?next=%2Fadmin%2Freports");
  }

  return (
    <AdminShell
      hasAdminSession={hasAdminSession}
      showAdminNav={hasAdminSession || isLocalDevBypass}
      showDevBypassWarning={isLocalDevBypass}
    >
      {children}
    </AdminShell>
  );
}
