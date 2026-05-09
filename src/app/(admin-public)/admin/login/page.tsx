import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { loginAdminAction } from "@/app/admin/login/actions";
import { getSingleSearchParam } from "@/app/admin/lib";
import {
  ADMIN_ACCESS_COOKIE_NAME,
  hasValidAdminAccessCookie,
  isAdminAccessBypassedForLocalDev,
  isAdminAccessConfigured,
  normalizeAdminRedirectPath,
} from "@/lib/admin-auth";

type AdminLoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminLoginPage({ searchParams }: AdminLoginPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const notice = getSingleSearchParam(resolvedSearchParams.notice);
  const error = getSingleSearchParam(resolvedSearchParams.error);
  const nextPath = normalizeAdminRedirectPath(getSingleSearchParam(resolvedSearchParams.next));
  const isConfigured = isAdminAccessConfigured();
  const isLocalDevBypass = isAdminAccessBypassedForLocalDev();
  const cookieStore = await cookies();

  if (hasValidAdminAccessCookie(cookieStore.get(ADMIN_ACCESS_COOKIE_NAME)?.value)) {
    redirect(nextPath);
  }

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <h2>Вход в Web Admin</h2>
          <p className="admin-muted">
            Доступ к разделу администрирования защищён отдельным токеном и не связан с Telegram или Supabase Auth.
          </p>
        </div>
      </div>

      {(notice || error) && (
        <div className={`admin-alert ${error ? "admin-alert-error" : "admin-alert-success"}`}>
          {error ?? notice}
        </div>
      )}

      {!isConfigured ? (
        <article className={`admin-card admin-alert ${isLocalDevBypass ? "admin-alert-warning" : "admin-alert-error"}`}>
          {isLocalDevBypass ? (
            <>
              <strong>Локальный dev-режим:</strong> <code>ADMIN_ACCESS_TOKEN</code> не задан, поэтому{" "}
              <code>/admin</code> открыт только потому, что приложение запущено не в production.
            </>
          ) : (
            <>
              <strong>ADMIN_ACCESS_TOKEN не настроен.</strong> Добавь переменную окружения локально и в Vercel до
              использования <code>/admin</code> в production.
            </>
          )}
        </article>
      ) : (
        <article className="admin-card">
          <form className="admin-form-stack" action={loginAdminAction}>
            <input type="hidden" name="next" value={nextPath} />

            <label className="admin-field">
              <span>Admin access token</span>
              <input
                className="admin-input"
                name="token"
                type="password"
                autoComplete="current-password"
                placeholder="Введите токен"
                required
              />
              <span className="admin-muted">
                Токен проверяется только на сервере. После успешного входа будет установлена защищённая cookie-сессия.
              </span>
            </label>

            <div className="admin-actions">
              <button className="admin-button" type="submit">
                Войти
              </button>
            </div>
          </form>
        </article>
      )}
    </section>
  );
}
