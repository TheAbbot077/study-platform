"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  apiFetch,
  ensureCsrfCookie,
  getDisplayErrorMessage,
} from "../../lib/api";

type Subject = {
  id: number;
  name: string;
  created_at: string;
};

type TopicItem = {
  id: number;
  name: string;
  node_type: "CHAPTER" | "CONCEPT" | "SUBTOPIC";
  child_ids: number[];
  mastery_score?: number | null;
  is_started: boolean;
};

type SubjectProgress = {
  totalLeafTopics: number;
  startedLeafTopics: number;
  completedLeafTopics: number;
  averageMastery: number;
};

function SubjectProgressBar({ value }: { value: number }) {
  const percentage = Math.max(0, Math.min(100, Math.round(value * 100)));

  let barColor = "from-emerald-400 to-emerald-500";
  if (percentage < 35) {
    barColor = "from-rose-400 to-rose-500";
  } else if (percentage < 70) {
    barColor = "from-amber-400 to-amber-500";
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs font-medium text-[#8e84a6]">
        <span>How far along you are</span>
        <span>{percentage}%</span>
      </div>
      <div className="h-3 w-full rounded-full bg-[#2d2643] shadow-inner">
        <div
          className={`h-3 rounded-full bg-gradient-to-r ${barColor} transition-all duration-500`}
          style={{ width: `${Math.max(percentage, 4)}%` }}
        />
      </div>
    </div>
  );
}

function getSubjectProgress(topics: TopicItem[]): SubjectProgress {
  const leafTopics = topics.filter((topic) => topic.child_ids.length === 0);
  const totalLeafTopics = leafTopics.length;

  if (totalLeafTopics === 0) {
    return {
      totalLeafTopics: 0,
      startedLeafTopics: 0,
      completedLeafTopics: 0,
      averageMastery: 0,
    };
  }

  const startedLeafTopics = leafTopics.filter((topic) => topic.is_started).length;
  const completedLeafTopics = leafTopics.filter(
    (topic) => (topic.mastery_score ?? 0) >= 0.8
  ).length;
  const averageMastery =
    leafTopics.reduce((sum, topic) => sum + (topic.mastery_score ?? 0), 0) /
    totalLeafTopics;

  return {
    totalLeafTopics,
    startedLeafTopics,
    completedLeafTopics,
    averageMastery,
  };
}

export default function SubjectsPage() {
  const router = useRouter();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectProgress, setSubjectProgress] = useState<
    Record<number, SubjectProgress>
  >({});
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingSubjectId, setDeletingSubjectId] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function loadSubjects() {
    try {
      setLoading(true);
      setError("");
      const result = await apiFetch("/api/uploads/subjects/");
      const subjectList = Array.isArray(result) ? result : [];
      setSubjects(subjectList);

      const progressEntries = await Promise.all(
        subjectList.map(async (subject: Subject) => {
          try {
            const topics = await apiFetch(
              `/api/knowledge/concepts/?subject=${subject.id}`
            );
            return [
              subject.id,
              getSubjectProgress(Array.isArray(topics) ? topics : []),
            ] as const;
          } catch {
            return [
              subject.id,
              {
                totalLeafTopics: 0,
                startedLeafTopics: 0,
                completedLeafTopics: 0,
                averageMastery: 0,
              },
            ] as const;
          }
        })
      );

      setSubjectProgress(Object.fromEntries(progressEntries));
    } catch (err) {
      console.error(err);
      setError(
        getDisplayErrorMessage(
          err,
          "Failed to load your dashboard. Please refresh and try again."
        )
      );
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
      setError(
        getDisplayErrorMessage(
          err,
          "We could not create that subject just now. Please try again."
        )
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteSubject(subject: Subject) {
    const confirmed = window.confirm(
      `Delete "${subject.name}" and all of its uploaded materials? This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      setDeletingSubjectId(subject.id);
      setError("");
      await ensureCsrfCookie();
      await apiFetch(`/api/uploads/subjects/${subject.id}/`, {
        method: "DELETE",
      });
      await loadSubjects();
    } catch (err) {
      console.error(err);
      setError(
        getDisplayErrorMessage(
          err,
          "We could not delete that subject just now. Please try again."
        )
      );
    } finally {
      setDeletingSubjectId(null);
    }
  }

  const totalSubjects = subjects.length;
  const activeSubjects = useMemo(
    () =>
      subjects.filter((subject) => {
        const progress = subjectProgress[subject.id];
        return (progress?.startedLeafTopics ?? 0) > 0;
      }).length,
    [subjectProgress, subjects]
  );

  const masteredTopics = useMemo(
    () =>
      Object.values(subjectProgress).reduce(
        (sum, progress) => sum + progress.completedLeafTopics,
        0
      ),
    [subjectProgress]
  );

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f6f1e6] px-4 py-6 text-[#162a5f] sm:px-6 sm:py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(214,169,78,0.18),_transparent_24%),radial-gradient(circle_at_bottom_right,_rgba(70,92,155,0.12),_transparent_34%)]" />
      <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(22,42,95,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(22,42,95,0.05)_1px,transparent_1px)] [background-size:42px_42px]" />

      <div className="relative mx-auto max-w-7xl space-y-8">
        <section className="overflow-hidden rounded-[2rem] border border-[#d0a95b]/30 bg-[linear-gradient(180deg,_rgba(255,252,246,0.96)_0%,_rgba(246,239,224,0.98)_100%)] shadow-[0_30px_90px_rgba(16,34,80,0.12)] backdrop-blur-sm">
          <div className="grid gap-8 px-6 py-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)] lg:px-8">
            <div>
              <div className="inline-flex rounded-full border border-[#d0a95b]/35 bg-[#231a3d] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#e5c57d]">
                Student Dashboard
              </div>
              <h1 className="mt-5 max-w-4xl text-4xl font-semibold tracking-tight text-[#162a5f] sm:text-5xl">
                Your private study library, organized by subject and ready to teach forward.
              </h1>
              <p className="mt-5 max-w-3xl text-sm leading-7 text-[#5a6783] sm:text-base">
                Create a subject, upload the materials that belong to it, and open
                the subject to move through its syllabus in order. Every subject
                card below shows how far along you are.
              </p>

              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                <div className="rounded-3xl border border-[#d9ceb8] bg-white/85 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#ddb86c]">
                    Subjects
                  </p>
                  <p className="mt-3 text-3xl font-bold text-[#162a5f]">
                    {totalSubjects}
                  </p>
                  <p className="mt-2 text-sm text-[#66738e]">
                    Total subject spaces created
                  </p>
                </div>

                <div className="rounded-3xl border border-[#d9ceb8] bg-white/85 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#ddb86c]">
                    Active
                  </p>
                  <p className="mt-3 text-3xl font-bold text-[#162a5f]">
                    {activeSubjects}
                  </p>
                  <p className="mt-2 text-sm text-[#66738e]">
                    Subjects already in motion
                  </p>
                </div>

                <div className="rounded-3xl border border-[#d9ceb8] bg-white/85 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#ddb86c]">
                    Mastered
                  </p>
                  <p className="mt-3 text-3xl font-bold text-[#162a5f]">
                    {masteredTopics}
                  </p>
                  <p className="mt-2 text-sm text-[#66738e]">
                    Teachable topics completed
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-[#d0a95b]/20 bg-[linear-gradient(180deg,_rgba(23,41,92,0.96)_0%,_rgba(17,31,72,0.98)_100%)] p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d8b66d]">
                Learning flow
              </p>
              <ol className="mt-5 space-y-4 text-sm text-[#d0c7e3]">
                <li className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  1. Create a subject for the course or book you want to study.
                </li>
                <li className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  2. Upload the materials that belong to that subject.
                </li>
                <li className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  3. Open the subject progress page to see the syllabus and topic order.
                </li>
                <li className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  4. Click a topic to continue the tutor exactly where that lesson should begin.
                </li>
              </ol>
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(340px,0.95fr)]">
          <section className="rounded-[2rem] border border-[#d0a95b]/24 bg-white/88 p-6 shadow-[0_24px_70px_rgba(16,34,80,0.12)] backdrop-blur-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#ddb86c]">
                  Subject collection
                </p>
                <h2 className="mt-3 text-2xl font-semibold text-[#162a5f]">
                  Open a subject to continue studying
                </h2>
                <p className="mt-2 text-sm text-[#5f6d87]">
                  Each subject opens into a syllabus view, where the learner clicks
                  topics and enters the tutor from the correct place.
                </p>
              </div>
            </div>

            {loading ? (
              <p className="mt-6 text-sm text-[#5f6d87]">Loading subjects...</p>
            ) : subjects.length === 0 ? (
              <div className="mt-6 rounded-3xl border border-dashed border-[#c9b27b] bg-[#fffaf0] px-5 py-6 text-sm text-[#5f6d87]">
                No subjects yet. Use the panel on the right to create your first
                one and begin building your study library.
              </div>
            ) : (
              <div className="mt-6 grid gap-4">
                {subjects.map((subject) => {
                  const progress = subjectProgress[subject.id] ?? {
                    totalLeafTopics: 0,
                    startedLeafTopics: 0,
                    completedLeafTopics: 0,
                    averageMastery: 0,
                  };

                  return (
                    <Link
                      key={subject.id}
                      href={`/progress?subject=${subject.id}`}
                      className="group rounded-[1.75rem] border border-[#ddd2bf] bg-[linear-gradient(180deg,_rgba(255,255,255,0.94)_0%,_rgba(248,243,233,0.98)_100%)] p-5 transition hover:border-[#d0a95b]/40 hover:bg-[linear-gradient(180deg,_rgba(255,255,255,0.98)_0%,_rgba(244,238,225,0.98)_100%)]"
                    >
                      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-4">
                            <h3 className="text-xl font-semibold text-[#162a5f]">
                              {subject.name}
                            </h3>
                            <span className="text-sm font-medium text-[#9d7b39] transition group-hover:text-[#b88f42]">
                              Open syllabus →
                            </span>
                          </div>

                          <p className="mt-2 text-sm text-[#5f6d87]">
                            {progress.totalLeafTopics > 0
                              ? `${progress.completedLeafTopics} of ${progress.totalLeafTopics} teachable topics mastered`
                              : "Ready for uploads and syllabus building"}
                          </p>

                          <div className="mt-4">
                            <SubjectProgressBar value={progress.averageMastery} />
                          </div>
                        </div>

                        <div className="grid shrink-0 gap-3 sm:grid-cols-3 lg:w-[290px] lg:grid-cols-1">
                          <div className="rounded-2xl border border-[#dfd4c0] bg-white/90 px-4 py-3">
                            <p className="text-xs uppercase tracking-[0.14em] text-[#8e84a6]">
                              Topics
                            </p>
                              <p className="mt-2 text-lg font-semibold text-[#162a5f]">
                              {progress.totalLeafTopics}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-[#dfd4c0] bg-white/90 px-4 py-3">
                            <p className="text-xs uppercase tracking-[0.14em] text-[#8e84a6]">
                              Started
                            </p>
                              <p className="mt-2 text-lg font-semibold text-[#162a5f]">
                              {progress.startedLeafTopics}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-[#dfd4c0] bg-white/90 px-4 py-3">
                            <p className="text-xs uppercase tracking-[0.14em] text-[#8e84a6]">
                              Mastered
                            </p>
                              <p className="mt-2 text-lg font-semibold text-[#162a5f]">
                              {progress.completedLeafTopics}
                            </p>
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="rounded-[2rem] border border-[#d0a95b]/24 bg-white/88 p-6 shadow-[0_24px_70px_rgba(16,34,80,0.12)] backdrop-blur-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#ddb86c]">
              New subject
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-[#162a5f]">
              Create a subject space
            </h2>
            <p className="mt-2 text-sm text-[#5f6d87]">
              Start with the course name, textbook, or unit you want to turn into a
              guided learning track.
            </p>

            <form onSubmit={handleCreate} className="mt-6 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-[#d4cbe5]">
                  Subject name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. AP Biology"
                  className="w-full rounded-2xl border border-[#d9ceb8] bg-white px-4 py-3 text-sm text-[#162a5f] outline-none transition placeholder:text-[#8d8ba0] focus:border-[#d0a95b] focus:ring-2 focus:ring-[#d0a95b]/25"
                />
              </div>

              <button
                type="submit"
                disabled={creating}
                className="w-full rounded-2xl bg-[#caa04f] px-5 py-3 text-sm font-semibold text-[#211937] transition hover:bg-[#e0b86a] disabled:opacity-60"
              >
                {creating ? "Creating..." : "Create subject"}
              </button>
            </form>

            {error && (
              <p className="mt-4 rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </p>
            )}

            <div className="mt-6 rounded-[1.6rem] border border-[#ddd2bf] bg-[#fffaf0] p-5">
              <p className="text-sm font-medium text-[#f7e8bf]">What happens next</p>
              <div className="mt-4 space-y-3 text-sm text-[#c9c0dc]">
                <p className="rounded-2xl border border-[#e1d6c0] bg-white px-4 py-3">
                  Upload the book or notes that belong to this subject.
                </p>
                <p className="rounded-2xl border border-[#e1d6c0] bg-white px-4 py-3">
                  Rebuild the syllabus if you want the latest extraction logic.
                </p>
                <p className="rounded-2xl border border-[#e1d6c0] bg-white px-4 py-3">
                  Open the subject progress page and click directly into a topic.
                </p>
              </div>
            </div>

            {subjects.length > 0 && (
              <div className="mt-6 rounded-[1.6rem] border border-[#ddd2bf] bg-[#fffaf0] p-5">
                <p className="text-sm font-medium text-[#f7e8bf]">Manage subjects</p>
                <div className="mt-4 space-y-3">
                  {subjects.map((subject) => (
                    <div
                      key={`manage-${subject.id}`}
                      className="rounded-2xl border border-[#e1d6c0] bg-white px-4 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-[#162a5f]">
                          {subject.name}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => router.push(`/progress?subject=${subject.id}`)}
                            className="rounded-xl bg-[#caa04f] px-3 py-2 text-xs font-semibold text-[#20183b] transition hover:bg-[#ddb86c]"
                          >
                            Open
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSubject(subject)}
                            disabled={deletingSubjectId === subject.id}
                            className="rounded-xl border border-red-300/20 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {deletingSubjectId === subject.id
                              ? "Deleting..."
                              : "Delete"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
