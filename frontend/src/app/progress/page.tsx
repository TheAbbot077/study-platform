"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, getDisplayErrorMessage } from "../../lib/api";

type ProgressSummary = {
  total_concepts: number;
  mastered: number;
  in_progress: number;
  struggling: number;
  average_mastery: number;
  strongest_concept: string | null;
  weakest_concept: string | null;
  recent_activity: RecentActivityItem[];
};

type RecentActivityItem = {
  concept_name: string;
  event_type: string;
  score_after: number;
  created_at: string;
};

type ReinforcementItem = {
  concept_id: number;
  concept_name: string;
  subject_id?: number | null;
  mastery_score: number;
  mastery_percent: number;
  practice_count: number;
  last_practiced: string | null;
  days_since_practice: number;
  priority: "urgent" | "soon" | "refresh" | "stable";
  action: string;
  reason: string;
  review_reason: string;
  suggested_interval_days: number;
  due_status: "due_now" | "due_soon" | "scheduled";
  is_due: boolean;
  days_until_due: number;
  next_review_at: string;
  prerequisites: string[];
};

type ReinforcementResponse = {
  next_target: ReinforcementItem | null;
  recommended_concepts?: ReinforcementItem[];
  plan: {
    count: number;
    items: ReinforcementItem[];
  };
};

type Subject = {
  id: number;
  name: string;
  created_at: string;
};

type SubjectTopic = {
  id: number;
  name: string;
  description: string;
  node_type: "CHAPTER" | "CONCEPT" | "SUBTOPIC";
  parent_id?: number | null;
  child_ids: number[];
  subject_id: number;
  order_index: number;
  difficulty_stage?: "FOUNDATION" | "CORE" | "ADVANCED";
  mastery_score?: number | null;
  practice_count: number;
  is_started: boolean;
  prerequisites: string[];
  blocked_by: string[];
  is_locked: boolean;
};

type TopicTreeNode = SubjectTopic & {
  children: TopicTreeNode[];
};

function SummaryCard({
  title,
  value,
}: {
  title: string;
  value: number | string;
}) {
  return (
    <div className="rounded-[1.6rem] border border-white/10 bg-white/5 p-5 shadow-[0_12px_35px_rgba(0,0,0,0.18)] backdrop-blur-sm">
      <div className="text-sm text-[#a79dbf]">{title}</div>
      <div className="mt-2 text-3xl font-bold text-[#fbf7ee]">{value}</div>
    </div>
  );
}

function PriorityBadge({ priority }: { priority?: ReinforcementItem["priority"] }) {
  if (!priority) return null;

  let classes =
    "inline-flex rounded-full px-3 py-1 text-xs font-semibold ";

  if (priority === "urgent") {
    classes += "bg-red-100 text-red-700";
  } else if (priority === "soon") {
    classes += "bg-yellow-100 text-yellow-700";
  } else if (priority === "refresh") {
    classes += "bg-blue-100 text-blue-700";
  } else {
    classes += "bg-gray-100 text-gray-700";
  }

  return <span className={classes}>{priority.toUpperCase()}</span>;
}

function ActionBadge({ action }: { action?: string }) {
  if (!action) return null;

  const normalized = action.toLowerCase();

  let classes =
    "inline-flex rounded-full px-3 py-1 text-xs font-semibold ";

  if (normalized === "remediate") {
    classes += "bg-red-100 text-red-700";
  } else if (normalized === "review") {
    classes += "bg-yellow-100 text-yellow-700";
  } else if (normalized === "refresh") {
    classes += "bg-blue-100 text-blue-700";
  } else if (normalized === "maintain") {
    classes += "bg-green-100 text-green-700";
  } else {
    classes += "bg-gray-100 text-gray-700";
  }

  return <span className={classes}>{action}</span>;
}

function DueBadge({ status }: { status: ReinforcementItem["due_status"] }) {
  let classes =
    "inline-flex rounded-full px-3 py-1 text-xs font-semibold ";

  if (status === "due_now") {
    classes += "bg-red-100 text-red-700";
  } else if (status === "due_soon") {
    classes += "bg-amber-100 text-amber-700";
  } else {
    classes += "bg-sky-100 text-sky-700";
  }

  const label =
    status === "due_now"
      ? "DUE NOW"
      : status === "due_soon"
      ? "DUE SOON"
      : "SCHEDULED";

  return <span className={classes}>{label}</span>;
}

