"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

type NextStep = {
  name: string;
  action: string;
  reason: string;
};

type TutorResponse = {
  query: string;
  answer: string;
  focused_concept?: string | null;
  subject?: string | null;
  graph_context?: string | null;
  concept_switched?: boolean;
  previous_concept?: string | null;
  mastery_score?: number | null;
  session_type?: string;
  next_step?: NextStep | null;
};

type Subject = {
  id: number;
  name: string;
};

function MasteryBadge({ sessionType }: { sessionType?: string }) {
  if (!sessionType) return null;

  let classes =
    "inline-flex rounded-full px-3 py-1 text-xs font-semibold ";

  if (sessionType === "REMEDIATE") {
    classes += "bg-red-100 text-red-700";
  } else if (sessionType === "CHECK") {
    classes += "bg-yellow-100 text-yellow-700";
  } else if (sessionType === "REINFORCE") {
    classes += "bg-green-100 text-green-700";
  } else {
    classes += "bg-blue-100 text-blue-700";
  }

  return <span className={classes}>{sessionType}</span>;
}

function NextStepBadge({ action }: { action?: string }) {
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

function MasteryProgressBar({ score = 0 }: { score?: number | null }) {
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

export default function TutorPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedConcept = searchParams.get("concept") || "";

  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [focusedConcept, setFocusedConcept] = useState<string | null>(
    selectedConcept || null
  );
  const [masteryScore, setMasteryScore] = useState<number | null>(null);
  const [sessionType, setSessionType] = useState<string>("");
  const [nextStep, setNextStep] = useState<NextStep | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("");
  const [selectedSubjectName, setSelectedSubjectName] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [loadingSubjects, setLoadingSubjects] = useState(true);
  const [error, setError] = useState("");
  const [switchNotice, setSwitchNotice] = useState("");

  useEffect(() => {
    async function loadSubjects() {
      try {
        setLoadingSubjects(true);
        const data: Subject[] = await apiFetch("/api/uploads/subjects/");
        setSubjects(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingSubjects(false);
      }
    }

    loadSubjects();
  }, []);

  async function handleAsk() {
    if (!query.trim()) return;

    try {
      setLoading(true);
      setError("");

      const payload: Record<string, string | number | null> = {
        query,
        concept_name: focusedConcept || null,
        subject_id: selectedSubjectId ? Number(selectedSubjectId) : null,
      };

      const result: TutorResponse = await apiFetch("/api/tutor/ask/", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setAnswer(result.answer);
      setFocusedConcept(result.focused_concept || null);

      if (result.concept_switched && result.focused_concept) {
        const previous = result.previous_concept
          ? ` from ${result.previous_concept}`
          : "";
        setSwitchNotice(`Switched focus${previous} to ${result.focused_concept}.`);

        router.replace(`/tutor?concept=${encodeURIComponent(result.focused_concept)}`);
      } else {
        setSwitchNotice("");
      }

      setMasteryScore(
        typeof result.mastery_score === "number" ? result.mastery_score : null
      );
      setSessionType(result.session_type || "");
      setNextStep(result.next_step || null);
      setQuery("");

      const matchedSubject = subjects.find(
        (subject) => String(subject.id) === selectedSubjectId
      );
      setSelectedSubjectName(matchedSubject?.name || "");
    } catch (err) {
      console.error(err);
      setError("Tutor request failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleBackToProgress() {
    sessionStorage.setItem("refreshProgress", "true");

    if (focusedConcept) {
      sessionStorage.setItem("lastStudiedConcept", focusedConcept);
    }

    router.push("/progress");
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">AI Tutor</h1>
            <p className="mt-2 text-gray-600">
              Ask questions, get adaptive guidance, and build mastery.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/progress"
              className="inline-flex rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
            >
              Progress
            </Link>

            <button
              type="button"
              onClick={handleBackToProgress}
              className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700"
            >
              Back to Progress
            </button>
          </div>
        </div>
        {switchNotice && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-medium text-amber-800">{switchNotice}</p>
          </div>
        )}
        {focusedConcept && (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
            <p className="text-sm text-blue-700">Currently studying</p>
            <p className="mt-1 text-lg font-semibold text-blue-900">
              {focusedConcept}
            </p>
          </div>
        )}

        {selectedSubjectName && (
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
            <p className="text-sm text-indigo-700">Selected subject</p>
            <p className="mt-1 text-lg font-semibold text-indigo-900">
              {selectedSubjectName}
            </p>
          </div>
        )}

        {typeof masteryScore === "number" && (
          <div className="rounded-2xl border border-green-200 bg-green-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-green-700">Updated mastery</p>
                <p className="mt-1 text-lg font-semibold text-green-900">
                  {focusedConcept ? focusedConcept : "Current concept"}
                </p>
              </div>
              <MasteryBadge sessionType={sessionType} />
            </div>

            <div className="mt-4">
              <MasteryProgressBar score={masteryScore} />
            </div>

            <p className="mt-3 text-sm text-green-800">
              Your current mastery score is {masteryScore.toFixed(2)}.
            </p>
          </div>
        )}

        {nextStep && (
          <div className="rounded-2xl border border-purple-200 bg-purple-50 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-purple-700">Best next step</p>
                <h2 className="mt-1 text-xl font-bold text-purple-950">
                  {nextStep.name}
                </h2>
              </div>
              <NextStepBadge action={nextStep.action} />
            </div>

            <p className="mt-4 text-sm text-purple-900">{nextStep.reason}</p>

            <div className="mt-4">
              <button
                type="button"
                onClick={() =>
                  router.push(`/tutor?concept=${encodeURIComponent(nextStep.name)}`)
                }
                className="rounded-xl bg-purple-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-purple-800"
              >
                Study this next
              </button>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Subject
          </label>
          <select
            value={selectedSubjectId}
            onChange={(e) => setSelectedSubjectId(e.target.value)}
            className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none focus:border-gray-500"
          >
            <option value="">
              {loadingSubjects ? "Loading subjects..." : "All subjects"}
            </option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>

          <label className="mt-4 mb-2 block text-sm font-medium text-gray-700">
            Your question
          </label>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              selectedConcept
                ? `Ask something about ${selectedConcept}...`
                : "Ask any study question..."
            }
            rows={6}
            className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-500"
          />

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleAsk}
              disabled={loading}
              className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Thinking..." : "Ask tutor"}
            </button>
          </div>

          {error && (
            <p className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>

        {answer && (
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900">Tutor response</h2>
            <div className="mt-4 whitespace-pre-wrap text-gray-800">
              {answer}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}