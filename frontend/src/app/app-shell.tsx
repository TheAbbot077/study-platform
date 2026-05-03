"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import { apiFetch, getDisplayErrorMessage } from "../lib/api";

const publicRoutes = new Set(["/", "/login", "/signup"]);

const baseNavItems = [
  { href: "/subjects", label: "Dashboard" },
  { href: "/upload", label: "Upload" },
  { href: "/progress", label: "Progress" },
  { href: "/tutor", label: "Tutor" },
];

type CurrentUser = {
  id: number;
  username: string;
  email: string;
  is_staff?: boolean;
  is_superuser?: boolean;
};

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function AppShellContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const isTutorFocusMode =
    pathname === "/tutor" && searchParams.get("focus") === "1";
  const navItems = useMemo(() => {
    if (currentUser?.is_staff) {
      return [...baseNavItems, { href: "/admin", label: "Admin" }];
    }
    return baseNavItems;
  }, [currentUser]);

  useEffect(() => {
    if (publicRoutes.has(pathname)) {
      return;
    }

    let cancelled = false;

    async function loadCurrentUser() {
      try {
        const result = await apiFetch("/api/accounts/me/");
        if (!cancelled) {
          setCurrentUser(result?.user || null);
        }
      } catch (error) {
        console.error(error);
      }
    }

    loadCurrentUser();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  async function handleLogout() {
    try {
      setLoggingOut(true);
      setLogoutError("");
      await apiFetch("/api/accounts/logout/", { method: "POST" });
      sessionStorage.removeItem("refreshProgress");
      sessionStorage.removeItem("lastStudiedConcept");
      setCurrentUser(null);
      router.push("/login");
      router.refresh();
    } catch (error) {
      console.error(error);
      setLogoutError(
        getDisplayErrorMessage(
          error,
          "We could not log you out just now. Please try again."
        )
      );
    } finally {
      setLoggingOut(false);
    }
  }

  if (publicRoutes.has(pathname)) {
    return (
      <div className="min-h-screen bg-[#f6f1e6]">
        <header className="border-b border-[#d0a95b]/20 bg-[rgba(255,248,236,0.92)] backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
            <Link href="/" className="text-lg font-bold tracking-tight text-[#fbf7ee]">
              Abbot Study
            </Link>

            <nav className="flex items-center gap-2 sm:gap-3">
              {pathname !== "/login" && (
                <Link
                  href="/login"
                  className="rounded-xl border border-[#7a6332] bg-[#162a5f] px-3 py-2 text-sm font-medium text-[#f7e6b4] transition hover:bg-[#20397d]"
                >
                  Log in
                </Link>
              )}
              {pathname !== "/signup" && (
                <Link
                  href="/signup"
                  className="rounded-xl bg-[#d4ae63] px-3 py-2 text-sm font-medium text-[#162a5f] transition hover:bg-[#e6c27b]"
                >
                  Create account
                </Link>
              )}
            </nav>
          </div>
        </header>

        {children}
      </div>
    );
  }

  if (isTutorFocusMode) {
    return <div className="min-h-screen bg-[#f6f1e6]">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-[#f6f1e6]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-[#d0a95b]/20 bg-[linear-gradient(180deg,_rgba(17,37,83,0.98)_0%,_rgba(12,25,56,0.98)_100%)] md:flex md:flex-col">
        <div className="border-b border-[#d0a95b]/15 px-6 py-6">
          <Link href="/" className="block text-2xl font-bold tracking-tight text-[#fbf7ee]">
            Abbot Study
          </Link>
          <p className="mt-2 text-sm text-[#bfb5d5]">
            Your adaptive study workspace.
          </p>
        </div>

        <nav className="flex-1 space-y-2 px-4 py-6">
          {navItems.map((item) => {
            const active = isActivePath(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                  active
                    ? "bg-[#caa04f] text-[#20183b]"
                    : "text-[#ddd4ef] hover:bg-white/8"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[#d0a95b]/15 px-4 py-4">
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="w-full rounded-2xl border border-[#6d5b8d] bg-[#1b1530] px-4 py-3 text-sm font-semibold text-[#f2dfb0] transition hover:bg-[#251d43] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loggingOut ? "Logging out..." : "Log out"}
          </button>
          {logoutError && (
            <p className="mt-3 rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {logoutError}
            </p>
          )}
        </div>
      </aside>

      <div className="flex min-h-screen flex-col md:pl-72">
        <header className="fixed inset-x-0 top-0 z-30 border-b border-[#d0a95b]/20 bg-[rgba(255,248,236,0.95)] md:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-4">
            <Link href="/" className="text-lg font-bold tracking-tight text-[#fbf7ee]">
              Abbot Study
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="rounded-xl border border-[#6d5b8d] bg-[#162a5f] px-3 py-2 text-sm font-semibold text-[#f2dfb0] transition hover:bg-[#20397d] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loggingOut ? "Logging out..." : "Log out"}
            </button>
          </div>

          <nav className="flex gap-2 overflow-x-auto px-4 pb-4">
            {navItems.map((item) => {
              const active = isActivePath(pathname, item.href);
              return (
                <Link
                  key={item.href}
                href={item.href}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-[#caa04f] text-[#20183b]"
                    : "bg-[#162a5f]/10 text-[#1c2950]"
                }`}
              >
                {item.label}
                </Link>
              );
            })}
          </nav>

          {logoutError && (
            <div className="px-4 pb-4">
              <p className="rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {logoutError}
              </p>
            </div>
          )}
        </header>

        <div className="flex-1 bg-[#f6f1e6] pt-[7.5rem] md:pt-0">{children}</div>
      </div>
    </div>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#120f23]">{children}</div>}>
      <AppShellContent>{children}</AppShellContent>
    </Suspense>
  );
}