function ProgressBar({ score = 0 }: { score?: number | null }) {
  const safeScore = typeof score === "number" ? score : 0;
  const percentage = Math.max(0, Math.min(100, Math.round(safeScore * 100)));

  let barColor = "from-emerald-400 to-emerald-500";

  if (percentage < 35) {
    barColor = "from-rose-400 to-rose-500";
  } else if (percentage < 60) {
    barColor = "from-amber-400 to-amber-500";
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-[#9e94b7]">
        <span>Mastery</span>
        <span>{percentage}%</span>
      </div>
      <div className="h-3 w-full rounded-full bg-[#2c2640]">
        <div
          className={`h-3 rounded-full bg-gradient-to-r transition-all ${barColor}`}
          style={{ width: `${Math.max(percentage, 4)}%` }}
        />
      </div>
    </div>
  );
}

function StudyNowButton({
  conceptName,
  subjectId,
  disabled = false,
}: {
  conceptName: string;
  subjectId?: number | null;
  disabled?: boolean;
}) {
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={disabled}
      className="rounded-xl bg-[#caa04f] px-4 py-2 text-sm font-medium text-[#20183b] transition hover:bg-[#e0b86a] disabled:cursor-not-allowed disabled:opacity-50"
      onClick={() => {
        const params = new URLSearchParams({
          concept: conceptName,
          autoStart: "true",
        });

        if (subjectId) {
          params.set("subject", String(subjectId));
        }

        router.push(`/tutor?${params.toString()}`);
      }}
    >
      {disabled ? "Locked" : "Study now"}
    </button>
  );
}

