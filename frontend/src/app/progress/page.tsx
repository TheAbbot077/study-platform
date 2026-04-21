"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";

type ProgressSummary = {
  total_concepts: number;
  unlocked_concepts: number;
  locked_concepts: number;
  mastered_concepts: number;
};

type BlockedByItem = {
  id: number;
  name: string;
  score: number;
  mastery_label: string;
};

type ConceptItem = {
  id: number;
  name: string;
  mastery_score?: number;
  mastery_label?: string;
  blocked_by?: BlockedByItem[];
  action?: string;
  reason?: string;
  practice_count?: number;
  is_unlocked?: boolean;
};

type SubjectDocument = {
  id: number;
  title: string;
  status: string;
  created_at: string;
};

type SubjectItem = {
  id: number;
  name: string;
  document_count: number;
  average_mastery?: number | null;
  documents: SubjectDocument[];
};

type StudiedConceptItem = {
  id: number;
  name: string;
  mastery_score: number;
  practice_count: number;
  last_practiced?: string | null;
};

type OverallStats = {
  total_subjects: number;
  total_documents: number;
  total_concepts_studied: number;
};

type ProgressResponse = {
  summary: ProgressSummary;
  overall: OverallStats;
  subjects: SubjectItem[];
  studied_concepts: StudiedConceptItem[];
  recommended_concepts: ConceptItem[];
  top_recommendation?: ConceptItem | null;
  message?: string;
};

function SummaryCard({
  title,
  value,
}: {
  title: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="text-sm text-gray-500">{title}</div>
      <div className="mt-2 text-3xl font-bold text-gray-900">{value}</div>
    </div>
  );
}

function MasteryBadge({ label }: { label?: string }) {
  if (!label) return null;

  let classes =
    "inline-flex rounded-full px-3 py-1 text-xs font-semibold ";

  if (label === "Beginner") {
    classes += "bg-red-100 text-red-700";
  } else if (label === "Developing") {
    classes += "bg-yellow-100 text-yellow-700";
  } else if (label === "Strong") {
    classes += "bg-blue-100 text-blue-700";
  } else {
    classes += "bg-green-100 text-green-700";
  }

  return <span className={classes}>{label}</span>;
}

function ActionBadge({ action }: { action?: string }) {
  if (!action) return null;

  const normalized = action.toLowerCase();

  let classes =
    "inline-flex rounded-full px-3 py-1 text-xs font-semibold ";

  if (normalized === "remediate") {
    classes += "bg-red-100 text-red-700";
  } else if (normalized === "reinforce") {
    classes += "bg-yellow-100 text-yellow-700";
  } else if (normalized === "advance") {
    classes += "bg-green-100 text-green-700";
  } else {
    classes += "bg-blue-100 text-blue-700";
  }

  return <span className={classes}>{action}</span>;
}

function ProgressBar({ score = 0 }: { score?: number | null }) {
  const safeScore = typeof score === "number" ? score : 0;
  const percentage = Math.max(0, Math.min(100, Math.round(safeScore * 100)));

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
        <span>Mastery</span>
        <span>{percentage}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-200">
        <div
          className="h-2 rounded-full bg-gray-900 transition-all"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function StudyNowButton({
  conceptName,
  disabled = false,
}: {
  conceptName: string;
  disabled?: boolean;
}) {
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={disabled}
      className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
      onClick={() => {
        router.push(`/tutor?concept=${encodeURIComponent(conceptName)}`);
      }}
    >
      {disabled ? "Locked" : "Study now"}
    </button>
  );
}

