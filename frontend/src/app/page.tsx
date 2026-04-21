"use client";

import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gray-50">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-6 py-16">
        <div className="max-w-3xl">
          <div className="inline-flex rounded-full bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700">
            AI-powered study platform
          </div>

          <h1 className="mt-6 text-5xl font-bold tracking-tight text-gray-900">
            Learn from your own study materials with an adaptive AI tutor
          </h1>

          <p className="mt-6 text-lg leading-8 text-gray-600">
            Upload study documents, organize subjects, build mastery over concepts,
            and get guided tutoring that adapts to your progress.
          </p>

          <div className="mt-8 flex flex-wrap gap-4">
            <Link
              href="/signup"
              className="rounded-2xl bg-gray-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-gray-700"
            >
              Create account
            </Link>

            <Link
              href="/login"
              className="rounded-2xl border border-gray-300 bg-white px-6 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-100"
            >
              Log in
            </Link>

            <Link
              href="/upload"
              className="rounded-2xl border border-gray-300 bg-white px-6 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-100"
            >
              Upload study file
            </Link>

            <Link
              href="/progress"
              className="rounded-2xl border border-gray-300 bg-white px-6 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-100"
            >
              Open dashboard
            </Link>
          </div>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900">Upload materials</h2>
            <p className="mt-3 text-sm leading-6 text-gray-600">
              Add PDFs and study files so the platform can build learning context
              from your own content.
            </p>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900">Study intelligently</h2>
            <p className="mt-3 text-sm leading-6 text-gray-600">
              Ask questions, get adaptive tutoring, and receive concept checks that
              match your current level.
            </p>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900">Track mastery</h2>
            <p className="mt-3 text-sm leading-6 text-gray-600">
              See what to study next, unlock new concepts, and monitor your progress
              over time.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}