function BestNextReviewCard({ item }: { item: ReinforcementItem }) {
  return (
    <div className="rounded-[1.8rem] border border-[#d0a95b]/25 bg-[linear-gradient(180deg,_rgba(31,58,46,0.92)_0%,_rgba(17,37,31,0.94)_100%)] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="max-w-3xl">
          <p className="text-sm font-medium text-[#a7d8b8]">Best next review</p>
          <h2 className="mt-1 text-2xl font-bold text-[#f5f7ef]">
            {item.concept_name}
          </h2>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <PriorityBadge priority={item.priority} />
            <ActionBadge action={item.action} />
            <DueBadge status={item.due_status} />
          </div>

          <div className="mt-4 max-w-md">
            <ProgressBar score={item.mastery_score} />
          </div>

          <p className="mt-4 text-sm text-[#d5eadc]">{item.reason}</p>
          <p className="mt-2 text-sm text-[#bfe0c9]">{item.review_reason}</p>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-white/10 px-4 py-3">
              <p className="text-xs text-[#a7d8b8]">Practice count</p>
              <p className="mt-1 font-semibold text-[#f5f7ef]">
                {item.practice_count}
              </p>
            </div>
            <div className="rounded-xl bg-white/10 px-4 py-3">
              <p className="text-xs text-[#a7d8b8]">Days since practice</p>
              <p className="mt-1 font-semibold text-[#f5f7ef]">
                {item.days_since_practice}
              </p>
            </div>
            <div className="rounded-xl bg-white/10 px-4 py-3">
              <p className="text-xs text-[#a7d8b8]">Next review</p>
              <p className="mt-1 font-semibold text-[#f5f7ef]">
                {item.is_due
                  ? "Ready now"
                  : `${item.days_until_due} day${item.days_until_due === 1 ? "" : "s"}`}
              </p>
            </div>
          </div>

          {item.prerequisites.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium text-[#d5eadc]">
                Helpful prerequisites:
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {item.prerequisites.map((prereq) => (
                  <span
                    key={prereq}
                    className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-[#f5f7ef]"
                  >
                    {prereq}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0">
          <StudyNowButton conceptName={item.concept_name} subjectId={item.subject_id} />
        </div>
      </div>
    </div>
  );
}

function ReinforcementCard({ item }: { item: ReinforcementItem }) {
  return (
    <div className="rounded-[1.6rem] border border-white/10 bg-white/5 p-4 shadow-[0_12px_35px_rgba(0,0,0,0.18)] backdrop-blur-sm">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold text-[#fbf7ee]">{item.concept_name}</h3>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <PriorityBadge priority={item.priority} />
          <ActionBadge action={item.action} />
          <DueBadge status={item.due_status} />
        </div>
      </div>

      <div className="mt-4">
        <ProgressBar score={item.mastery_score} />
        <p className="mt-2 text-sm text-[#a79dbf]">
          Mastery score: {item.mastery_score.toFixed(2)}
        </p>
      </div>

      <p className="mt-4 text-sm text-[#d3cae5]">{item.reason}</p>
      <p className="mt-2 text-sm text-[#b5abc9]">{item.review_reason}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-[#201939] px-4 py-3 text-sm text-[#d3cae5]">
          <span className="font-medium">Practice count:</span> {item.practice_count}
        </div>
        <div className="rounded-xl bg-[#201939] px-4 py-3 text-sm text-[#d3cae5]">
          <span className="font-medium">Next review:</span>{" "}
          {item.is_due
            ? "Ready now"
            : `${item.days_until_due} day${item.days_until_due === 1 ? "" : "s"}`}
        </div>
      </div>

      {item.prerequisites.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-medium text-[#d3cae5]">
            Helpful prerequisites:
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {item.prerequisites.map((prereq) => (
              <span
                key={prereq}
                className="rounded-full bg-[#201939] px-3 py-1 text-xs font-medium text-[#d3cae5]"
              >
                {prereq}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4">
        <StudyNowButton conceptName={item.concept_name} subjectId={item.subject_id} />
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#6b5b88] bg-white/5 p-6 text-sm text-[#b7aecb] shadow-sm">
      {text}
    </div>
  );
}

function buildTopicTree(topics: SubjectTopic[]) {
  const nodeMap = new Map<number, TopicTreeNode>();

  topics.forEach((topic) => {
    nodeMap.set(topic.id, { ...topic, children: [] });
  });

  const roots: TopicTreeNode[] = [];

  nodeMap.forEach((node) => {
    if (node.parent_id && nodeMap.has(node.parent_id)) {
      nodeMap.get(node.parent_id)?.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortNodes = (nodes: TopicTreeNode[]) => {
    nodes.sort((a, b) => a.order_index - b.order_index || a.name.localeCompare(b.name));
    nodes.forEach((node) => sortNodes(node.children));
  };

  sortNodes(roots);
  return roots;
}

function TopicRailProgress({ score }: { score?: number | null }) {
  const percentage = Math.max(
    0,
    Math.min(100, Math.round((typeof score === "number" ? score : 0) * 100))
  );

  let barColor = "bg-green-500";
  if (percentage < 35) {
    barColor = "bg-red-500";
  } else if (percentage < 70) {
    barColor = "bg-amber-500";
  }

  return (
    <div className="mt-2">
      <div className="h-2 w-full rounded-full bg-gray-200">
        <div
          className={`h-2 rounded-full ${barColor}`}
          style={{ width: `${Math.max(percentage, 4)}%` }}
        />
      </div>
      <div className="mt-1 text-xs text-gray-500">{percentage}% mastery</div>
    </div>
  );
}

function SyllabusTopicCard({
  topic,
  subjectId,
  depth = 0,
}: {
  topic: TopicTreeNode;
  subjectId: number;
  depth?: number;
}) {
  const router = useRouter();
  const isTeachable = topic.children.length === 0;

  const typeLabel =
    topic.node_type === "CHAPTER"
      ? "Chapter"
      : topic.node_type === "CONCEPT"
      ? "Concept"
      : "Topic";

  return (
    <div
      className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-[0_10px_28px_rgba(0,0,0,0.16)] backdrop-blur-sm"
      style={{ marginLeft: depth > 0 ? `${depth * 16}px` : undefined }}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[#221b3d] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#d9b86e]">
              {typeLabel}
            </span>
            {topic.difficulty_stage && (
              <span className="rounded-full bg-sky-500/15 px-3 py-1 text-xs font-semibold text-sky-200">
                {topic.difficulty_stage}
              </span>
            )}
            {topic.is_locked && (
              <span className="rounded-full bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-200">
                Locked
              </span>
            )}
          </div>

          <h3 className="mt-3 text-lg font-semibold text-[#fbf7ee]">{topic.name}</h3>
          {topic.description && (
            <p className="mt-2 text-sm leading-6 text-[#c6bdd9]">{topic.description}</p>
          )}

          <TopicRailProgress score={topic.mastery_score} />

          {topic.blocked_by.length > 0 && (
            <p className="mt-3 text-sm text-red-200">
              Complete first: {topic.blocked_by.join(", ")}
            </p>
          )}
        </div>

        <div className="shrink-0">
          {isTeachable ? (
            <StudyNowButton
              conceptName={topic.name}
              subjectId={subjectId}
              disabled={topic.is_locked}
            />
          ) : (
            <button
              type="button"
              onClick={() =>
                router.push(
                  `/tutor?subject=${subjectId}&concept=${encodeURIComponent(
                    topic.name
                  )}&autoStart=true`
                )
              }
              disabled={topic.is_locked}
              className="rounded-xl border border-[#6d5b8d] bg-[#1b1530] px-4 py-2 text-sm font-medium text-[#f2dfb0] transition hover:bg-[#251d43] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Open in tutor
            </button>
          )}
        </div>
      </div>

      {topic.children.length > 0 && (
        <div className="mt-4 space-y-3">
          {topic.children.map((child) => (
            <SyllabusTopicCard
              key={child.id}
              topic={child}
              subjectId={subjectId}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function formatEventLabel(eventType: string) {
  if (eventType === "concept_check") return "Concept check";
  if (eventType === "teach") return "Tutor lesson";
  if (eventType === "reinforcement") return "Reinforcement";
  if (eventType === "remediation") return "Remediation";
  return "Learning activity";
}

function ProgressPageContent() {
  const searchParams = useSearchParams();
  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  const [reinforcement, setReinforcement] = useState<ReinforcementResponse | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectTopics, setSubjectTopics] = useState<SubjectTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [lastStudiedConcept, setLastStudiedConcept] = useState("");
  const selectedSubjectId = Number(searchParams.get("subject") || "");
  const hasSelectedSubject = Number.isFinite(selectedSubjectId) && selectedSubjectId > 0;

  const loadProgress = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      setError("");

      const [summaryData, reinforcementData] = await Promise.all([
        apiFetch("/api/learning/progress/"),
        apiFetch("/api/learning/reinforcement/"),
      ]);

      setSummary(summaryData);
      setReinforcement(reinforcementData);

      const subjectList = await apiFetch("/api/uploads/subjects/");
      const safeSubjects = Array.isArray(subjectList) ? subjectList : [];
      setSubjects(safeSubjects);

      if (hasSelectedSubject) {
        const topicData = await apiFetch(
          `/api/knowledge/concepts/?subject=${selectedSubjectId}`
        );
        setSubjectTopics(Array.isArray(topicData) ? topicData : []);
      } else {
        setSubjectTopics([]);
      }
    } catch (err) {
      console.error(err);
      setError(
        getDisplayErrorMessage(
          err,
          "Failed to load learning progress. Please refresh and try again."
        )
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hasSelectedSubject, selectedSubjectId]);

  const syncStudyStateFromSession = useCallback(() => {
    const shouldRefresh = sessionStorage.getItem("refreshProgress");
    const storedConcept = sessionStorage.getItem("lastStudiedConcept");

    if (storedConcept) {
      setLastStudiedConcept(storedConcept);
    } else {
      setLastStudiedConcept("");
    }

    if (shouldRefresh === "true") {
      sessionStorage.removeItem("refreshProgress");
      loadProgress(false);
    }
  }, [loadProgress]);

  useEffect(() => {
    loadProgress(true);
  }, [loadProgress]);

  useEffect(() => {
    syncStudyStateFromSession();

    function handleFocus() {
      syncStudyStateFromSession();
    }

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [syncStudyStateFromSession]);

  const filteredPlanItems = useMemo(() => {
    const items =
      reinforcement?.plan?.items ??
      reinforcement?.recommended_concepts ??
      [];
    const subjectFiltered = hasSelectedSubject
      ? items.filter((item) => item.subject_id === selectedSubjectId)
      : items;
    return subjectFiltered.filter((item) =>
      item.concept_name.toLowerCase().includes(search.toLowerCase())
    );
  }, [hasSelectedSubject, reinforcement, search, selectedSubjectId]);

  const selectedSubject = useMemo(
    () => subjects.find((subject) => subject.id === selectedSubjectId) ?? null,
    [selectedSubjectId, subjects]
  );

  const syllabusTree = useMemo(() => buildTopicTree(subjectTopics), [subjectTopics]);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#120f23] p-6 text-[#fbf7ee]">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-3xl font-bold text-[#fbf7ee]">
            {hasSelectedSubject ? "Subject Progress" : "Learning Progress"}
          </h1>
          <p className="mt-2 text-[#c6bdd9]">Loading progress dashboard...</p>
        </div>
      </main>
    );
  }

  if (error || !summary || !reinforcement) {
    return (
      <main className="min-h-screen bg-[#120f23] p-6 text-[#fbf7ee]">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-3xl font-bold text-[#fbf7ee]">
            {hasSelectedSubject ? "Subject Progress" : "Learning Progress"}
          </h1>
          <p className="mt-4 rounded-xl border border-red-300/20 bg-red-500/10 p-4 text-red-200">
            {error || "Something went wrong."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#120f23] px-4 py-4 text-[#fbf7ee] sm:p-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(214,169,78,0.16),_transparent_24%),radial-gradient(circle_at_bottom_right,_rgba(82,59,142,0.28),_transparent_32%)]" />
      <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:42px_42px]" />
      <div className="relative mx-auto max-w-6xl space-y-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#ddb86c]">
              {selectedSubject ? "Subject Progress" : "Learning Progress"}
            </p>
            <h1 className="mt-2 text-3xl font-bold text-[#fbf7ee]">
              {selectedSubject
                ? `${selectedSubject.name} Progress`
                : "My Learning Progress"}
            </h1>
            <p className="mt-2 text-[#c6bdd9]">
              {selectedSubject
                ? "Follow the syllabus topics for this subject, then open any topic in the tutor."
                : "Track your mastery and see what to reinforce next."}
            </p>

            {refreshing && (
              <p className="mt-3 rounded-xl border border-sky-300/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
                Refreshing your latest learning progress...
              </p>
            )}

            {lastStudiedConcept && !refreshing && (
              <p className="mt-3 rounded-xl border border-emerald-300/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                Last studied concept:{" "}
                <span className="font-semibold">{lastStudiedConcept}</span>
              </p>
            )}
          </div>

          <div className="w-full md:max-w-sm">
            <label className="mb-2 block text-sm font-medium text-[#d6cde7]">
              {selectedSubject ? "Search this subject" : "Search reinforcement concepts"}
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search concepts..."
              className="w-full rounded-xl border border-[#564775] bg-[#17122b] px-4 py-3 text-sm text-[#fbf7ee] outline-none ring-0 placeholder:text-[#7d7498] focus:border-[#d0a95b]"
            />
          </div>
        </div>

        {selectedSubject && (
          <section className="rounded-[1.85rem] border border-[#d0a95b]/20 bg-[#19142d]/92 p-6 shadow-[0_24px_70px_rgba(0,0,0,0.3)] backdrop-blur-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#dcb86e]">
                  Subject syllabus
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-[#fbf7ee]">
                  {selectedSubject.name}
                </h2>
                <p className="mt-2 text-sm text-[#c6bdd9]">
                  Open the topics below in order. Clicking a teachable topic sends
                  you straight into the tutor for that part of the syllabus.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  href={`/upload?subject=${selectedSubject.id}`}
                  className="rounded-xl border border-[#6d5b8d] bg-[#1b1530] px-4 py-2 text-sm font-semibold text-[#f2dfb0] transition hover:bg-[#251d43]"
                >
                  Upload materials
                </Link>
                <Link
                  href="/subjects"
                  className="rounded-xl bg-[#caa04f] px-4 py-2 text-sm font-semibold text-[#20183b] transition hover:bg-[#e0b86a]"
                >
                  Back to dashboard
                </Link>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              {syllabusTree.length === 0 ? (
                <EmptyState text="No syllabus topics are ready for this subject yet. Upload or rebuild the subject documents first." />
              ) : (
                syllabusTree.map((topic) => (
                  <SyllabusTopicCard
                    key={topic.id}
                    topic={topic}
                    subjectId={selectedSubject.id}
                  />
                ))
              )}
            </div>
          </section>
        )}

        {!selectedSubject && reinforcement.next_target && (
          <section>
            <BestNextReviewCard item={reinforcement.next_target} />
          </section>
        )}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard title="Total Concepts" value={summary.total_concepts} />
          <SummaryCard title="Mastered" value={summary.mastered} />
          <SummaryCard title="In Progress" value={summary.in_progress} />
          <SummaryCard title="Struggling" value={summary.struggling} />
        </section>

        <section className="rounded-[1.85rem] border border-white/10 bg-white/5 p-6 shadow-[0_18px_48px_rgba(0,0,0,0.22)] backdrop-blur-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="w-full max-w-3xl">
              <h2 className="text-2xl font-semibold text-[#fbf7ee]">
                Average Mastery
              </h2>
              <p className="mt-2 text-sm text-[#c6bdd9]">
                Overall learning strength across all tracked concepts.
              </p>

              <div className="mt-5">
                <ProgressBar score={summary.average_mastery} />
              </div>

              <p className="mt-3 text-sm text-[#d5cce7]">
                Average mastery:{" "}
                <span className="font-semibold">
                  {Math.round(summary.average_mastery * 100)}%
                </span>
              </p>
            </div>

            <div className="grid w-full gap-3 md:max-w-sm">
              <div className="rounded-xl bg-[#201939] p-4">
                <p className="text-sm text-[#a79dbf]">Strongest concept</p>
                <p className="mt-1 font-semibold text-[#fbf7ee]">
                  {summary.strongest_concept || "Not enough data yet"}
                </p>
              </div>

              <div className="rounded-xl bg-[#201939] p-4">
                <p className="text-sm text-[#a79dbf]">Weakest concept</p>
                <p className="mt-1 font-semibold text-[#fbf7ee]">
                  {summary.weakest_concept || "Not enough data yet"}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[1.85rem] border border-white/10 bg-white/5 p-6 shadow-[0_18px_48px_rgba(0,0,0,0.22)] backdrop-blur-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-[#fbf7ee]">
                Recent Learning Activity
              </h2>
              <p className="mt-2 text-sm text-[#c6bdd9]">
                A quick view of the latest concept work the system recorded.
              </p>
            </div>
            <span className="text-sm text-[#a79dbf]">
              {summary.recent_activity.length} recent item
              {summary.recent_activity.length === 1 ? "" : "s"}
            </span>
          </div>

          {summary.recent_activity.length === 0 ? (
            <div className="mt-5">
              <EmptyState text="No recent learning activity yet. Study a concept to start building history." />
            </div>
          ) : (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {summary.recent_activity.map((item) => (
                <div
                  key={`${item.concept_name}-${item.created_at}-${item.event_type}`}
                  className="rounded-2xl border border-white/10 bg-[#1b1530] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-[#d7b66d]">
                        {formatEventLabel(item.event_type)}
                      </p>
                      <h3 className="mt-1 text-lg font-semibold text-[#fbf7ee]">
                        {item.concept_name}
                      </h3>
                    </div>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-[#d4cbe6]">
                      {Math.round(item.score_after * 100)}%
                    </span>
                  </div>

                  <p className="mt-3 text-sm text-[#b7aecb]">
                    Recorded {new Date(item.created_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-2xl font-semibold text-[#fbf7ee]">
              Reinforcement Queue
            </h2>
            <span className="text-sm text-[#a79dbf]">
              {filteredPlanItems.length} shown
            </span>
          </div>

          {filteredPlanItems.length === 0 ? (
            <EmptyState text="No reinforcement items match your search yet." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredPlanItems.map((item) => (
                <ReinforcementCard key={item.concept_id} item={item} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default function ProgressPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-gray-50 p-6" />}>
      <ProgressPageContent />
    </Suspense>
  );
}
