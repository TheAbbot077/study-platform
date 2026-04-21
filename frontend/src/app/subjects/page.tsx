"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch, ensureCsrfCookie } from "../../lib/api";

type Subject = {
  id: number;
  name: string;
  created_at: string;
};

export default function SubjectsPage() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function loadSubjects() {
    try {
      setLoading(true);
      setError("");
      const result = await apiFetch("/api/uploads/subjects/");
      setSubjects(Array.isArray(result) ? result : []);
    } catch (err) {
      console.error(err);
      setError("Failed to load subjects.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSubjects();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();

    if (!name.trim()) return;

    try {
      setCreating(true);
      setError("");
      await ensureCsrfCookie();

      await apiFetch("/api/uploads/subjects/", {
        method: "POST",
        body: JSON.stringify({ name }),
      });

      setName("");
      await loadSubjects();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to create subject.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-16">
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Subjects</h1>
            <p className="mt-2 text-sm text-gray-600">
              Organize your study materials by subject.
            </p>
          </div>

          <Link
            href="/upload"
            className="rounded-2xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-700"
          >
            Upload document
          </Link>
        </div>

        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900">Create subject</h2>

          <form onSubmit={handleCreate} className="mt-5 flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Biology"
              className="flex-1 rounded-2xl border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none focus:border-gray-500"
            />

            <button
              type="submit"
              disabled={creating}
              className="rounded-2xl bg-gray-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-gray-700 disabled:opacity-60"
            >
              {creating ? "Creating..." : "Create"}
            </button>
          </form>

          {error && (
            <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>

        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900">Your subjects</h2>

          {loading ? (
            <p className="mt-4 text-sm text-gray-600">Loading subjects...</p>
          ) : subjects.length === 0 ? (
            <p className="mt-4 text-sm text-gray-600">
              No subjects yet. Create one to organize your study materials.
            </p>
          ) : (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {subjects.map((subject) => (
                <div
                  key={subject.id}
                  className="rounded-2xl border border-gray-200 bg-gray-50 p-4"
                >
                  <h3 className="text-lg font-semibold text-gray-900">{subject.name}</h3>
                  <p className="mt-2 text-sm text-gray-500">
                    Ready for uploads and tutoring
                  </p>
                  <div className="mt-4 flex gap-3">
                    <Link
                      href={`/upload?subject=${subject.id}`}
                      className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-700"
                    >
                      Upload here
                    </Link>
                    <Link
                      href="/progress"
                      className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100"
                    >
                      Progress
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}