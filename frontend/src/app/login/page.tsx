"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { apiFetch, ensureCsrfCookie } from "../../lib/api";

type AuthResponse = {
  message: string;
  user?: {
    id: number;
    username: string;
    email: string;
  };
  error?: string;
};

export default function LoginPage() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    try {
      setLoading(true);
      setError("");

      await ensureCsrfCookie();

      const result: AuthResponse = await apiFetch("/api/accounts/login/", {
        method: "POST",
        body: JSON.stringify({
          username,
          password,
        }),
      });

        if (result?.user) {
            router.push("/subjects");
        } else {
        setError("Login failed.");
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-16">
      <div className="mx-auto max-w-md">
        <div className="rounded-3xl border border-gray-200 bg-white p-8 shadow-sm">
          <h1 className="text-3xl font-bold text-gray-900">Log in</h1>
          <p className="mt-2 text-sm text-gray-600">
            Continue your study journey.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none focus:border-gray-500"
                placeholder="Enter your username"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none focus:border-gray-500"
                placeholder="Enter your password"
                required
              />
            </div>

            {error && (
              <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Logging in..." : "Log in"}
            </button>
          </form>

          <p className="mt-6 text-sm text-gray-600">
            Need an account?{" "}
            <Link href="/signup" className="font-semibold text-gray-900 underline">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}