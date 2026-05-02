"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { apiFetch, ensureCsrfCookie, getDisplayErrorMessage } from "../../lib/api";

type AuthResponse = {
  message: string;
  user?: {
    id: number;
    username: string;
    email: string;
  };
  error?: string;
};

export default function SignupPage() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    try {
      setLoading(true);
      setError("");

      await ensureCsrfCookie();

      const result: AuthResponse = await apiFetch("/api/accounts/signup/", {
        method: "POST",
        body: JSON.stringify({
          username,
          email,
          password,
          confirm_password: confirmPassword,
        }),
      });

      if (result?.user) {
        router.push("/subjects");
      } else {
        setError("Account creation failed.");
      }
    } catch (err) {
      console.error(err);
      setError(
        getDisplayErrorMessage(
          err,
          "Account creation failed. Please check your details and try again."
        )
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0f0b1c] px-6 py-16 text-[#fbf7ee]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(51,37,93,0.28),_transparent_26%),radial-gradient(circle_at_bottom_left,_rgba(202,160,79,0.16),_transparent_30%),radial-gradient(circle_at_top_left,_rgba(62,44,116,0.24),_transparent_30%)]" />
      <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:42px_42px]" />

      <div className="relative mx-auto grid min-h-[calc(100vh-8rem)] max-w-6xl items-center gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(420px,0.9fr)]">
        <section className="max-w-2xl">
          <div className="inline-flex rounded-full border border-[#caa04f]/40 bg-[#1c1533]/92 px-4 py-2 text-sm font-semibold uppercase tracking-[0.18em] text-[#d8b66d]">
            Join Abbot Study
          </div>

          <h1 className="mt-7 text-5xl font-semibold leading-tight tracking-tight text-[#fbf7ee]">
            Build a study system that turns your materials into guided learning.
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-8 text-[#cec5e1]">
            Create your account, build subjects from your own books and notes, and
            move through syllabus topics with a tutor that keeps the lesson on track.
          </p>

          <div className="mt-10 space-y-4">
            <div className="rounded-3xl border border-[#d0a95b]/18 bg-[linear-gradient(180deg,_rgba(34,25,58,0.92)_0%,_rgba(22,17,36,0.96)_100%)] p-5 shadow-sm backdrop-blur-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#d8b66d]">
                Subject-led learning
              </p>
              <p className="mt-3 text-sm leading-6 text-[#d6cde8]">
                Create a subject, upload documents, open its progress page, and
                start the tutor from the syllabus itself.
              </p>
            </div>

            <div className="rounded-3xl border border-[#d0a95b]/18 bg-[linear-gradient(180deg,_rgba(34,25,58,0.92)_0%,_rgba(22,17,36,0.96)_100%)] p-5 shadow-sm backdrop-blur-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#d8b66d]">
                Directional tutoring
              </p>
              <p className="mt-3 text-sm leading-6 text-[#d6cde8]">
                The tutor leads the lesson forward while still saving continuity,
                checkpoints, and mastery signals.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-[#d0a95b]/18 bg-[#19142d]/92 p-8 shadow-[0_25px_80px_rgba(0,0,0,0.28)] backdrop-blur-sm sm:p-10">
          <div className="rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,_rgba(29,22,53,0.95)_0%,_rgba(19,14,34,0.98)_100%)] p-6 sm:p-8">
            <h2 className="text-3xl font-bold text-[#fbf7ee]">Sign up</h2>
            <p className="mt-2 text-sm text-[#c5bbd9]">
              Start building your personalized study system.
            </p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              <div>
                <label className="mb-2 block text-sm font-medium text-[#e0d7ef]">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-2xl border border-[#5c4c7b] bg-[#140f26] px-4 py-3 text-sm text-[#fbf7ee] outline-none transition focus:border-[#d0a95b] focus:ring-2 focus:ring-[#e5c982]/25"
                  placeholder="Choose a username"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e0d7ef]">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-2xl border border-[#5c4c7b] bg-[#140f26] px-4 py-3 text-sm text-[#fbf7ee] outline-none transition focus:border-[#d0a95b] focus:ring-2 focus:ring-[#e5c982]/25"
                  placeholder="Enter your email"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e0d7ef]">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-2xl border border-[#5c4c7b] bg-[#140f26] px-4 py-3 text-sm text-[#fbf7ee] outline-none transition focus:border-[#d0a95b] focus:ring-2 focus:ring-[#e5c982]/25"
                  placeholder="Create a password"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e0d7ef]">
                  Confirm password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-2xl border border-[#5c4c7b] bg-[#140f26] px-4 py-3 text-sm text-[#fbf7ee] outline-none transition focus:border-[#d0a95b] focus:ring-2 focus:ring-[#e5c982]/25"
                  placeholder="Re-enter your password"
                  required
                />
              </div>

              {error && (
                <p className="rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-2xl bg-[#20183b] px-4 py-3 text-sm font-semibold text-[#f6e7be] transition hover:bg-[#2a214c] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Creating account..." : "Create account"}
              </button>
            </form>

            <p className="mt-6 text-sm text-[#c5bbd9]">
              Already have an account?{" "}
              <Link href="/login" className="font-semibold text-[#ddb86c] underline">
                Log in
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
