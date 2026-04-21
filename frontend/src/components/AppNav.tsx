"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, ensureCsrfCookie } from "../lib/api";

export default function AppNav() {
  const router = useRouter();

  async function handleLogout() {
    try {
      await ensureCsrfCookie();
      await apiFetch("/api/accounts/logout/", {
        method: "POST",
        body: JSON.stringify({}),
      });
      router.push("/login");
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-bold text-gray-900">
          Study Platform
        </Link>

        <div className="flex items-center gap-3">
          <Link
            href="/upload"
            className="rounded-xl px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
          >
            Upload
          </Link>
          <Link
            href="/tutor"
            className="rounded-xl px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
          >
            Tutor
          </Link>
          <Link
            href="/progress"
            className="rounded-xl px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
          >
            Progress
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-700"
          >
            Log out
          </button>
        </div>
      </div>
    </nav>
  );
}