function BestNextStepCard({ concept }: { concept: ConceptItem }) {
  return (
    <div className="rounded-2xl border border-green-200 bg-green-50 p-6 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="max-w-3xl">
          <p className="text-sm font-medium text-green-700">Best next step</p>
          <h2 className="mt-1 text-2xl font-bold text-green-950">{concept.name}</h2>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ActionBadge action={concept.action} />
            <MasteryBadge label={concept.mastery_label} />
          </div>

          {typeof concept.mastery_score === "number" && (
            <div className="mt-4 max-w-md">
              <ProgressBar score={concept.mastery_score} />
            </div>
          )}

          {concept.reason && (
            <p className="mt-4 text-sm text-green-900">{concept.reason}</p>
          )}

          {typeof concept.practice_count === "number" && (
            <p className="mt-3 text-sm text-green-800">
              Practice count: <span className="font-semibold">{concept.practice_count}</span>
            </p>
          )}

          {concept.blocked_by && concept.blocked_by.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium text-green-900">
                Strengthen these first:
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {concept.blocked_by.map((item) => (
                  <span
                    key={item.id}
                    className="rounded-full bg-white px-3 py-1 text-xs font-medium text-green-900"
                  >
                    {item.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0">
          <StudyNowButton
            conceptName={concept.name}
            disabled={concept.is_unlocked === false}
          />
        </div>
      </div>
    </div>
  );
}

function RecommendationCard({ concept }: { concept: ConceptItem }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold text-gray-900">{concept.name}</h3>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ActionBadge action={concept.action} />
          <MasteryBadge label={concept.mastery_label} />
        </div>
      </div>

      {typeof concept.mastery_score === "number" && (
        <div className="mt-4">
          <ProgressBar score={concept.mastery_score} />
          <p className="mt-2 text-sm text-gray-600">
            Mastery score: {concept.mastery_score.toFixed(2)}
          </p>
        </div>
      )}

      {concept.reason && (
        <p className="mt-4 text-sm text-gray-700">{concept.reason}</p>
      )}

      {typeof concept.practice_count === "number" && (
        <p className="mt-3 text-sm text-gray-500">
          Practice count: {concept.practice_count}
        </p>
      )}

      {concept.blocked_by && concept.blocked_by.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-medium text-gray-700">
            Prerequisites to strengthen:
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {concept.blocked_by.map((item) => (
              <span
                key={item.id}
                className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700"
              >
                {item.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4">
        <StudyNowButton
          conceptName={concept.name}
          disabled={concept.is_unlocked === false}
        />
      </div>
    </div>
  );
}

function SubjectCard({ subject }: { subject: SubjectItem }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{subject.name}</h3>
          <p className="mt-1 text-sm text-gray-500">
            {subject.document_count} document{subject.document_count === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {typeof subject.average_mastery === "number" && (
        <div className="mt-4">
          <ProgressBar score={subject.average_mastery} />
          <p className="mt-2 text-sm text-gray-600">
            Average mastery: {subject.average_mastery.toFixed(2)}
          </p>
        </div>
      )}

      <div className="mt-4">
        <p className="text-sm font-medium text-gray-700">Documents</p>
        {subject.documents.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No documents uploaded yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {subject.documents.map((doc) => (
              <div
                key={doc.id}
                className="rounded-xl bg-gray-50 px-3 py-3 text-sm text-gray-700"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{doc.title}</span>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-gray-600">
                    {doc.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StudiedConceptCard({ concept }: { concept: StudiedConceptItem }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold text-gray-900">{concept.name}</h3>
      </div>

      <div className="mt-4">
        <ProgressBar score={concept.mastery_score} />
        <p className="mt-2 text-sm text-gray-600">
          Mastery score: {concept.mastery_score.toFixed(2)}
        </p>
      </div>

      <p className="mt-3 text-sm text-gray-500">
        Practice count: {concept.practice_count}
      </p>

      <div className="mt-4">
        <StudyNowButton conceptName={concept.name} />
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-500 shadow-sm">
      {text}
    </div>
  );
}

export default function ProgressPage() {
  const [data, setData] = useState<ProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [lastStudiedConcept, setLastStudiedConcept] = useState("");

  const loadProgress = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      setError("");
      const result = await apiFetch("/api/learning/progress/");
      setData(result);
    } catch (err) {
      console.error(err);
      setError("Failed to load learning progress.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadProgress(true);
  }, [loadProgress]);

  useEffect(() => {
    const shouldRefresh = sessionStorage.getItem("refreshProgress");
    const storedConcept = sessionStorage.getItem("lastStudiedConcept");

    if (storedConcept) {
      setLastStudiedConcept(storedConcept);
    }

    if (shouldRefresh === "true") {
      loadProgress(false);
      sessionStorage.removeItem("refreshProgress");
    }
  }, [loadProgress]);

  const filteredRecommended = useMemo(() => {
    if (!data) return [];
    return data.recommended_concepts.filter((concept) =>
      concept.name.toLowerCase().includes(search.toLowerCase())
    );
  }, [data, search]);

  const filteredStudiedConcepts = useMemo(() => {
    if (!data) return [];
    return data.studied_concepts.filter((concept) =>
      concept.name.toLowerCase().includes(search.toLowerCase())
    );
  }, [data, search]);

  const filteredSubjects = useMemo(() => {
    if (!data) return [];
    return data.subjects.filter((subject) =>
      subject.name.toLowerCase().includes(search.toLowerCase())
    );
  }, [data, search]);

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-3xl font-bold text-gray-900">Learning Progress</h1>
          <p className="mt-2 text-gray-600">Loading progress dashboard...</p>
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-3xl font-bold text-gray-900">Learning Progress</h1>
          <p className="mt-4 rounded-xl bg-red-50 p-4 text-red-700">
            {error || "Something went wrong."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">My Learning Progress</h1>
            <p className="mt-2 text-gray-600">
              Track your own subjects, materials, studied concepts, and next best steps.
            </p>

            {refreshing && (
              <p className="mt-3 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-800">
                Refreshing your latest learning progress...
              </p>
            )}

            {lastStudiedConcept && !refreshing && (
              <p className="mt-3 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-800">
                Last studied concept: <span className="font-semibold">{lastStudiedConcept}</span>
              </p>
            )}

            {data.message && (
              <p className="mt-3 rounded-xl bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
                {data.message}
              </p>
            )}
          </div>

          <div className="w-full md:max-w-sm">
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Search subjects or concepts
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your studies..."
              className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none ring-0 placeholder:text-gray-400 focus:border-gray-500"
            />
          </div>
        </div>

        {data.top_recommendation && (
          <section>
            <BestNextStepCard concept={data.top_recommendation} />
          </section>
        )}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard title="My Subjects" value={data.overall.total_subjects} />
          <SummaryCard title="My Documents" value={data.overall.total_documents} />
          <SummaryCard
            title="Concepts Studied"
            value={data.overall.total_concepts_studied}
          />
          <SummaryCard title="Mastered Concepts" value={data.summary.mastered_concepts} />
        </section>

        <section>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold text-gray-900">My Subjects</h2>
            <span className="text-sm text-gray-500">
              {filteredSubjects.length} shown
            </span>
          </div>

          {filteredSubjects.length === 0 ? (
            <EmptyState text="No subjects match your search yet." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredSubjects.map((subject) => (
                <SubjectCard key={subject.id} subject={subject} />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold text-gray-900">
              Personalized Recommendations
            </h2>
            <span className="text-sm text-gray-500">
              {filteredRecommended.length} shown
            </span>
          </div>

          {filteredRecommended.length === 0 ? (
            <EmptyState text="No recommendations match your search yet." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredRecommended.map((concept) => (
                <RecommendationCard key={concept.id} concept={concept} />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold text-gray-900">Studied Concepts</h2>
            <span className="text-sm text-gray-500">
              {filteredStudiedConcepts.length} shown
            </span>
          </div>

          {filteredStudiedConcepts.length === 0 ? (
            <EmptyState text="You have not studied any concepts yet." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredStudiedConcepts.map((concept) => (
                <StudiedConceptCard key={concept.id} concept={concept} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}