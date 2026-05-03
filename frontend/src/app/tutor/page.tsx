"use client";

export const dynamic = "force-dynamic";

import katex from "katex";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, getDisplayErrorMessage } from "../../lib/api";

type NextStep = {
  name: string;
  subject_id?: number | null;
  action: string;
  reason: string;
};

type TutorResponse = {
  query: string;
  answer: string;
  focused_concept?: string | null;
  subject_id?: number | null;
  subject?: string | null;
  graph_context?: string | null;
  concept_switched?: boolean;
  previous_concept?: string | null;
  mastery_score?: number | null;
  session_type?: string;
  next_step?: NextStep | null;
  next_action_prompt?: string | null;
  next_action_type?: "advance" | "respond" | null;
};

type TutorHistoryMessage = {
  id: number;
  role: "system" | "user" | "assistant";
  content: string;
  is_checkpoint?: boolean;
  created_at: string;
};

type TutorHistoryResponse = {
  concept_name: string;
  subject_id?: number | null;
  messages: TutorHistoryMessage[];
};

type TutorCheckpointResponse = {
  message_id: number;
  concept_name?: string | null;
  subject_id?: number | null;
  is_checkpoint?: boolean;
  messages?: TutorHistoryMessage[];
};

type Subject = {
  id: number;
  name: string;
};

type TopicItem = {
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

type TopicNode = TopicItem & {
  children: TopicNode[];
};

const TUTOR_PAGE_ZOOM_OPTIONS = [90, 100, 110, 125] as const;
const TUTOR_NAV_ITEMS = [
  { href: "/subjects", label: "Dashboard" },
  { href: "/upload", label: "Upload" },
  { href: "/progress", label: "Progress" },
  { href: "/tutor", label: "Tutor" },
] as const;

function getTutorPaperWidthClass(zoom: (typeof TUTOR_PAGE_ZOOM_OPTIONS)[number]) {
  if (zoom >= 125) {
    return "max-w-[980px]";
  }
  if (zoom >= 110) {
    return "max-w-[900px]";
  }
  if (zoom <= 90) {
    return "max-w-[720px]";
  }
  return "max-w-[794px]";
}

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

function TopicStateBadge({
  masteryScore,
  isStarted,
  isLocked,
}: {
  masteryScore?: number | null;
  isStarted: boolean;
  isLocked: boolean;
}) {
  let classes =
    "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ";
  let label = "Not started";

  if (isLocked) {
    classes += "bg-gray-200 text-gray-700";
    label = "Locked";
  } else if (!isStarted || masteryScore == null) {
    classes += "bg-red-100 text-red-700";
    label = "Not started";
  } else if (masteryScore >= 0.9) {
    classes += "bg-green-100 text-green-700";
    label = "Completed";
  } else if (masteryScore >= 0.7) {
    classes += "bg-blue-100 text-blue-700";
    label = "Strong";
  } else if (masteryScore >= 0.4) {
    classes += "bg-yellow-100 text-yellow-800";
    label = "In progress";
  } else {
    classes += "bg-red-100 text-red-700";
    label = "Needs work";
  }

  return <span className={classes}>{label}</span>;
}

function DifficultyStageBadge({
  stage,
}: {
  stage?: TopicItem["difficulty_stage"];
}) {
  if (!stage) return null;

  let classes =
    "inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ";

  if (stage === "FOUNDATION") {
    classes += "bg-emerald-100 text-emerald-800";
  } else if (stage === "CORE") {
    classes += "bg-sky-100 text-sky-800";
  } else {
    classes += "bg-violet-100 text-violet-800";
  }

  return <span className={classes}>{stage}</span>;
}

function MasteryProgressBar({ score = 0 }: { score?: number | null }) {
  const safeScore = typeof score === "number" ? score : 0;
  const percentage = Math.max(0, Math.min(100, Math.round(safeScore * 100)));

  let barColor = "bg-red-500";

  if (safeScore >= 0.9) {
    barColor = "bg-green-500";
  } else if (safeScore >= 0.7) {
    barColor = "bg-blue-500";
  } else if (safeScore >= 0.4) {
    barColor = "bg-yellow-500";
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
        <span>Mastery</span>
        <span>
          {percentage}%{" "}
          <span className="text-xs text-gray-400">
            {safeScore >= 0.9
              ? "Mastered"
              : safeScore >= 0.7
              ? "Strong"
              : safeScore >= 0.4
              ? "Developing"
              : "Needs work"}
          </span>
        </span>
      </div>
      <div className="h-3 rounded-full bg-gray-200 shadow-[0_0_8px_rgba(0,0,0,0.1)]">
        <div
          className={`h-3 rounded-full ${barColor} transition-all duration-500`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function TutorPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedConcept = searchParams.get("concept") || "";
  const selectedSubjectParam = searchParams.get("subject") || "";
  const autoStart = searchParams.get("autoStart") === "true";
  const isFocusMode = searchParams.get("focus") === "1";

  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [focusedConcept, setFocusedConcept] = useState<string | null>(
    selectedConcept || null
  );
  const [masteryScore, setMasteryScore] = useState<number | null>(null);
  const [sessionType, setSessionType] = useState<string>("");
  const [nextStep, setNextStep] = useState<NextStep | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [topics, setTopics] = useState<TopicItem[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(selectedSubjectParam);
  const [selectedSubjectName, setSelectedSubjectName] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [loadingSubjects, setLoadingSubjects] = useState(true);
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState("");
  const [topicsError, setTopicsError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [checkpointNotice, setCheckpointNotice] = useState("");
  const [switchNotice, setSwitchNotice] = useState("");
  const [logoutError, setLogoutError] = useState("");
  const [dataNextAction, setDataNextAction] = useState<string>("");
  const [dataNextActionType, setDataNextActionType] = useState<
    "advance" | "respond" | null
  >(null);
  const [conversationHistory, setConversationHistory] = useState<
    TutorHistoryMessage[]
  >([]);
  const [checkpointSavingId, setCheckpointSavingId] = useState<number | null>(null);
  const [checkpointResettingId, setCheckpointResettingId] = useState<number | null>(null);
  const [restartingConcept, setRestartingConcept] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [pageZoom, setPageZoom] =
    useState<(typeof TUTOR_PAGE_ZOOM_OPTIONS)[number]>(100);
  const autoStartedRef = useRef(false);

  const buildTutorUrl = useCallback(
    ({
      concept,
      subjectId,
      shouldAutoStart = false,
    }: {
      concept?: string | null;
      subjectId?: string | number | null;
      shouldAutoStart?: boolean;
    }) => {
      const params = new URLSearchParams();

      if (concept) {
        params.set("concept", concept);
      }

      if (subjectId) {
        params.set("subject", String(subjectId));
      }

      if (shouldAutoStart) {
        params.set("autoStart", "true");
      }

      const queryString = params.toString();
      return queryString ? `/tutor?${queryString}` : "/tutor";
    },
    []
  );

  useEffect(() => {
    autoStartedRef.current = false;
    setFocusedConcept(selectedConcept || null);
    setAnswer("");
    setError("");
    setSwitchNotice("");
    setDataNextAction("");
    setDataNextActionType(null);
    setMasteryScore(null);
    setSessionType("");
    setNextStep(null);
    setQuery("");
    setConversationHistory([]);
    setHistoryError("");
    setCheckpointNotice("");
  }, [selectedConcept]);

  useEffect(() => {
    setSelectedSubjectId(selectedSubjectParam);
  }, [selectedSubjectParam]);

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

  useEffect(() => {
    const matchedSubject = subjects.find(
      (subject) => String(subject.id) === selectedSubjectId
    );
    setSelectedSubjectName(matchedSubject?.name || "");
  }, [selectedSubjectId, subjects]);

  useEffect(() => {
    async function loadTopics() {
      if (!selectedSubjectId) {
        setTopics([]);
        setTopicsError("");
        return;
      }

      try {
        setLoadingTopics(true);
        setTopicsError("");
        const data = await apiFetch(
          `/api/knowledge/concepts/?subject=${encodeURIComponent(selectedSubjectId)}`
        );
        setTopics(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error(err);
        setTopics([]);
        setTopicsError(
          getDisplayErrorMessage(
            err,
            "Failed to load subject topics. Please try again."
          )
        );
      } finally {
        setLoadingTopics(false);
      }
    }

    loadTopics();
  }, [selectedSubjectId]);

  const loadConversationHistory = useCallback(
    async (conceptName: string, subjectId?: string | number | null) => {
      if (!conceptName) {
        setConversationHistory([]);
        setHistoryError("");
        return;
      }

      try {
        setLoadingHistory(true);
        setHistoryError("");

        const params = new URLSearchParams({ concept_name: conceptName });
        if (subjectId) {
          params.set("subject_id", String(subjectId));
        }

        const result: TutorHistoryResponse = await apiFetch(
          `/api/tutor/history/?${params.toString()}`
        );
        setConversationHistory(result.messages || []);
      } catch (err) {
        console.error(err);
        setConversationHistory([]);
        setHistoryError(
          getDisplayErrorMessage(
            err,
            "Failed to load prior concept conversation."
          )
        );
      } finally {
        setLoadingHistory(false);
      }
    },
    []
  );

  useEffect(() => {
    const conceptForHistory = selectedConcept || focusedConcept;

    if (!conceptForHistory) {
      setConversationHistory([]);
      setHistoryError("");
      return;
    }

    loadConversationHistory(conceptForHistory, selectedSubjectId);
  }, [focusedConcept, loadConversationHistory, selectedConcept, selectedSubjectId]);

  const sendTutorRequest = useCallback(async (requestQuery: string) => {
    try {
      setLoading(true);
      setError("");

      const payload: Record<string, string | number | null> = {
        query: requestQuery,
        concept_name: selectedConcept || focusedConcept || null,
        subject_id: selectedSubjectId ? Number(selectedSubjectId) : null,
      };

      const result: TutorResponse = await apiFetch("/api/tutor/ask/", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const activeSubjectId =
        typeof result.subject_id === "number"
          ? String(result.subject_id)
          : selectedSubjectId;

      if (activeSubjectId && activeSubjectId !== selectedSubjectId) {
        setSelectedSubjectId(activeSubjectId);
      }

      setAnswer(result.answer);
      setFocusedConcept(result.focused_concept || null);

      if (result.concept_switched && result.focused_concept) {
        const previous = result.previous_concept
          ? ` from ${result.previous_concept}`
          : "";
        setSwitchNotice(`Switched focus${previous} to ${result.focused_concept}.`);

        router.replace(
          buildTutorUrl({
            concept: result.focused_concept,
            subjectId: activeSubjectId,
          })
        );
      } else {
        setSwitchNotice("");
      }

      setMasteryScore(
        typeof result.mastery_score === "number" ? result.mastery_score : null
      );
      setSessionType(result.session_type || "");
      setNextStep(result.next_step || null);
      setDataNextAction(result.next_action_prompt || "");
      setDataNextActionType(result.next_action_type || null);
      setQuery("");

      const matchedSubject = subjects.find(
        (subject) => String(subject.id) === activeSubjectId
      );
      setSelectedSubjectName(matchedSubject?.name || "");

      if (result.focused_concept && activeSubjectId) {
        setTopics((currentTopics) =>
          currentTopics.map((topic) =>
            topic.name === result.focused_concept
              ? {
                  ...topic,
                  mastery_score:
                    typeof result.mastery_score === "number"
                      ? result.mastery_score
                      : topic.mastery_score,
                  is_started: true,
                  practice_count: Math.max(topic.practice_count, 1),
                }
              : topic
          )
        );
      }

      if (result.focused_concept) {
        await loadConversationHistory(result.focused_concept, activeSubjectId);
      }
    } catch (err) {
      console.error(err);
      setError(
        getDisplayErrorMessage(
          err,
          "The tutor could not respond just now. Please try again."
        )
      );
    } finally {
      setLoading(false);
    }
  }, [
    buildTutorUrl,
    focusedConcept,
    loadConversationHistory,
    router,
    selectedConcept,
    selectedSubjectId,
    subjects,
  ]);

  const handleSetCheckpoint = useCallback(
    async (messageId: number) => {
      try {
        setCheckpointSavingId(messageId);
        setHistoryError("");
        setCheckpointNotice("");

        await apiFetch("/api/tutor/checkpoint/", {
          method: "POST",
          body: JSON.stringify({ message_id: messageId }),
        });

        setConversationHistory((currentHistory) =>
          currentHistory.map((message) => ({
            ...message,
            is_checkpoint: message.id === messageId,
          }))
        );
        setCheckpointNotice(
          "Checkpoint saved. You can reset back to this point whenever the conversation stops making sense."
        );
      } catch (err) {
        console.error(err);
        setHistoryError(
          getDisplayErrorMessage(
            err,
            "Failed to save the tutor checkpoint."
          )
        );
      } finally {
        setCheckpointSavingId(null);
      }
    },
    []
  );

  const handleResetToCheckpoint = useCallback(
    async (messageId: number) => {
      try {
        setCheckpointResettingId(messageId);
        setHistoryError("");
        setCheckpointNotice("");
        setError("");

        const result: TutorCheckpointResponse = await apiFetch("/api/tutor/reset/", {
          method: "POST",
          body: JSON.stringify({ message_id: messageId }),
        });

        setConversationHistory(result.messages || []);
        setAnswer("");
        setDataNextAction("");
        setDataNextActionType(null);
        setNextStep(null);
        setCheckpointNotice(
          "Conversation reset to your saved checkpoint. You can continue again from the last point that felt clear."
        );
      } catch (err) {
        console.error(err);
        setHistoryError(
          getDisplayErrorMessage(
            err,
            "Failed to reset the conversation to the saved checkpoint."
          )
        );
      } finally {
        setCheckpointResettingId(null);
      }
    },
    []
  );

  const activeCheckpoint = conversationHistory.find(
    (message) => message.is_checkpoint
  );

  async function handleAsk() {
    if (!query.trim()) return;
    await sendTutorRequest(query);
  }

  async function handleAdvanceLesson() {
    await sendTutorRequest("__NEXT__");
  }

  async function handleRestartConcept() {
    const conceptToRestart = focusedConcept || selectedConcept;
    if (!conceptToRestart) return;

    const confirmed = window.confirm(
      `Restart ${conceptToRestart} from the beginning? This clears the saved tutor thread and progress for this concept.`
    );
    if (!confirmed) return;

    try {
      setRestartingConcept(true);
      setError("");
      setHistoryError("");
      setCheckpointNotice("");
      setSwitchNotice("");

      await apiFetch("/api/tutor/restart/", {
        method: "POST",
        body: JSON.stringify({
          concept_name: conceptToRestart,
          subject_id: selectedSubjectId ? Number(selectedSubjectId) : null,
        }),
      });

      setConversationHistory([]);
      setAnswer("");
      setMasteryScore(null);
      setSessionType("");
      setNextStep(null);
      setDataNextAction("");
      setDataNextActionType(null);
      setQuery("");
      setCheckpointNotice(
        `${conceptToRestart} has been restarted. The tutor is beginning again from the foundation.`
      );
      await sendTutorRequest("");
    } catch (err) {
      console.error(err);
      setError(
        getDisplayErrorMessage(
          err,
          "We could not restart this concept just now. Please try again."
        )
      );
    } finally {
      setRestartingConcept(false);
    }
  }

  useEffect(() => {
    if (!autoStart || !selectedConcept || autoStartedRef.current) {
      return;
    }

    autoStartedRef.current = true;
    sendTutorRequest("");
  }, [autoStart, selectedConcept, sendTutorRequest]);

  function handleBackToProgress() {
    sessionStorage.setItem("refreshProgress", "true");

    const conceptForProgress = focusedConcept || selectedConcept;

    if (conceptForProgress) {
      sessionStorage.setItem("lastStudiedConcept", conceptForProgress);
    }

    const progressUrl = selectedSubjectId
      ? `/progress?subject=${selectedSubjectId}`
      : "/progress";
    router.push(progressUrl);
  }

  async function handleLogout() {
    try {
      setLoggingOut(true);
      setLogoutError("");
      await apiFetch("/api/accounts/logout/", { method: "POST" });
      sessionStorage.removeItem("refreshProgress");
      sessionStorage.removeItem("lastStudiedConcept");
      router.push("/login");
      router.refresh();
    } catch (err) {
      console.error(err);
      setLogoutError(
        getDisplayErrorMessage(
          err,
          "We could not log you out just now. Please try again."
        )
      );
    } finally {
      setLoggingOut(false);
    }
  }

  function handleSubjectChange(nextSubjectId: string) {
    setSelectedSubjectId(nextSubjectId);
    router.replace(
      buildTutorUrl({
        subjectId: nextSubjectId || null,
      })
    );
  }

  const tutorUrlBase = buildTutorUrl({
    concept: focusedConcept || selectedConcept || null,
    subjectId: selectedSubjectId || null,
    shouldAutoStart: autoStart,
  });
  const focusModeUrl = `${tutorUrlBase}${tutorUrlBase.includes("?") ? "&" : "?"}focus=1`;
  const standardModeUrl = tutorUrlBase;
  const paperWidthClass = getTutorPaperWidthClass(pageZoom);
  const topicTree = buildTopicTree(topics);
  const shouldShowAdvanceButton =
    dataNextActionType === "advance" && Boolean(dataNextAction);
  const shouldShowComposer = dataNextActionType !== "advance";

  function renderTopicNode(topic: TopicNode, depth = 0) {
    const isActive = topic.name === focusedConcept;
    const isChapter = topic.node_type === "CHAPTER";
    const isConcept = topic.node_type === "CONCEPT";
    const indentClass =
      depth === 0 ? "" : depth === 1 ? "ml-3" : "ml-6";

    return (
      <div key={topic.id} className={`${indentClass} space-y-2`}>
        <button
          type="button"
          disabled={topic.is_locked}
          onClick={() =>
            router.push(
              buildTutorUrl({
                concept: topic.name,
                subjectId: topic.subject_id,
                shouldAutoStart: true,
              })
            )
          }
          className={`w-full rounded-2xl border p-4 text-left transition ${
            isActive
              ? "border-[#d7b56a]/55 bg-[linear-gradient(180deg,_rgba(214,169,78,0.16)_0%,_rgba(65,48,101,0.42)_100%)] shadow-[0_14px_34px_rgba(0,0,0,0.2)]"
              : topic.is_locked
              ? "cursor-not-allowed border-white/8 bg-white/[0.04] opacity-75"
              : isChapter
              ? "border-[#7a6a4f]/35 bg-[linear-gradient(180deg,_rgba(48,73,62,0.55)_0%,_rgba(22,32,29,0.72)_100%)] hover:border-[#d7b56a]/35"
              : isConcept
              ? "border-[#6d5b8d]/35 bg-[linear-gradient(180deg,_rgba(50,40,83,0.82)_0%,_rgba(29,23,50,0.94)_100%)] hover:border-[#caa04f]/35"
              : "border-white/8 bg-white/[0.03] hover:border-[#8f7baf]/35 hover:bg-white/[0.06]"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-[#fbf7ee]">{topic.name}</h3>
                <span className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#cbbfdf]">
                  {topic.node_type}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <DifficultyStageBadge stage={topic.difficulty_stage} />
                <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#9b90b5]">
                  {isChapter ? `Chapter ${topic.order_index + 1}` : `Item ${topic.order_index + 1}`}
                </span>
              </div>
              {topic.description && (
                <p className="mt-2 line-clamp-3 text-xs leading-5 text-[#c8bfd9]">
                  {topic.description}
                </p>
              )}
            </div>
            <TopicStateBadge
              masteryScore={topic.mastery_score}
              isStarted={topic.is_started}
              isLocked={topic.is_locked}
            />
          </div>

          {topic.blocked_by.length > 0 && (
            <p className="mt-3 text-xs text-[#f2d08a]">
              Blocked until: {topic.blocked_by.join(", ")}
            </p>
          )}

          {topic.children.length > 0 && (
            <p className="mt-3 text-xs text-[#a49ab9]">
              {topic.children.length} nested learning item
              {topic.children.length === 1 ? "" : "s"}
            </p>
          )}

          <div className="mt-3 flex items-center justify-between text-xs text-[#a49ab9]">
            <span>
              {topic.practice_count} practice
              {topic.practice_count === 1 ? "" : "s"}
            </span>
            <span>
              {typeof topic.mastery_score === "number"
                ? `${Math.round(topic.mastery_score * 100)}% mastery`
                : "0% mastery"}
            </span>
          </div>
        </button>

        {topic.children.length > 0 && (
          <div className="space-y-2">
            {topic.children.map((child) => renderTopicNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <main
      className={`relative min-h-screen overflow-hidden ${
        isFocusMode
          ? "bg-[#17122a] px-0 py-0 text-[#f9f4e8]"
          : "bg-[#f6f1e6] px-4 py-4 text-[#2b2140] sm:p-6"
      }`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(214,169,78,0.18),_transparent_24%),radial-gradient(circle_at_bottom_right,_rgba(82,59,142,0.16),_transparent_34%)]" />
      <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(53,41,83,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(53,41,83,0.05)_1px,transparent_1px)] [background-size:42px_42px]" />
      <div className={`mx-auto ${isFocusMode ? "max-w-none" : "max-w-7xl space-y-6"}`}>
        <div
          className={`sticky z-20 flex flex-col gap-4 border backdrop-blur-sm ${
            isFocusMode
              ? "top-0 border-x-0 border-t-0 border-b-[#d0a95b]/20 bg-[#18132d]/92 px-4 py-4 shadow-[0_24px_70px_rgba(0,0,0,0.28)] sm:px-6"
              : "top-[7.4rem] rounded-[1.8rem] border-[#d7c49b] bg-[rgba(255,250,241,0.94)] px-4 py-4 shadow-[0_24px_70px_rgba(46,30,80,0.16)] md:top-4 md:mx-auto sm:px-6"
          }`}
        >
          <div className="min-w-0">
            <h1
              className={`${isFocusMode ? "text-2xl text-[#fbf7ee]" : "text-3xl text-[#251a3e]"} font-bold`}
            >
              Abbot Study Tutor
            </h1>
            <div className="mt-3 flex flex-wrap gap-2">
              {TUTOR_NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-full px-3 py-1.5 text-center text-[11px] font-semibold uppercase tracking-[0.16em] transition sm:text-xs ${
                    isFocusMode
                      ? "border border-white/10 bg-white/[0.06] text-[#e7d5a0] hover:bg-white/[0.1]"
                      : "border border-[#d9c49b] bg-white/90 text-[#6d5424] hover:bg-[#fff7e7]"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
            {!isFocusMode && (
              <p className="mt-2 text-[#67557f]">
                Ask questions, get adaptive guidance, and build mastery.
              </p>
            )}
          </div>

          <div className="grid w-full gap-3 sm:grid-cols-2 xl:flex xl:w-auto xl:flex-wrap xl:justify-end xl:items-center">
            <div
              className={`flex items-center justify-between gap-2 rounded-2xl border px-3 py-2 sm:col-span-2 xl:col-span-1 xl:min-w-[10.5rem] ${
                isFocusMode
                  ? "border-[#d0a95b]/20 bg-white/[0.05]"
                  : "border-[#dccaa3] bg-[#fffdf8]"
              }`}
            >
              <span
                className={`text-xs font-semibold uppercase tracking-[0.16em] ${
                  isFocusMode ? "text-[#d9bb74]" : "text-[#8b6d2a]"
                }`}
              >
                Zoom
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setPageZoom((currentZoom) =>
                      TUTOR_PAGE_ZOOM_OPTIONS[
                        Math.max(
                          0,
                          TUTOR_PAGE_ZOOM_OPTIONS.indexOf(currentZoom) - 1
                        )
                      ]
                    )
                  }
                  disabled={pageZoom === TUTOR_PAGE_ZOOM_OPTIONS[0]}
                  className={`rounded-xl border px-2.5 py-1 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    isFocusMode
                      ? "border-[#6d5b8d]/45 bg-[#231a3d] text-[#f7e7bf] hover:border-[#d0a95b]/40 hover:bg-[#2b2148]"
                      : "border-[#d7c49b] bg-white text-[#3b295e] hover:border-[#caa04f] hover:bg-[#fff5de]"
                  }`}
                >
                  -
                </button>
                <span
                  className={`min-w-[3.5rem] text-center text-sm font-semibold ${
                    isFocusMode ? "text-[#fbf7ee]" : "text-[#2e2147]"
                  }`}
                >
                  {pageZoom}%
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setPageZoom((currentZoom) =>
                      TUTOR_PAGE_ZOOM_OPTIONS[
                        Math.min(
                          TUTOR_PAGE_ZOOM_OPTIONS.length - 1,
                          TUTOR_PAGE_ZOOM_OPTIONS.indexOf(currentZoom) + 1
                        )
                      ]
                    )
                  }
                  disabled={
                    pageZoom ===
                    TUTOR_PAGE_ZOOM_OPTIONS[TUTOR_PAGE_ZOOM_OPTIONS.length - 1]
                  }
                  className={`rounded-xl border px-2.5 py-1 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    isFocusMode
                      ? "border-[#6d5b8d]/45 bg-[#231a3d] text-[#f7e7bf] hover:border-[#d0a95b]/40 hover:bg-[#2b2148]"
                      : "border-[#d7c49b] bg-white text-[#3b295e] hover:border-[#caa04f] hover:bg-[#fff5de]"
                  }`}
                >
                  +
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.push(isFocusMode ? standardModeUrl : focusModeUrl)}
              className={`w-full rounded-2xl border px-4 py-2 text-sm font-medium transition ${
                isFocusMode
                  ? "border-[#6d5b8d]/45 bg-[#1f1836] text-[#f0ddb0] hover:border-[#d0a95b]/35 hover:bg-[#2a2045]"
                  : "border-[#d7c49b] bg-white text-[#3a285d] hover:border-[#caa04f] hover:bg-[#fff7e8]"
              }`}
            >
              {isFocusMode ? "Exit full screen" : "Full screen"}
            </button>
            <button
              type="button"
              onClick={handleBackToProgress}
              className="w-full rounded-2xl bg-[#caa04f] px-4 py-2 text-sm font-medium text-[#20183b] transition hover:bg-[#ddb86c]"
            >
              Back to Progress
            </button>
            <button
              type="button"
              onClick={handleRestartConcept}
              disabled={restartingConcept || !(focusedConcept || selectedConcept)}
              className={`w-full rounded-2xl border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                isFocusMode
                  ? "border-amber-300/20 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20"
                  : "border-[#e5cb92] bg-[#fff6e3] text-[#7c5a15] hover:bg-[#fff0cf]"
              }`}
            >
              {restartingConcept ? "Restarting..." : "Restart concept"}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className={`w-full rounded-2xl border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                isFocusMode
                  ? "border-[#6d5b8d]/45 bg-[#1f1836] text-[#f0ddb0] hover:border-[#d0a95b]/35 hover:bg-[#2a2045]"
                  : "border-[#d7c49b] bg-white text-[#3a285d] hover:border-[#caa04f] hover:bg-[#fff7e8]"
              }`}
            >
              {loggingOut ? "Logging out..." : "Log out"}
            </button>
          </div>
        </div>

        {logoutError && (
          <p
            className={`rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-200 ${
              isFocusMode ? "mx-4 mt-4 sm:mx-6" : ""
            }`}
          >
            {logoutError}
          </p>
        )}

        <div
          className={`grid ${
            isFocusMode ? "gap-0 lg:grid-cols-[minmax(0,1fr)]" : "gap-6 lg:grid-cols-[320px_minmax(0,1fr)]"
          }`}
        >
          <aside
            className={`space-y-4 ${
              isFocusMode
                ? "hidden"
                : "lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto lg:pr-2"
            }`}
          >
            <div className="rounded-[1.8rem] border border-[#ddd0b4] bg-[rgba(255,251,244,0.96)] p-5 shadow-[0_20px_60px_rgba(57,39,101,0.12)] backdrop-blur-sm">
              <label className="mb-2 block text-sm font-medium text-[#7f6321]">
                Subject
              </label>
              <select
                value={selectedSubjectId}
                onChange={(e) => handleSubjectChange(e.target.value)}
                className="w-full rounded-2xl border border-[#d8c7a3] bg-white px-4 py-3 text-sm text-[#2d2143] outline-none focus:border-[#caa04f]"
              >
                <option value="">
                  {loadingSubjects ? "Loading subjects..." : "Select a subject"}
                </option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>

              {selectedSubjectName && (
                <div className="mt-4 rounded-2xl border border-[#e0cfac] bg-[linear-gradient(180deg,_rgba(255,249,237,0.96)_0%,_rgba(246,238,220,0.96)_100%)] p-4">
                  <p className="text-sm text-[#8a6f2f]">Selected subject</p>
                  <p className="mt-1 text-base font-semibold text-[#2e2147]">
                    {selectedSubjectName}
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-[1.8rem] border border-[#ddd0b4] bg-[rgba(255,251,244,0.96)] p-5 shadow-[0_20px_60px_rgba(57,39,101,0.12)] backdrop-blur-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-[#2d2143]">Subject Topics</h2>
                  <p className="mt-1 text-sm text-[#6b5b80]">
                    Learn chapter by chapter, then move through concepts and subtopics in order.
                  </p>
                </div>
                <span className="rounded-full border border-[#e2d2ad] bg-[#fff8ea] px-3 py-1 text-xs font-medium text-[#7a6020]">
                  {topicTree.length} chapters
                </span>
              </div>

              {!selectedSubjectId ? (
                <p className="mt-4 rounded-2xl border border-[#eadfc8] bg-[#fffdfa] p-4 text-sm text-[#6b5b80]">
                  Choose a subject to see its extracted topics.
                </p>
              ) : loadingTopics ? (
                <p className="mt-4 rounded-2xl border border-[#eadfc8] bg-[#fffdfa] p-4 text-sm text-[#6b5b80]">
                  Loading extracted topics...
                </p>
              ) : topicsError ? (
                <p className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100">
                  {topicsError}
                </p>
              ) : topics.length === 0 ? (
                <p className="mt-4 rounded-2xl border border-[#d0a95b]/20 bg-[#2c213f] p-4 text-sm text-[#f1d69a]">
                  No extracted topics yet for this subject. Upload and process a document first.
                </p>
              ) : (
                <div className="mt-4 max-h-[34rem] space-y-3 overflow-y-auto pr-1">
                  {topicTree.map((topic) => renderTopicNode(topic))}
                </div>
              )}
            </div>
          </aside>

          <section
            className={`space-y-6 pb-44 sm:pb-36 ${
              isFocusMode ? "min-h-screen px-4 py-4 sm:px-6 sm:py-6" : ""
            }`}
          >
            <div className={`mx-auto w-full ${paperWidthClass}`}>
              <div
                className={`rounded-[30px] border p-5 shadow-[0_28px_90px_rgba(53,37,92,0.18)] sm:p-8 ${
                  isFocusMode
                    ? "border-[#d0a95b]/18 bg-[linear-gradient(180deg,_rgba(24,19,45,0.96)_0%,_rgba(17,13,34,0.98)_100%)]"
                    : "border-[#e3d5bc] bg-[linear-gradient(180deg,_rgba(255,251,244,0.98)_0%,_rgba(247,240,226,0.98)_100%)]"
                }`}
                style={{ fontSize: `${pageZoom}%` }}
              >
                <div className="space-y-6">
                  {switchNotice && (
                    <div className="rounded-2xl border border-[#d0a95b]/25 bg-[#3a2d17]/65 p-4">
                      <p className="text-sm font-medium text-[#f2d08a]">{switchNotice}</p>
                    </div>
                  )}

                  {focusedConcept && (
                    <div
                      className={`rounded-2xl border p-4 ${
                        isFocusMode
                          ? "border-[#6d5b8d]/35 bg-[#251d40]/92"
                          : "border-[#e1d3b8] bg-white/92"
                      }`}
                    >
                      <p className={`text-sm ${isFocusMode ? "text-[#d8b66d]" : "text-[#896d2d]"}`}>
                        Currently studying
                      </p>
                      <p
                        className={`mt-1 text-lg font-semibold ${
                          isFocusMode ? "text-[#fbf7ee]" : "text-[#2d2143]"
                        }`}
                      >
                        {focusedConcept}
                      </p>
                    </div>
                  )}

                  {typeof masteryScore === "number" && (
                    <div className="rounded-2xl border border-emerald-400/20 bg-[linear-gradient(180deg,_rgba(31,58,46,0.92)_0%,_rgba(17,37,31,0.94)_100%)] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm text-[#a7d8b8]">Mastery progress</p>
                          <p className="mt-1 text-lg font-semibold text-[#f5f7ef]">
                            {focusedConcept ? focusedConcept : "Current concept"}
                          </p>
                        </div>
                        <MasteryBadge sessionType={sessionType} />
                      </div>

                      <div className="mt-4">
                        <MasteryProgressBar score={masteryScore} />
                      </div>
                    </div>
                  )}

                  {dataNextAction && (
                    <div className="rounded-2xl border border-[#d0a95b]/25 bg-[linear-gradient(180deg,_rgba(57,43,18,0.92)_0%,_rgba(35,27,15,0.94)_100%)] p-4">
                      <p className="text-sm font-medium text-[#f1ce81]">Do this next</p>
                      <p className="mt-2 text-sm text-[#fbf1d9]">{dataNextAction}</p>
                    </div>
                  )}

                  {nextStep && (
                    <div className="rounded-2xl border border-[#6d5b8d]/35 bg-[linear-gradient(180deg,_rgba(52,39,84,0.9)_0%,_rgba(28,21,47,0.96)_100%)] p-5 shadow-[0_14px_40px_rgba(0,0,0,0.22)]">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-medium text-[#d8b66d]">Best next step</p>
                          <h2 className="mt-1 text-xl font-bold text-[#fbf7ee]">
                            {nextStep.name}
                          </h2>
                        </div>
                        <NextStepBadge action={nextStep.action} />
                      </div>

                      <p className="mt-4 text-sm text-[#d5cde6]">{nextStep.reason}</p>

                      <div className="mt-4">
                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              buildTutorUrl({
                                concept: nextStep.name,
                                subjectId: nextStep.subject_id || selectedSubjectId,
                                shouldAutoStart: true,
                              })
                            )
                          }
                          className="rounded-2xl bg-[#caa04f] px-4 py-2 text-sm font-medium text-[#20183b] transition hover:bg-[#ddb86c]"
                        >
                          Study this next
                        </button>
                      </div>
                    </div>
                  )}

                  {focusedConcept && (
                    <div
                      className={`rounded-2xl border p-5 shadow-[0_18px_48px_rgba(53,37,92,0.12)] backdrop-blur-sm ${
                        isFocusMode
                          ? "border-white/10 bg-white/[0.04]"
                          : "border-[#e5d9c3] bg-[rgba(255,252,246,0.94)]"
                      }`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h2
                            className={`text-xl font-semibold ${
                              isFocusMode ? "text-[#fbf7ee]" : "text-[#2d2143]"
                            }`}
                          >
                            Conversation history
                          </h2>
                          <p className={`mt-1 text-sm ${isFocusMode ? "text-[#c8bfd9]" : "text-[#6b5b80]"}`}>
                            Pick up this concept exactly where you left off.
                          </p>
                        </div>
                        {loadingHistory && (
                          <span
                            className={`rounded-full border px-3 py-1 text-xs font-medium ${
                              isFocusMode
                                ? "border-white/10 bg-white/10 text-[#e7d09b]"
                                : "border-[#e5d5b4] bg-[#fff6e5] text-[#7a6020]"
                            }`}
                          >
                            Loading...
                          </span>
                        )}
                      </div>

                      {activeCheckpoint && (
                        <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-[linear-gradient(180deg,_rgba(31,58,46,0.92)_0%,_rgba(17,37,31,0.94)_100%)] p-4">
                          <p className="text-sm font-medium text-[#a7d8b8]">
                            Recovery checkpoint ready
                          </p>
                          <p className="mt-1 text-sm text-[#d9eee1]">
                            If you get lost, you can reset this concept back to the saved checkpoint below.
                          </p>
                        </div>
                      )}

                      {checkpointNotice && (
                        <p className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                          {checkpointNotice}
                        </p>
                      )}

                      {historyError ? (
                        <p className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100">
                          {historyError}
                        </p>
                      ) : conversationHistory.length === 0 ? (
                        <p
                          className={`mt-4 rounded-2xl border p-4 text-sm ${
                            isFocusMode
                              ? "border-white/8 bg-white/[0.04] text-[#c8bfd9]"
                              : "border-[#eadfc8] bg-[#fffdfa] text-[#6b5b80]"
                          }`}
                        >
                          No saved conversation for this concept yet. Start asking and the
                          thread will build here.
                        </p>
                      ) : (
                        <div className="mt-4 space-y-4">
                          {conversationHistory.map((message) => (
                            <ConversationMessage
                              key={message.id}
                              message={message}
                              onSetCheckpoint={handleSetCheckpoint}
                              onResetToCheckpoint={handleResetToCheckpoint}
                              checkpointSavingId={checkpointSavingId}
                              checkpointResettingId={checkpointResettingId}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {answer && !focusedConcept && (
                    <div
                      className={`rounded-2xl border p-5 shadow-[0_18px_48px_rgba(53,37,92,0.12)] backdrop-blur-sm ${
                        isFocusMode
                          ? "border-white/10 bg-white/[0.04]"
                          : "border-[#e5d9c3] bg-[rgba(255,252,246,0.94)]"
                      }`}
                    >
                      <h2
                        className={`text-xl font-semibold ${
                          isFocusMode ? "text-[#fbf7ee]" : "text-[#2d2143]"
                        }`}
                      >
                        Tutor response
                      </h2>
                      <div className="mt-4">
                        <TutorAnswer answer={answer} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div
              className={`sticky bottom-0 z-10 border shadow-[0_24px_80px_rgba(53,37,92,0.18)] backdrop-blur-md ${
                isFocusMode
                  ? "mx-auto w-full max-w-[620px] rounded-2xl border-[#d0a95b]/18 bg-[#18132d]/94 p-2.5 sm:bottom-3"
                  : "-mx-4 rounded-t-2xl border-[#ddd0b4] bg-[rgba(255,251,245,0.96)] p-4 sm:bottom-4 sm:mx-0 sm:rounded-2xl sm:p-5"
              }`}
            >
              {shouldShowAdvanceButton && (
                <div
                  className={`rounded-2xl border border-[#d0a95b]/24 bg-[linear-gradient(180deg,_rgba(66,48,18,0.92)_0%,_rgba(37,28,14,0.98)_100%)] ${
                    shouldShowComposer
                      ? isFocusMode
                        ? "mb-2 p-3"
                        : "mb-4 p-4"
                      : isFocusMode
                      ? "p-3"
                      : "p-4"
                  }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#f1d392]">
                    Continue lesson
                  </p>
                  <p
                    className={`mt-1 text-[#fbf1d9] ${
                      isFocusMode ? "text-xs leading-5" : "text-sm leading-6"
                    }`}
                  >
                    {dataNextAction}
                  </p>
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={handleAdvanceLesson}
                      disabled={loading}
                      className={`inline-flex items-center justify-center rounded-2xl bg-[#caa04f] font-semibold text-[#20183b] transition hover:bg-[#ddb86c] disabled:cursor-not-allowed disabled:opacity-60 ${
                        isFocusMode ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"
                      }`}
                    >
                      {loading ? "Moving on..." : "Next"}
                    </button>
                  </div>
                </div>
              )}

              {shouldShowComposer && (
                <>
              <label
                className={`block font-medium ${
                  isFocusMode ? "mb-1 text-xs text-[#dbc580]" : "mb-2 text-sm text-[#7f6321]"
                }`}
              >
                Message
              </label>
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  focusedConcept
                    ? `Type your question or answer for ${focusedConcept}...`
                    : "Type your question or answer here..."
                }
                rows={isFocusMode ? 2 : 4}
                className={`w-full rounded-2xl border outline-none ${
                  isFocusMode
                    ? "border-[#6d5b8d]/45 bg-[#221a3b] text-[#fbf7ee] placeholder:text-[#9488ad] focus:border-[#d0a95b]/45"
                    : "border-[#d8c7a3] bg-white text-[#2d2143] placeholder:text-[#8c7b9f] focus:border-[#caa04f]"
                } ${isFocusMode ? "min-h-[72px] px-3 py-2 text-xs" : "px-4 py-3 text-sm"}`}
              />

              <div
                className={`flex flex-col gap-3 sm:flex-row sm:items-center ${
                  isFocusMode ? "mt-2" : "mt-4"
                }`}
              >
                <button
                  onClick={handleAsk}
                  disabled={loading}
                  className={`inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#caa04f] font-medium text-[#20183b] transition hover:bg-[#ddb86c] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto ${
                    isFocusMode
                      ? "px-3 py-1.5 text-xs"
                      : "px-4 py-2 text-sm"
                  }`}
                >
                  <span aria-hidden="true" className="text-base leading-none">
                    ↑
                  </span>
                  <span>{loading ? "Submitting..." : "Submit"}</span>
                </button>
              </div>
                </>
              )}

              {error && (
                <p
                  className={`rounded-2xl border border-rose-400/30 bg-rose-500/10 text-rose-100 ${
                    isFocusMode ? "mt-2 p-3 text-xs" : "mt-4 p-4 text-sm"
                  }`}
                >
                  {error}
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

export default function TutorPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f6f1e6]" />}>
      <TutorPageContent />
    </Suspense>
  );
}

function buildTopicTree(items: TopicItem[]): TopicNode[] {
  const byId = new Map<number, TopicNode>();

  items.forEach((item) => {
    byId.set(item.id, { ...item, children: [] });
  });

  const roots: TopicNode[] = [];

  byId.forEach((node) => {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id)?.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortNodes = (nodes: TopicNode[]) => {
    nodes.sort((left, right) => left.order_index - right.order_index || left.name.localeCompare(right.name));
    nodes.forEach((node) => sortNodes(node.children));
  };

  sortNodes(roots);
  return roots;
}

type AnswerSegment =
  | { type: "text"; content: string }
  | { type: "graph"; content: string }
  | { type: "diagram"; content: string }
  | { type: "image-search"; content: string };

type GraphSpec = {
  type: "function";
  title?: string;
  equation: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  xLabel?: string;
  yLabel?: string;
};

type GeometryShape = "triangle" | "rectangle" | "circle" | "angle";
type CellType = "plant" | "animal";

type DiagramSpec =
  | {
      type: "atom";
      title?: string;
      style: "bohr";
      element?: string;
      protons?: number;
      neutrons?: number;
      shells: number[];
    }
  | {
      type: "geometry";
      title?: string;
      shape: GeometryShape;
      labels: string[];
      sideLabels: string[];
      radiusLabel?: string;
      angleLabel?: string;
    }
  | {
      type: "cell";
      title?: string;
      cellType: CellType;
      labels: string[];
    }
  | {
      type: "molecule";
      title?: string;
      formula: string;
      style: "ball-stick";
    }
  | {
      type: "mitosis";
      title?: string;
      stage: "interphase" | "prophase" | "metaphase" | "anaphase" | "telophase";
      labels: string[];
    }
  | {
      type: "foodweb";
      title?: string;
      organisms: string[];
      links: [string, string][];
    }
  | {
      type: "circuit";
      title?: string;
      circuitType: "series" | "parallel";
      labels: string[];
      switchState?: "open" | "closed";
    }
  | {
      type: "coordinate-plane";
      title?: string;
      points: { label: string; x: number; y: number }[];
      segments: [string, string][];
      equation?: string;
    }
  | {
      type: "freebody";
      title?: string;
      objectLabel?: string;
      forces: { label: string; direction: "up" | "down" | "left" | "right" }[];
    }
  | {
      type: "reaction";
      title?: string;
      reactants: string[];
      products: string[];
      conditions?: string;
    }
  | {
      type: "cycle";
      title?: string;
      stages: string[];
      cycleType?: "life" | "process";
    };

type ImageSearchSpec = {
  title?: string;
  query: string;
  reason?: string;
};

function splitAnswerSegments(answer: string): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  const pattern = /```(graph|diagram|image-search)\s*([\s\S]*?)```/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(answer)) !== null) {
    const textBefore = answer.slice(lastIndex, match.index);
    if (textBefore.trim()) {
      segments.push({ type: "text", content: textBefore.trim() });
    }

    const blockType = match[1].toLowerCase() as AnswerSegment["type"];
    segments.push({ type: blockType, content: match[2].trim() });
    lastIndex = pattern.lastIndex;
  }

  const textAfter = answer.slice(lastIndex);
  if (textAfter.trim()) {
    segments.push({ type: "text", content: textAfter.trim() });
  }

  return segments;
}

function normalizeTutorText(content: string): string {
  return normalizeMathSyntax(
    content
      .replace(/\\\[\s*/g, "")
      .replace(/\s*\\\]/g, "")
      .replace(/\\\(\s*/g, "")
      .replace(/\s*\\\)/g, "")
      .replace(/\\\\/g, "\\")
  );
}

function normalizeMathSyntax(content: string): string {
  let normalized = content;

  for (let index = 0; index < 6; index += 1) {
    const next = normalized.replace(
      /\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g,
      "($1)/($2)"
    );
    if (next === normalized) {
      break;
    }
    normalized = next;
  }

  return normalized
    .replace(/\\sqrt\s*\{([^{}]+)\}/g, "sqrt($1)")
    .replace(/\\sqrt\s*\(\s*([^)]+?)\s*\)/g, "sqrt($1)")
    .replace(/\\cdot/g, "*")
    .replace(/\\times/g, "*")
    .replace(/\\div/g, "/")
    .replace(/\\pm/g, "±")
    .replace(/\\mp/g, "∓")
    .replace(/\\leq/g, "<=")
    .replace(/\\geq/g, ">=")
    .replace(/\\neq/g, "!=")
    .replace(/\\approx/g, "≈")
    .replace(/\{([^{}]+)\}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyInlineEquation(content: string): boolean {
  const trimmed = content.trim();

  if (!trimmed) {
    return false;
  }

  if (trimmed.length > 40) {
    return false;
  }

  const hasMathSignal =
    /[=+\-*/^<>±≈]/.test(trimmed) ||
    /\b(sin|cos|tan|log|ln|sqrt|pi)\b/i.test(trimmed) ||
    /[a-zA-Z]\([^)]+\)/.test(trimmed);

  const mostlyMath = /^[0-9a-zA-Z\s=+\-*/^<>()[\].,:%±≈]+$/.test(trimmed);

  return hasMathSignal && mostlyMath;
}

function toSuperscript(value: string): string {
  const superscriptMap: Record<string, string> = {
    "0": "⁰",
    "1": "¹",
    "2": "²",
    "3": "³",
    "4": "⁴",
    "5": "⁵",
    "6": "⁶",
    "7": "⁷",
    "8": "⁸",
    "9": "⁹",
    "+": "⁺",
    "-": "⁻",
    "=": "⁼",
    "(": "⁽",
    ")": "⁾",
    n: "ⁿ",
    i: "ⁱ",
  };

  return value
    .split("")
    .map((character) => superscriptMap[character] || character)
    .join("");
}

function formatInlineEquation(content: string): string {
  return normalizeMathSyntax(content)
    .replace(/\(\s*([^()]+?)\s*\)\s*\/\s*\(\s*([^()]+?)\s*\)/g, "$1/$2")
    .replace(/\bsqrt\(\s*([^)]+?)\s*\)/gi, "√($1)")
    .replace(/\btheta\b/gi, "θ")
    .replace(/\balpha\b/gi, "α")
    .replace(/\bbeta\b/gi, "β")
    .replace(/\bgamma\b/gi, "γ")
    .replace(/\bdelta\b/gi, "δ")
    .replace(/\blambda\b/gi, "λ")
    .replace(/\bpi\b/gi, "π")
    .replace(/<=/g, "≤")
    .replace(/>=/g, "≥")
    .replace(/!=/g, "≠")
    .replace(/\*/g, "·")
    .replace(/->/g, "→")
    .replace(/<-/g, "←")
    .replace(/([A-Za-z0-9)])\^([+\-]?\d+)/g, (_, base, exponent) => {
      return `${base}${toSuperscript(exponent)}`;
    })
    .replace(/\b(\d+)\s*\/\s*(\d+)\b/g, "$1⁄$2")
    .replace(/\b([A-Za-z]+)\s*\/\s*([A-Za-z]+)\b/g, "$1⁄$2");
}

function toKatexExpression(content: string): string {
  return normalizeMathSyntax(content)
    .replace(/\(\s*([^()]+?)\s*\)\s*\/\s*\(\s*([^()]+?)\s*\)/g, "\\frac{$1}{$2}")
    .replace(/\bsqrt\(\s*([^)]+?)\s*\)/gi, "\\sqrt{$1}")
    .replace(/<=/g, "\\le ")
    .replace(/>=/g, "\\ge ")
    .replace(/!=/g, "\\ne ")
    .replace(/±/g, "\\pm ")
    .replace(/∓/g, "\\mp ")
    .replace(/\*/g, " \\cdot ");
}

function renderKatex(
  content: string,
  {
    displayMode = false,
    key,
  }: {
    displayMode?: boolean;
    key: string;
  }
): React.ReactNode | null {
  try {
    const html = katex.renderToString(toKatexExpression(content), {
      throwOnError: false,
      displayMode,
      strict: "ignore",
      trust: false,
    });

    return (
      <span
        key={key}
        className={displayMode ? "block overflow-x-auto py-1" : "inline-block"}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  } catch {
    return null;
  }
}

function renderStyledInlineMath(text: string): React.ReactNode[] {
  const normalized = normalizeTutorText(text);
  const parts = normalized.split(/(\([^()\n]{1,40}\))/g);

  return parts.map((part, index) => {
    const innerMatch = part.match(/^\(([^()\n]{1,40})\)$/);
    const equationCandidate = innerMatch ? innerMatch[1] : part;

    if (isLikelyInlineEquation(equationCandidate)) {
      const expression = equationCandidate.trim();
      const renderedMath = renderKatex(expression, {
        key: `math-${index}`,
      });

      if (renderedMath) {
        return (
          <span
            key={`math-shell-${index}`}
            className="inline-flex rounded-xl border border-[#6d5b8d]/35 bg-[#241d3f] px-2.5 py-1 text-[#f5ecda] shadow-[0_8px_18px_rgba(0,0,0,0.18)]"
          >
            {renderedMath}
          </span>
        );
      }

      const formattedEquation = formatInlineEquation(expression);

      return (
        <span
          key={`math-${index}`}
          className="inline-flex rounded-xl border border-[#6d5b8d]/35 bg-[#241d3f] px-2.5 py-1 font-mono text-[0.95em] text-[#f5ecda] shadow-[0_8px_18px_rgba(0,0,0,0.18)]"
        >
          {formattedEquation}
        </span>
      );
    }

    return <span key={`text-${index}`}>{part}</span>;
  });
}

function renderTutorTextBlock(text: string): React.ReactNode[] {
  const normalized = normalizeTutorText(text);
  const lines = normalized.split("\n");

  return lines.map((line, index) => {
    const trimmed = line.trim();

    if (!trimmed) {
      return <div key={`spacer-${index}`} className="h-2" />;
    }

    if (isLikelyInlineEquation(trimmed)) {
      const renderedMath = renderKatex(trimmed, {
        displayMode: true,
        key: `display-math-${index}`,
      });

      if (renderedMath) {
        return (
          <div
            key={`display-math-wrap-${index}`}
            className="rounded-2xl border border-[#6d5b8d]/35 bg-[linear-gradient(180deg,_rgba(44,34,74,0.94)_0%,_rgba(27,21,46,0.98)_100%)] px-4 py-3 text-[#f7f0df] shadow-[0_16px_40px_rgba(0,0,0,0.22)]"
          >
            {renderedMath}
          </div>
        );
      }
    }

    const headingMatch = trimmed.match(/^(###|####)\s+(.+)$/);
    if (headingMatch) {
      const isSubheading = headingMatch[1] === "####";
      return (
        <div
          key={`heading-${index}`}
          className={
            isSubheading
              ? "rounded-2xl border border-[#6d5b8d]/35 bg-[linear-gradient(180deg,_rgba(44,34,74,0.94)_0%,_rgba(27,21,46,0.98)_100%)] px-4 py-2.5 text-sm font-semibold text-[#f5ecd8] shadow-[0_14px_34px_rgba(0,0,0,0.18)]"
              : "rounded-2xl border border-[#d0a95b]/28 bg-[linear-gradient(180deg,_rgba(66,48,18,0.92)_0%,_rgba(37,28,14,0.98)_100%)] px-4 py-3 text-base font-semibold text-[#f7ebc8] shadow-[0_16px_40px_rgba(0,0,0,0.24)]"
          }
        >
          {renderStyledInlineMath(headingMatch[2])}
        </div>
      );
    }

    const quickCheckMatch = trimmed.match(/^Quick check:\s*(.+)$/i);
    if (quickCheckMatch) {
      return (
        <div
          key={`quick-check-${index}`}
          className="rounded-2xl border border-rose-400/30 bg-[linear-gradient(180deg,_rgba(95,33,47,0.88)_0%,_rgba(53,18,28,0.96)_100%)] px-4 py-3 shadow-[0_16px_40px_rgba(0,0,0,0.24)]"
        >
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-200">
            Concept Check
          </div>
          <div className="mt-1 text-sm font-semibold text-[#fff0f1]">
            {renderStyledInlineMath(quickCheckMatch[1])}
          </div>
        </div>
      );
    }

    const boldOnlyMatch = trimmed.match(/^\*\*(.+)\*\*$/);
    if (boldOnlyMatch) {
      return (
        <div
          key={`bold-${index}`}
          className="inline-flex rounded-full border border-[#d0a95b]/28 bg-[linear-gradient(180deg,_rgba(66,48,18,0.92)_0%,_rgba(37,28,14,0.98)_100%)] px-3 py-1.5 text-sm font-semibold text-[#f7ebc8] shadow-[0_12px_26px_rgba(0,0,0,0.18)]"
        >
          {renderStyledInlineMath(boldOnlyMatch[1])}
        </div>
      );
    }

    const withBoldSegments = line.split(/(\*\*[^*]+\*\*)/g);

    return (
      <div
        key={`text-line-${index}`}
        className="whitespace-pre-wrap text-[#ddd5eb]"
      >
        {withBoldSegments.map((segment, segmentIndex) => {
          const boldMatch = segment.match(/^\*\*([^*]+)\*\*$/);

          if (boldMatch) {
            return (
              <span
                key={`segment-${index}-${segmentIndex}`}
                className="font-semibold text-[#fbf7ee]"
              >
                {renderStyledInlineMath(boldMatch[1])}
              </span>
            );
          }

          return (
            <span key={`segment-${index}-${segmentIndex}`}>
              {renderStyledInlineMath(segment)}
            </span>
          );
        })}
      </div>
    );
  });
}

function parseGraphSpec(raw: string): GraphSpec | null {
  const entries = new Map<string, string>();

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim().toLowerCase();
    const value = trimmed.slice(separatorIndex + 1).trim();
    entries.set(key, value);
  }

  const type = (entries.get("type") || "function").toLowerCase();
  if (type !== "function") {
    return null;
  }

  const equation = entries.get("equation");
  if (!equation) {
    return null;
  }

  const xMin = Number(entries.get("x_min") || "-10");
  const xMax = Number(entries.get("x_max") || "10");
  const yMin = Number(entries.get("y_min") || "-10");
  const yMax = Number(entries.get("y_max") || "10");

  if (
    !Number.isFinite(xMin) ||
    !Number.isFinite(xMax) ||
    !Number.isFinite(yMin) ||
    !Number.isFinite(yMax) ||
    xMin >= xMax ||
    yMin >= yMax
  ) {
    return null;
  }

  return {
    type: "function",
    title: entries.get("title") || undefined,
    equation,
    xMin,
    xMax,
    yMin,
    yMax,
    xLabel:
      entries.get("x_label") ||
      entries.get("horizontal_label") ||
      entries.get("input_label") ||
      undefined,
    yLabel:
      entries.get("y_label") ||
      entries.get("vertical_label") ||
      entries.get("output_label") ||
      undefined,
  };
}

function parseStructuredBlock(raw: string): Map<string, string> {
  const entries = new Map<string, string>();

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim().toLowerCase();
    const value = trimmed.slice(separatorIndex + 1).trim();
    entries.set(key, value);
  }

  return entries;
}

function parseList(value?: string): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumberList(value?: string): number[] {
  return parseList(value)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item >= 0);
}

function parsePointSpecs(value?: string) {
  return parseList(value)
    .map((item) => {
      const match = item.match(/^([A-Za-z][A-Za-z0-9]*)\((-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\)$/);
      if (!match) {
        return null;
      }

      return {
        label: match[1],
        x: Number(match[2]),
        y: Number(match[3]),
      };
    })
    .filter((item): item is { label: string; x: number; y: number } => item !== null);
}

function parseLinkPairs(value?: string): [string, string][] {
  return parseList(value)
    .map((item) => {
      const parts = item.split(">").map((part) => part.trim());
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return null;
      }

      return [parts[0], parts[1]] as [string, string];
    })
    .filter((item): item is [string, string] => item !== null);
}

function parseForceSpecs(value?: string) {
  return parseList(value)
    .map((item) => {
      const parts = item.split("@").map((part) => part.trim());
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return null;
      }

      const direction = parts[1].toLowerCase();
      if (!["up", "down", "left", "right"].includes(direction)) {
        return null;
      }

      return {
        label: parts[0],
        direction: direction as "up" | "down" | "left" | "right",
      };
    })
    .filter(
      (
        item
      ): item is { label: string; direction: "up" | "down" | "left" | "right" } =>
        item !== null
    );
}

function parseDiagramSpec(raw: string): DiagramSpec | null {
  const entries = parseStructuredBlock(raw);
  const type = (entries.get("type") || "").toLowerCase();

  if (type === "atom") {
    const shells = parseNumberList(entries.get("shells"));
    if (shells.length === 0) {
      return null;
    }

    return {
      type: "atom",
      title: entries.get("title") || undefined,
      style: "bohr",
      element: entries.get("element") || undefined,
      protons: Number(entries.get("protons") || "") || undefined,
      neutrons: Number(entries.get("neutrons") || "") || undefined,
      shells,
    };
  }

  if (type === "geometry") {
    const shape = (entries.get("shape") || "").toLowerCase();
    if (!["triangle", "rectangle", "circle", "angle"].includes(shape)) {
      return null;
    }

    return {
      type: "geometry",
      title: entries.get("title") || undefined,
      shape: shape as GeometryShape,
      labels: parseList(entries.get("labels")),
      sideLabels: parseList(entries.get("side_labels")),
      radiusLabel: entries.get("radius_label") || undefined,
      angleLabel: entries.get("angle_label") || undefined,
    };
  }

  if (type === "cell") {
    const cellType = (entries.get("cell_type") || "").toLowerCase();
    if (!["plant", "animal"].includes(cellType)) {
      return null;
    }

    return {
      type: "cell",
      title: entries.get("title") || undefined,
      cellType: cellType as CellType,
      labels: parseList(entries.get("labels")),
    };
  }

  if (type === "molecule") {
    const formula = entries.get("formula");
    if (!formula) {
      return null;
    }

    return {
      type: "molecule",
      title: entries.get("title") || undefined,
      formula,
      style: "ball-stick",
    };
  }

  if (type === "mitosis") {
    const stage = (entries.get("stage") || "").toLowerCase();
    if (
      !["interphase", "prophase", "metaphase", "anaphase", "telophase"].includes(
        stage
      )
    ) {
      return null;
    }

    return {
      type: "mitosis",
      title: entries.get("title") || undefined,
      stage: stage as Extract<DiagramSpec, { type: "mitosis" }>["stage"],
      labels: parseList(entries.get("labels")),
    };
  }

  if (type === "foodweb") {
    const organisms = parseList(entries.get("organisms"));
    const links = parseLinkPairs(entries.get("links"));
    if (organisms.length === 0 || links.length === 0) {
      return null;
    }

    return {
      type: "foodweb",
      title: entries.get("title") || undefined,
      organisms,
      links,
    };
  }

  if (type === "circuit") {
    const circuitType = (entries.get("circuit_type") || "").toLowerCase();
    if (!["series", "parallel"].includes(circuitType)) {
      return null;
    }

    const switchState = (entries.get("switch_state") || "").toLowerCase();

    return {
      type: "circuit",
      title: entries.get("title") || undefined,
      circuitType: circuitType as "series" | "parallel",
      labels: parseList(entries.get("labels")),
      switchState:
        switchState === "open" || switchState === "closed"
          ? (switchState as "open" | "closed")
          : undefined,
    };
  }

  if (type === "coordinate-plane") {
    const points = parsePointSpecs(entries.get("points"));
    const segments = parseLinkPairs(entries.get("segments"));
    if (points.length === 0 && !entries.get("equation")) {
      return null;
    }

    return {
      type: "coordinate-plane",
      title: entries.get("title") || undefined,
      points,
      segments,
      equation: entries.get("equation") || undefined,
    };
  }

  if (type === "freebody") {
    const forces = parseForceSpecs(entries.get("forces"));
    if (forces.length === 0) {
      return null;
    }

    return {
      type: "freebody",
      title: entries.get("title") || undefined,
      objectLabel: entries.get("object_label") || undefined,
      forces,
    };
  }

  if (type === "reaction") {
    const reactants = parseList(entries.get("reactants"));
    const products = parseList(entries.get("products"));
    if (reactants.length === 0 || products.length === 0) {
      return null;
    }

    return {
      type: "reaction",
      title: entries.get("title") || undefined,
      reactants,
      products,
      conditions: entries.get("conditions") || undefined,
    };
  }

  if (type === "cycle") {
    const stages = parseList(entries.get("stages"));
    if (stages.length < 2) {
      return null;
    }

    const cycleType = (entries.get("cycle_type") || "").toLowerCase();

    return {
      type: "cycle",
      title: entries.get("title") || undefined,
      stages,
      cycleType:
        cycleType === "life" || cycleType === "process"
          ? cycleType
          : undefined,
    };
  }

  return null;
}

function parseImageSearchSpec(raw: string): ImageSearchSpec | null {
  const entries = parseStructuredBlock(raw);
  const query = entries.get("query");
  if (!query) {
    return null;
  }

  return {
    title: entries.get("title") || undefined,
    query,
    reason: entries.get("reason") || undefined,
  };
}

function compileEquation(rawEquation: string): ((x: number) => number) | null {
  const normalized = normalizeMathSyntax(rawEquation)
    .trim()
    .replace(/^(?:y|f\(x\))\s*=\s*/i, "")
    .replace(/\^/g, "**")
    .replace(/([0-9)])\s*x\b/g, "$1*x")
    .replace(/\bx\s*\(/g, "x*(")
    .replace(/([0-9)])\s*\(/g, "$1*(")
    .replace(/\)\s*\(/g, ")*(")
    .replace(/\)\s*x\b/g, ")*x");

  const allowedPattern = /^[0-9x+\-*/().,\s_a-zA-Z±]*$/;
  if (!allowedPattern.test(normalized)) {
    return null;
  }

  const safeExpression = normalized
    .replace(/\bpi\b/gi, "Math.PI")
    .replace(/\be\b/g, "Math.E")
    .replace(/\bsin\(/gi, "Math.sin(")
    .replace(/\bcos\(/gi, "Math.cos(")
    .replace(/\btan\(/gi, "Math.tan(")
    .replace(/\babs\(/gi, "Math.abs(")
    .replace(/\bsqrt\(/gi, "Math.sqrt(")
    .replace(/\blog\(/gi, "Math.log(")
    .replace(/\bln\(/gi, "Math.log(")
    .replace(/\bexp\(/gi, "Math.exp(")
    .replace(/±/g, "+");

  try {
    const evaluator = new Function("x", `return ${safeExpression};`) as (
      x: number
    ) => number;

    return (x: number) => {
      const y = evaluator(x);
      return Number.isFinite(y) ? y : NaN;
    };
  } catch {
    return null;
  }
}

type GraphPoint = {
  label: string;
  x: number;
  y: number;
};

function formatGraphNumber(value: number) {
  if (Math.abs(value) < 1e-7) {
    return "0";
  }
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function dedupeGraphPoints(points: GraphPoint[]) {
  const deduped: GraphPoint[] = [];

  for (const point of points) {
    const exists = deduped.some(
      (candidate) =>
        Math.abs(candidate.x - point.x) < 0.2 &&
        Math.abs(candidate.y - point.y) < 0.2
    );
    if (!exists) {
      deduped.push(point);
    }
  }

  return deduped;
}

function getGraphHighlights(
  evaluate: (x: number) => number,
  spec: GraphSpec
): GraphPoint[] {
  const sampleCount = 180;
  const samples: { x: number; y: number }[] = [];

  for (let index = 0; index <= sampleCount; index += 1) {
    const x = spec.xMin + ((spec.xMax - spec.xMin) * index) / sampleCount;
    const y = evaluate(x);
    if (Number.isFinite(y)) {
      samples.push({ x, y });
    }
  }

  const highlights: GraphPoint[] = [];

  if (spec.xMin <= 0 && spec.xMax >= 0) {
    const yAtZero = evaluate(0);
    if (Number.isFinite(yAtZero) && yAtZero >= spec.yMin && yAtZero <= spec.yMax) {
      highlights.push({
        label: `y-int (0, ${formatGraphNumber(yAtZero)})`,
        x: 0,
        y: yAtZero,
      });
    }
  }

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];

    if (
      previous.y === 0 &&
      previous.y >= spec.yMin &&
      previous.y <= spec.yMax
    ) {
      highlights.push({
        label: `x-int (${formatGraphNumber(previous.x)}, 0)`,
        x: previous.x,
        y: 0,
      });
      continue;
    }

    if (previous.y * current.y < 0) {
      const ratio = previous.y / (previous.y - current.y);
      const xIntercept = previous.x + (current.x - previous.x) * ratio;
      if (xIntercept >= spec.xMin && xIntercept <= spec.xMax) {
        highlights.push({
          label: `x-int (${formatGraphNumber(xIntercept)}, 0)`,
          x: xIntercept,
          y: 0,
        });
      }
    }
  }

  for (let index = 1; index < samples.length - 1; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const next = samples[index + 1];

    if (
      (current.y > previous.y && current.y > next.y) ||
      (current.y < previous.y && current.y < next.y)
    ) {
      if (current.y >= spec.yMin && current.y <= spec.yMax) {
        highlights.push({
          label: `turning point (${formatGraphNumber(current.x)}, ${formatGraphNumber(
            current.y
          )})`,
          x: current.x,
          y: current.y,
        });
      }
    }
  }

  const deduped = dedupeGraphPoints(highlights);

  if (deduped.length < 3) {
    const fallbackIndices = [Math.floor(sampleCount * 0.25), Math.floor(sampleCount * 0.5), Math.floor(sampleCount * 0.75)];
    for (const fallbackIndex of fallbackIndices) {
      const sample = samples[fallbackIndex];
      if (!sample) continue;
      if (sample.y < spec.yMin || sample.y > spec.yMax) continue;
      deduped.push({
        label: `sample (${formatGraphNumber(sample.x)}, ${formatGraphNumber(sample.y)})`,
        x: sample.x,
        y: sample.y,
      });
    }
  }

  return dedupeGraphPoints(deduped).slice(0, 5);
}

function FunctionGraph({ spec }: { spec: GraphSpec }) {
  const width = 640;
  const height = 360;
  const padding = 36;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  const toSvgX = (x: number) =>
    padding + ((x - spec.xMin) / (spec.xMax - spec.xMin)) * innerWidth;
  const toSvgY = (y: number) =>
    height - padding - ((y - spec.yMin) / (spec.yMax - spec.yMin)) * innerHeight;

  const axisX =
    spec.yMin <= 0 && spec.yMax >= 0 ? toSvgY(0) : height - padding;
  const axisY =
    spec.xMin <= 0 && spec.xMax >= 0 ? toSvgX(0) : padding;

  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));
  const labelAxisX = clamp(axisX + 22, padding + 18, height - padding + 18);
  const xTickValues = Array.from({ length: 9 }, (_, index) =>
    spec.xMin + ((spec.xMax - spec.xMin) * index) / 8
  );
  const yTickValues = Array.from({ length: 7 }, (_, index) =>
    spec.yMin + ((spec.yMax - spec.yMin) * index) / 6
  );
  const xAxisLabel = spec.xLabel || "x";
  const yAxisLabel = spec.yLabel || "y";

  const evaluate = compileEquation(spec.equation);
  if (!evaluate) {
    return (
      <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100">
        The tutor tried to draw a graph, but the equation format could not be rendered.
      </div>
    );
  }

  const points: string[] = [];
  const steps = 120;
  for (let index = 0; index <= steps; index += 1) {
    const x = spec.xMin + ((spec.xMax - spec.xMin) * index) / steps;
    const y = evaluate(x);

    if (!Number.isFinite(y) || y < spec.yMin - 100 || y > spec.yMax + 100) {
      continue;
    }

    points.push(`${toSvgX(x)},${toSvgY(y)}`);
  }

  const graphHighlights = getGraphHighlights(evaluate, spec);

  return (
    <div className="mt-4 rounded-[1.6rem] border border-[#6d5b8d]/35 bg-[linear-gradient(180deg,_rgba(44,34,74,0.94)_0%,_rgba(27,21,46,0.98)_100%)] p-4 shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[#f7ebc8]">
            {spec.title || "Graph"}
          </p>
          <p className="text-xs text-[#d6cdea]">{spec.equation}</p>
        </div>
        <div className="text-right text-xs text-[#d6cdea]">
          <div>
            {xAxisLabel}: {spec.xMin} to {spec.xMax}
          </div>
          <div>
            {yAxisLabel}: {spec.yMin} to {spec.yMax}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="min-w-[36rem] rounded-2xl border border-[#eadfca]/70 bg-[#fffaf0] sm:min-w-0 sm:w-full"
          role="img"
          aria-label={spec.title || spec.equation}
        >
          <rect x="0" y="0" width={width} height={height} fill="white" />

          {xTickValues.map((value, index) => {
            const x = toSvgX(value);
            return (
              <g key={`x-grid-${index}`}>
                <line
                  x1={x}
                  y1={padding}
                  x2={x}
                  y2={height - padding}
                  stroke="#e7dcc5"
                  strokeWidth="1"
                />
                <line
                  x1={x}
                  y1={axisX - 5}
                  x2={x}
                  y2={axisX + 5}
                  stroke="#8b7355"
                  strokeWidth="1.5"
                />
                <text
                  x={x}
                  y={labelAxisX}
                  textAnchor="middle"
                  className="fill-[#6f5d46] text-[11px] font-medium"
                >
                  {Number.isInteger(value) ? value : value.toFixed(1)}
                </text>
              </g>
            );
          })}

          {yTickValues.map((value, index) => {
            const y = toSvgY(value);
            return (
              <g key={`y-grid-${index}`}>
                <line
                  x1={padding}
                  y1={y}
                  x2={width - padding}
                  y2={y}
                  stroke="#e7dcc5"
                  strokeWidth="1"
                />
                <line
                  x1={axisY - 5}
                  y1={y}
                  x2={axisY + 5}
                  y2={y}
                  stroke="#8b7355"
                  strokeWidth="1.5"
                />
                <text
                  x={axisY - 10}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-[#6f5d46] text-[11px] font-medium"
                >
                  {Number.isInteger(value) ? value : value.toFixed(1)}
                </text>
              </g>
            );
          })}

          <line
            x1={padding}
            y1={axisX}
            x2={width - padding}
            y2={axisX}
            stroke="#94a3b8"
            strokeWidth="1.5"
          />
          <line
            x1={axisY}
            y1={padding}
            x2={axisY}
            y2={height - padding}
            stroke="#94a3b8"
            strokeWidth="1.5"
          />

          <text
            x={width - padding + 10}
            y={axisX + 4}
            className="fill-[#3d4c63] text-xs font-semibold"
          >
            {xAxisLabel}
          </text>
          <text
            x={axisY + 8}
            y={padding - 10}
            className="fill-[#3d4c63] text-xs font-semibold"
          >
            {yAxisLabel}
          </text>
          <text
            x={width / 2}
            y={height - 10}
            textAnchor="middle"
            className="fill-[#6f5d46] text-[11px] font-medium uppercase tracking-[0.18em]"
          >
            {xAxisLabel}
          </text>
          <text
            x={18}
            y={height / 2}
            textAnchor="middle"
            transform={`rotate(-90 18 ${height / 2})`}
            className="fill-[#6f5d46] text-[11px] font-medium uppercase tracking-[0.18em]"
          >
            {yAxisLabel}
          </text>

          <polyline
            fill="none"
            stroke="#0284c7"
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={points.join(" ")}
          />

          {graphHighlights.map((point, index) => {
            const pointX = toSvgX(point.x);
            const pointY = toSvgY(point.y);
            const dx = index % 2 === 0 ? 10 : -10;
            const dy = index % 2 === 0 ? -12 : 18;
            const anchor = dx > 0 ? "start" : "end";

            return (
              <g key={`highlight-${index}`}>
                <circle
                  cx={pointX}
                  cy={pointY}
                  r="5"
                  fill="#caa04f"
                  stroke="#fff8ea"
                  strokeWidth="2"
                />
                <text
                  x={pointX + dx}
                  y={pointY + dy}
                  textAnchor={anchor}
                  className="fill-[#7a5d27] text-[11px] font-semibold"
                >
                  {point.label}
                </text>
              </g>
            );
          })}

          <circle cx={axisY} cy={axisX} r="4" fill="#caa04f" />
          <text
            x={axisY + 10}
            y={axisX - 10}
            className="fill-[#8b6a2d] text-[11px] font-semibold"
          >
            (0, 0)
          </text>
        </svg>
      </div>
    </div>
  );
}

function DiagramFrame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 rounded-[1.6rem] border border-[#d0a95b]/24 bg-[linear-gradient(180deg,_rgba(33,52,47,0.94)_0%,_rgba(20,33,30,0.98)_100%)] p-4 shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[#f7ebc8]">{title}</p>
          {subtitle ? <p className="text-xs text-[#d9eee1]">{subtitle}</p> : null}
        </div>
        <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#cde5d8]">
          Diagram
        </span>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function AtomDiagram({ spec }: { spec: Extract<DiagramSpec, { type: "atom" }> }) {
  const width = 520;
  const height = 360;
  const centerX = width / 2;
  const centerY = height / 2;
  const shellGap = 42;
  const nucleusRadius = 42;

  return (
    <DiagramFrame
      title={spec.title || `${spec.element || "Atom"} diagram`}
      subtitle={
        spec.element
          ? `${spec.element}${spec.protons ? ` • ${spec.protons} protons` : ""}${
              spec.neutrons ? ` • ${spec.neutrons} neutrons` : ""
            }`
          : "Bohr-style atom model"
      }
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="min-w-[28rem] rounded-xl bg-white sm:min-w-0 sm:w-full"
        role="img"
        aria-label={spec.title || "Atom diagram"}
      >
        <rect width={width} height={height} fill="white" />
        {spec.shells.map((count, shellIndex) => {
          const radius = nucleusRadius + shellGap * (shellIndex + 1);
          return (
            <g key={`shell-${shellIndex}`}>
              <circle
                cx={centerX}
                cy={centerY}
                r={radius}
                fill="none"
                stroke="#a7f3d0"
                strokeWidth="2"
                strokeDasharray="6 6"
              />
              {Array.from({ length: count }, (_, electronIndex) => {
                const angle = (Math.PI * 2 * electronIndex) / count - Math.PI / 2;
                const x = centerX + radius * Math.cos(angle);
                const y = centerY + radius * Math.sin(angle);
                return (
                  <g key={`electron-${shellIndex}-${electronIndex}`}>
                    <circle cx={x} cy={y} r="8" fill="#0ea5e9" />
                    <text
                      x={x}
                      y={y + 3}
                      textAnchor="middle"
                      className="fill-white text-[10px] font-bold"
                    >
                      e
                    </text>
                  </g>
                );
              })}
              <text
                x={centerX + radius + 12}
                y={centerY - 6}
                className="fill-emerald-800 text-[11px] font-medium"
              >
                Shell {shellIndex + 1}: {count}
              </text>
            </g>
          );
        })}

        <circle cx={centerX} cy={centerY} r={nucleusRadius} fill="#10b981" />
        <text
          x={centerX}
          y={centerY - 6}
          textAnchor="middle"
          className="fill-white text-sm font-semibold"
        >
          Nucleus
        </text>
        <text
          x={centerX}
          y={centerY + 12}
          textAnchor="middle"
          className="fill-white text-[11px]"
        >
          {spec.protons ?? "p"}p • {spec.neutrons ?? "n"}n
        </text>
      </svg>
    </DiagramFrame>
  );
}

function GeometryDiagram({
  spec,
}: {
  spec: Extract<DiagramSpec, { type: "geometry" }>;
}) {
  const width = 460;
  const height = 320;

  const renderShape = () => {
    if (spec.shape === "triangle") {
      const points = [
        [90, 250],
        [230, 70],
        [360, 250],
      ];
      const labels = spec.labels.length >= 3 ? spec.labels : ["A", "B", "C"];
      const sideLabels = spec.sideLabels;

      return (
        <>
          <polygon
            points={points.map((point) => point.join(",")).join(" ")}
            fill="#dbeafe"
            stroke="#2563eb"
            strokeWidth="3"
          />
          {points.map(([x, y], index) => (
            <g key={`triangle-point-${index}`}>
              <circle cx={x} cy={y} r="4" fill="#1d4ed8" />
              <text x={x + 10} y={y - 10} className="fill-slate-900 text-sm font-semibold">
                {labels[index]}
              </text>
            </g>
          ))}
          {sideLabels[0] ? (
            <text x="145" y="165" className="fill-blue-900 text-xs font-medium">
              {sideLabels[0]}
            </text>
          ) : null}
          {sideLabels[1] ? (
            <text x="295" y="165" className="fill-blue-900 text-xs font-medium">
              {sideLabels[1]}
            </text>
          ) : null}
          {sideLabels[2] ? (
            <text x="222" y="275" className="fill-blue-900 text-xs font-medium">
              {sideLabels[2]}
            </text>
          ) : null}
        </>
      );
    }

    if (spec.shape === "rectangle") {
      const labels = spec.labels.length >= 4 ? spec.labels : ["A", "B", "C", "D"];
      return (
        <>
          <rect x="90" y="80" width="260" height="160" fill="#ede9fe" stroke="#7c3aed" strokeWidth="3" rx="10" />
          {[
            [90, 80],
            [350, 80],
            [350, 240],
            [90, 240],
          ].map(([x, y], index) => (
            <text key={`rect-label-${index}`} x={x + 8} y={y - 8} className="fill-slate-900 text-sm font-semibold">
              {labels[index]}
            </text>
          ))}
          {spec.sideLabels[0] ? (
            <text x="215" y="68" className="fill-violet-900 text-xs font-medium">
              {spec.sideLabels[0]}
            </text>
          ) : null}
          {spec.sideLabels[1] ? (
            <text x="364" y="165" className="fill-violet-900 text-xs font-medium">
              {spec.sideLabels[1]}
            </text>
          ) : null}
        </>
      );
    }

    if (spec.shape === "circle") {
      return (
        <>
          <circle cx="230" cy="160" r="90" fill="#fef3c7" stroke="#d97706" strokeWidth="3" />
          <line x1="230" y1="160" x2="320" y2="160" stroke="#b45309" strokeWidth="3" />
          <circle cx="230" cy="160" r="4" fill="#92400e" />
          <text x="220" y="150" className="fill-slate-900 text-sm font-semibold">
            O
          </text>
          <text x="265" y="148" className="fill-amber-900 text-xs font-medium">
            {spec.radiusLabel || "radius"}
          </text>
        </>
      );
    }

    return (
      <>
        <line x1="120" y1="230" x2="120" y2="100" stroke="#dc2626" strokeWidth="4" />
        <line x1="120" y1="230" x2="320" y2="230" stroke="#dc2626" strokeWidth="4" />
        <path d="M 170 230 A 50 50 0 0 0 120 180" fill="none" stroke="#f97316" strokeWidth="3" />
        <text x="145" y="195" className="fill-orange-900 text-xs font-medium">
          {spec.angleLabel || "θ"}
        </text>
      </>
    );
  };

  return (
    <DiagramFrame title={spec.title || "Geometry diagram"} subtitle={`Shape: ${spec.shape}`}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="min-w-[26rem] rounded-xl bg-white sm:min-w-0 sm:w-full"
        role="img"
        aria-label={spec.title || `${spec.shape} diagram`}
      >
        <rect width={width} height={height} fill="white" />
        {renderShape()}
      </svg>
    </DiagramFrame>
  );
}

function CellDiagram({ spec }: { spec: Extract<DiagramSpec, { type: "cell" }> }) {
  const width = 520;
  const height = 340;
  const labels = spec.labels.slice(0, 5);
  const isPlant = spec.cellType === "plant";

  return (
    <DiagramFrame
      title={spec.title || `${isPlant ? "Plant" : "Animal"} cell`}
      subtitle={`${isPlant ? "Plant" : "Animal"} cell overview`}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="min-w-[28rem] rounded-xl bg-white sm:min-w-0 sm:w-full"
        role="img"
        aria-label={spec.title || `${spec.cellType} cell diagram`}
      >
        <rect width={width} height={height} fill="white" />
        {isPlant ? (
          <>
            <rect x="70" y="40" width="360" height="240" rx="24" fill="#dcfce7" stroke="#15803d" strokeWidth="4" />
            <rect x="100" y="75" width="300" height="170" rx="20" fill="#bbf7d0" stroke="#22c55e" strokeWidth="3" />
            <ellipse cx="300" cy="160" rx="60" ry="45" fill="#fde68a" stroke="#d97706" strokeWidth="3" />
            <ellipse cx="180" cy="130" rx="28" ry="18" fill="#86efac" stroke="#16a34a" strokeWidth="2.5" />
            <ellipse cx="180" cy="200" rx="28" ry="18" fill="#86efac" stroke="#16a34a" strokeWidth="2.5" />
          </>
        ) : (
          <>
            <ellipse cx="250" cy="165" rx="170" ry="110" fill="#dbeafe" stroke="#2563eb" strokeWidth="4" />
            <ellipse cx="285" cy="165" rx="58" ry="46" fill="#fbcfe8" stroke="#db2777" strokeWidth="3" />
            <ellipse cx="160" cy="130" rx="26" ry="16" fill="#93c5fd" stroke="#2563eb" strokeWidth="2.5" />
            <ellipse cx="170" cy="210" rx="26" ry="16" fill="#93c5fd" stroke="#2563eb" strokeWidth="2.5" />
          </>
        )}
        {labels.map((label, index) => (
          <text
            key={`cell-label-${index}`}
            x="448"
            y={72 + index * 34}
            className="fill-slate-900 text-xs font-medium"
          >
            • {label}
          </text>
        ))}
      </svg>
    </DiagramFrame>
  );
}

function MoleculeDiagram({
  spec,
}: {
  spec: Extract<DiagramSpec, { type: "molecule" }>;
}) {
  const normalizedFormula = spec.formula.replace(/\s+/g, "").toUpperCase();
  const presets: Record<
    string,
    { atoms: { label: string; x: number; y: number; fill: string }[]; bonds: [number, number][] }
  > = {
    H2O: {
      atoms: [
        { label: "O", x: 220, y: 140, fill: "#38bdf8" },
        { label: "H", x: 145, y: 220, fill: "#cbd5e1" },
        { label: "H", x: 295, y: 220, fill: "#cbd5e1" },
      ],
      bonds: [
        [0, 1],
        [0, 2],
      ],
    },
    CO2: {
      atoms: [
        { label: "O", x: 130, y: 170, fill: "#38bdf8" },
        { label: "C", x: 220, y: 170, fill: "#fbbf24" },
        { label: "O", x: 310, y: 170, fill: "#38bdf8" },
      ],
      bonds: [
        [0, 1],
        [1, 2],
      ],
    },
    O2: {
      atoms: [
        { label: "O", x: 175, y: 170, fill: "#38bdf8" },
        { label: "O", x: 265, y: 170, fill: "#38bdf8" },
      ],
      bonds: [[0, 1]],
    },
    CH4: {
      atoms: [
        { label: "C", x: 220, y: 170, fill: "#fbbf24" },
        { label: "H", x: 220, y: 80, fill: "#cbd5e1" },
        { label: "H", x: 130, y: 170, fill: "#cbd5e1" },
        { label: "H", x: 310, y: 170, fill: "#cbd5e1" },
        { label: "H", x: 220, y: 260, fill: "#cbd5e1" },
      ],
      bonds: [
        [0, 1],
        [0, 2],
        [0, 3],
        [0, 4],
      ],
    },
    NH3: {
      atoms: [
        { label: "N", x: 220, y: 150, fill: "#a78bfa" },
        { label: "H", x: 150, y: 225, fill: "#cbd5e1" },
        { label: "H", x: 220, y: 245, fill: "#cbd5e1" },
        { label: "H", x: 290, y: 225, fill: "#cbd5e1" },
      ],
      bonds: [
        [0, 1],
        [0, 2],
        [0, 3],
      ],
    },
  };

  const preset = presets[normalizedFormula];
  if (!preset) {
    return (
      <ImageSearchCard
        spec={{
          title: spec.title || `${spec.formula} reference image`,
          query: `${spec.formula} molecule diagram`,
          reason:
            "This molecule is not in the built-in diagram templates yet, so a trusted reference image will help.",
        }}
      />
    );
  }

  return (
    <DiagramFrame title={spec.title || `${spec.formula} molecule`} subtitle="Ball-and-stick style">
      <svg
        viewBox="0 0 440 320"
        className="min-w-[24rem] rounded-xl bg-white sm:min-w-0 sm:w-full"
        role="img"
        aria-label={spec.title || `${spec.formula} molecule diagram`}
      >
        <rect width="440" height="320" fill="white" />
        {preset.bonds.map(([fromIndex, toIndex], index) => {
          const from = preset.atoms[fromIndex];
          const to = preset.atoms[toIndex];
          return (
            <line
              key={`bond-${index}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="#64748b"
              strokeWidth="5"
              strokeLinecap="round"
            />
          );
        })}
        {preset.atoms.map((atom, index) => (
          <g key={`atom-${index}`}>
            <circle cx={atom.x} cy={atom.y} r="26" fill={atom.fill} />
            <text
              x={atom.x}
              y={atom.y + 6}
              textAnchor="middle"
              className="fill-slate-900 text-base font-bold"
            >
              {atom.label}
            </text>
          </g>
        ))}
      </svg>
    </DiagramFrame>
  );
}

function MitosisDiagram({
  spec,
}: {
  spec: Extract<DiagramSpec, { type: "mitosis" }>;
}) {
  const stageVisuals: Record<
    Extract<DiagramSpec, { type: "mitosis" }>["stage"],
    React.ReactNode
  > = {
    interphase: (
      <>
        <circle cx="180" cy="150" r="90" fill="#ede9fe" stroke="#7c3aed" strokeWidth="4" />
        <circle cx="180" cy="150" r="34" fill="#c4b5fd" />
        <path d="M135 120 C150 100, 210 100, 225 130 C205 150, 155 155, 135 120" fill="none" stroke="#5b21b6" strokeWidth="3" />
      </>
    ),
    prophase: (
      <>
        <circle cx="180" cy="150" r="90" fill="#ede9fe" stroke="#7c3aed" strokeWidth="4" />
        <path d="M130 110 L165 145 L130 180" fill="none" stroke="#4c1d95" strokeWidth="4" />
        <path d="M230 110 L195 145 L230 180" fill="none" stroke="#4c1d95" strokeWidth="4" />
        <circle cx="90" cy="150" r="10" fill="#f59e0b" />
        <circle cx="270" cy="150" r="10" fill="#f59e0b" />
      </>
    ),
    metaphase: (
      <>
        <circle cx="180" cy="150" r="90" fill="#ede9fe" stroke="#7c3aed" strokeWidth="4" />
        <line x1="180" y1="80" x2="180" y2="220" stroke="#475569" strokeDasharray="6 6" strokeWidth="2" />
        <path d="M140 110 L180 150 L140 190" fill="none" stroke="#4c1d95" strokeWidth="4" />
        <path d="M220 110 L180 150 L220 190" fill="none" stroke="#4c1d95" strokeWidth="4" />
      </>
    ),
    anaphase: (
      <>
        <circle cx="180" cy="150" r="90" fill="#ede9fe" stroke="#7c3aed" strokeWidth="4" />
        <path d="M110 120 L145 150 L110 180" fill="none" stroke="#4c1d95" strokeWidth="4" />
        <path d="M250 120 L215 150 L250 180" fill="none" stroke="#4c1d95" strokeWidth="4" />
        <line x1="90" y1="150" x2="145" y2="150" stroke="#f59e0b" strokeWidth="3" />
        <line x1="215" y1="150" x2="270" y2="150" stroke="#f59e0b" strokeWidth="3" />
      </>
    ),
    telophase: (
      <>
        <path d="M90 150 a70 70 0 1 0 140 0 a70 70 0 1 0 -140 0" fill="#ede9fe" stroke="#7c3aed" strokeWidth="4" />
        <path d="M170 150 a70 70 0 1 0 140 0 a70 70 0 1 0 -140 0" fill="#ede9fe" stroke="#7c3aed" strokeWidth="4" />
        <circle cx="150" cy="150" r="25" fill="#c4b5fd" />
        <circle cx="250" cy="150" r="25" fill="#c4b5fd" />
      </>
    ),
  };

  return (
    <DiagramFrame title={spec.title || "Mitosis"} subtitle={`Stage: ${spec.stage}`}>
      <svg viewBox="0 0 420 300" className="min-w-[24rem] rounded-xl bg-white sm:min-w-0 sm:w-full" role="img" aria-label={spec.title || `${spec.stage} mitosis diagram`}>
        <rect width="420" height="300" fill="white" />
        {stageVisuals[spec.stage]}
        {spec.labels.slice(0, 4).map((label, index) => (
          <text key={`mitosis-label-${index}`} x="320" y={90 + index * 28} className="fill-slate-900 text-xs font-medium">
            • {label}
          </text>
        ))}
      </svg>
    </DiagramFrame>
  );
}

function FoodWebDiagram({
  spec,
}: {
  spec: Extract<DiagramSpec, { type: "foodweb" }>;
}) {
  const width = 520;
  const height = 340;
  const positions = spec.organisms.reduce<Record<string, { x: number; y: number }>>(
    (accumulator, organism, index) => {
      const columns = 3;
      const column = index % columns;
      const row = Math.floor(index / columns);
      accumulator[organism] = { x: 110 + column * 150, y: 80 + row * 110 };
      return accumulator;
    },
    {}
  );

  return (
    <DiagramFrame title={spec.title || "Food web"} subtitle="Energy flow between organisms">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[28rem] rounded-xl bg-white sm:min-w-0 sm:w-full" role="img" aria-label={spec.title || "Food web diagram"}>
        <defs>
          <marker id="foodweb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#16a34a" />
          </marker>
        </defs>
        <rect width={width} height={height} fill="white" />
        {spec.links.map(([from, to], index) => {
          const fromPoint = positions[from];
          const toPoint = positions[to];
          if (!fromPoint || !toPoint) return null;
          return (
            <line
              key={`foodweb-link-${index}`}
              x1={fromPoint.x}
              y1={fromPoint.y}
              x2={toPoint.x}
              y2={toPoint.y}
              stroke="#16a34a"
              strokeWidth="3"
              markerEnd="url(#foodweb-arrow)"
            />
          );
        })}
        {spec.organisms.map((organism) => {
          const point = positions[organism];
          return (
            <g key={organism}>
              <rect x={point.x - 44} y={point.y - 18} width="88" height="36" rx="14" fill="#dcfce7" stroke="#22c55e" strokeWidth="2.5" />
              <text x={point.x} y={point.y + 5} textAnchor="middle" className="fill-slate-900 text-xs font-semibold">
                {organism}
              </text>
            </g>
          );
        })}
      </svg>
    </DiagramFrame>
  );
}

function CircuitDiagram({
  spec,
}: {
  spec: Extract<DiagramSpec, { type: "circuit" }>;
}) {
  const isParallel = spec.circuitType === "parallel";
  const isOpen = spec.switchState === "open";

  return (
    <DiagramFrame title={spec.title || "Electric circuit"} subtitle={`${spec.circuitType} circuit${spec.switchState ? ` • switch ${spec.switchState}` : ""}`}>
      <svg viewBox="0 0 520 320" className="min-w-[28rem] rounded-xl bg-white sm:min-w-0 sm:w-full" role="img" aria-label={spec.title || "Electric circuit diagram"}>
        <rect width="520" height="320" fill="white" />
        <line x1="80" y1="80" x2="80" y2="240" stroke="#334155" strokeWidth="4" />
        <line x1="80" y1="240" x2="420" y2="240" stroke="#334155" strokeWidth="4" />
        <line x1="420" y1="240" x2="420" y2="80" stroke="#334155" strokeWidth="4" />
        <line x1="80" y1="80" x2="150" y2="80" stroke="#334155" strokeWidth="4" />
        <line x1="170" y1="70" x2="170" y2="90" stroke="#334155" strokeWidth="4" />
        <line x1="184" y1="64" x2="184" y2="96" stroke="#334155" strokeWidth="4" />
        <line x1="184" y1="80" x2={isOpen ? 222 : 240} y2={isOpen ? 62 : 80} stroke="#334155" strokeWidth="4" />
        {!isOpen ? <line x1="240" y1="80" x2="310" y2="80" stroke="#334155" strokeWidth="4" /> : <line x1="240" y1="80" x2="310" y2="80" stroke="#334155" strokeWidth="4" opacity="0.25" />}
        {isParallel ? (
          <>
            <line x1="310" y1="80" x2="310" y2="130" stroke="#334155" strokeWidth="4" />
            <line x1="310" y1="190" x2="310" y2="240" stroke="#334155" strokeWidth="4" />
            <line x1="310" y1="130" x2="390" y2="130" stroke="#334155" strokeWidth="4" />
            <line x1="310" y1="190" x2="390" y2="190" stroke="#334155" strokeWidth="4" />
            <line x1="390" y1="130" x2="390" y2="190" stroke="#334155" strokeWidth="4" />
            <circle cx="350" cy="130" r="18" fill="#fef3c7" stroke="#d97706" strokeWidth="3" />
            <circle cx="350" cy="190" r="18" fill="#fef3c7" stroke="#d97706" strokeWidth="3" />
          </>
        ) : (
          <>
            <line x1="310" y1="80" x2="350" y2="80" stroke="#334155" strokeWidth="4" />
            <circle cx="380" cy="80" r="22" fill="#fef3c7" stroke="#d97706" strokeWidth="3" />
            <line x1="402" y1="80" x2="420" y2="80" stroke="#334155" strokeWidth="4" />
          </>
        )}
        {spec.labels.slice(0, 4).map((label, index) => (
          <text key={`circuit-label-${index}`} x="96" y={275 + index * 18} className="fill-slate-900 text-xs font-medium">
            • {label}
          </text>
        ))}
      </svg>
    </DiagramFrame>
  );
}

function CoordinatePlaneDiagram({
  spec,
}: {
  spec: Extract<DiagramSpec, { type: "coordinate-plane" }>;
}) {
  const width = 520;
  const height = 340;
  const padding = 42;
  const xMin = -10;
  const xMax = 10;
  const yMin = -10;
  const yMax = 10;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const toSvgX = (x: number) => padding + ((x - xMin) / (xMax - xMin)) * innerWidth;
  const toSvgY = (y: number) => height - padding - ((y - yMin) / (yMax - yMin)) * innerHeight;
  const pointMap = Object.fromEntries(spec.points.map((point) => [point.label, point]));
  const equationPoints =
    spec.equation && compileEquation(spec.equation)
      ? (() => {
          const evaluate = compileEquation(spec.equation);
          if (!evaluate) return [];
          const points: string[] = [];
          for (let index = 0; index <= 120; index += 1) {
            const x = xMin + ((xMax - xMin) * index) / 120;
            const y = evaluate(x);
            if (!Number.isFinite(y) || y < yMin - 100 || y > yMax + 100) continue;
            points.push(`${toSvgX(x)},${toSvgY(y)}`);
          }
          return points;
        })()
      : [];

  return (
    <DiagramFrame title={spec.title || "Coordinate plane"} subtitle={spec.equation ? `Includes ${spec.equation}` : "Points and segments on the plane"}>
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[28rem] rounded-xl bg-white sm:min-w-0 sm:w-full" role="img" aria-label={spec.title || "Coordinate plane diagram"}>
        <rect width={width} height={height} fill="white" />
        {Array.from({ length: 11 }, (_, index) => {
          const positive = index;
          const negative = -index;
          return (
            <g key={`grid-${index}`}>
              <line x1={toSvgX(positive)} y1={padding} x2={toSvgX(positive)} y2={height - padding} stroke="#e2e8f0" strokeWidth="1" />
              <line x1={toSvgX(negative)} y1={padding} x2={toSvgX(negative)} y2={height - padding} stroke="#e2e8f0" strokeWidth="1" />
              <line x1={padding} y1={toSvgY(positive)} x2={width - padding} y2={toSvgY(positive)} stroke="#e2e8f0" strokeWidth="1" />
              <line x1={padding} y1={toSvgY(negative)} x2={width - padding} y2={toSvgY(negative)} stroke="#e2e8f0" strokeWidth="1" />
            </g>
          );
        })}
        <line x1={padding} y1={toSvgY(0)} x2={width - padding} y2={toSvgY(0)} stroke="#64748b" strokeWidth="2" />
        <line x1={toSvgX(0)} y1={padding} x2={toSvgX(0)} y2={height - padding} stroke="#64748b" strokeWidth="2" />
        {equationPoints.length > 1 ? (
          <polyline fill="none" stroke="#0284c7" strokeWidth="3" points={equationPoints.join(" ")} />
        ) : null}
        {spec.segments.map(([fromLabel, toLabel], index) => {
          const from = pointMap[fromLabel];
          const to = pointMap[toLabel];
          if (!from || !to) return null;
          return (
            <line
              key={`segment-${index}`}
              x1={toSvgX(from.x)}
              y1={toSvgY(from.y)}
              x2={toSvgX(to.x)}
              y2={toSvgY(to.y)}
              stroke="#7c3aed"
              strokeWidth="3"
            />
          );
        })}
        {spec.points.map((point) => (
          <g key={point.label}>
            <circle cx={toSvgX(point.x)} cy={toSvgY(point.y)} r="5" fill="#1d4ed8" />
            <text x={toSvgX(point.x) + 8} y={toSvgY(point.y) - 8} className="fill-slate-900 text-xs font-semibold">
              {point.label}({point.x},{point.y})
            </text>
          </g>
        ))}
      </svg>
    </DiagramFrame>
  );
}

function FreeBodyDiagram({
  spec,
}: {
  spec: Extract<DiagramSpec, { type: "freebody" }>;
}) {
  const arrows = {
    up: { x1: 220, y1: 150, x2: 220, y2: 70, labelX: 230, labelY: 84 },
    down: { x1: 220, y1: 190, x2: 220, y2: 270, labelX: 230, labelY: 254 },
    left: { x1: 180, y1: 170, x2: 90, y2: 170, labelX: 96, labelY: 156 },
    right: { x1: 260, y1: 170, x2: 350, y2: 170, labelX: 286, labelY: 156 },
  } as const;

  return (
    <DiagramFrame
      title={spec.title || "Free-body diagram"}
      subtitle={spec.objectLabel ? `Object: ${spec.objectLabel}` : "Forces on an object"}
    >
      <svg viewBox="0 0 440 320" className="min-w-[24rem] rounded-xl bg-white sm:min-w-0 sm:w-full" role="img" aria-label={spec.title || "Free-body diagram"}>
        <defs>
          <marker id="force-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#dc2626" />
          </marker>
        </defs>
        <rect width="440" height="320" fill="white" />
        <rect x="180" y="130" width="80" height="80" rx="12" fill="#dbeafe" stroke="#2563eb" strokeWidth="3" />
        <text x="220" y="176" textAnchor="middle" className="fill-slate-900 text-sm font-semibold">
          {spec.objectLabel || "Object"}
        </text>
        {spec.forces.map((force, index) => {
          const arrow = arrows[force.direction];
          return (
            <g key={`force-${index}`}>
              <line
                x1={arrow.x1}
                y1={arrow.y1}
                x2={arrow.x2}
                y2={arrow.y2}
                stroke="#dc2626"
                strokeWidth="4"
                markerEnd="url(#force-arrow)"
              />
              <text x={arrow.labelX} y={arrow.labelY} className="fill-red-700 text-xs font-semibold">
                {force.label}
              </text>
            </g>
          );
        })}
      </svg>
    </DiagramFrame>
  );
}

function ReactionDiagram({
  spec,
}: {
  spec: Extract<DiagramSpec, { type: "reaction" }>;
}) {
  const reactantText = spec.reactants.join(" + ");
  const productText = spec.products.join(" + ");

  return (
    <DiagramFrame
      title={spec.title || "Chemical reaction"}
      subtitle={spec.conditions || "Reactants transform into products"}
    >
      <svg viewBox="0 0 620 220" className="min-w-[32rem] rounded-xl bg-white sm:min-w-0 sm:w-full" role="img" aria-label={spec.title || "Chemical reaction diagram"}>
        <defs>
          <marker id="reaction-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#0284c7" />
          </marker>
        </defs>
        <rect width="620" height="220" fill="white" />
        <rect x="40" y="70" width="210" height="80" rx="20" fill="#fee2e2" stroke="#ef4444" strokeWidth="3" />
        <text x="145" y="118" textAnchor="middle" className="fill-slate-900 text-base font-semibold">
          {reactantText}
        </text>
        <line x1="270" y1="110" x2="430" y2="110" stroke="#0284c7" strokeWidth="5" markerEnd="url(#reaction-arrow)" />
        {spec.conditions ? (
          <text x="350" y="86" textAnchor="middle" className="fill-sky-800 text-xs font-medium">
            {spec.conditions}
          </text>
        ) : null}
        <rect x="440" y="70" width="140" height="80" rx="20" fill="#dcfce7" stroke="#16a34a" strokeWidth="3" />
        <text x="510" y="118" textAnchor="middle" className="fill-slate-900 text-base font-semibold">
          {productText}
        </text>
      </svg>
    </DiagramFrame>
  );
}

function CycleDiagram({
  spec,
}: {
  spec: Extract<DiagramSpec, { type: "cycle" }>;
}) {
  const width = 520;
  const height = 360;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = 120;

  return (
    <DiagramFrame
      title={spec.title || "Cycle diagram"}
      subtitle={spec.cycleType === "life" ? "Life cycle" : "Process cycle"}
    >
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[28rem] rounded-xl bg-white sm:min-w-0 sm:w-full" role="img" aria-label={spec.title || "Cycle diagram"}>
        <defs>
          <marker id="cycle-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#7c3aed" />
          </marker>
        </defs>
        <rect width={width} height={height} fill="white" />
        {spec.stages.map((stage, index) => {
          const angle = (Math.PI * 2 * index) / spec.stages.length - Math.PI / 2;
          const x = centerX + radius * Math.cos(angle);
          const y = centerY + radius * Math.sin(angle);
          const nextAngle = (Math.PI * 2 * ((index + 1) % spec.stages.length)) / spec.stages.length - Math.PI / 2;
          const nextX = centerX + radius * Math.cos(nextAngle);
          const nextY = centerY + radius * Math.sin(nextAngle);

          return (
            <g key={`cycle-stage-${index}`}>
              <line
                x1={x}
                y1={y}
                x2={nextX}
                y2={nextY}
                stroke="#7c3aed"
                strokeWidth="3"
                markerEnd="url(#cycle-arrow)"
              />
              <rect x={x - 48} y={y - 18} width="96" height="36" rx="16" fill="#ede9fe" stroke="#8b5cf6" strokeWidth="2.5" />
              <text x={x} y={y + 5} textAnchor="middle" className="fill-slate-900 text-xs font-semibold">
                {stage}
              </text>
            </g>
          );
        })}
      </svg>
    </DiagramFrame>
  );
}

function DiagramRenderer({ spec }: { spec: DiagramSpec }) {
  if (spec.type === "atom") {
    return <AtomDiagram spec={spec} />;
  }
  if (spec.type === "geometry") {
    return <GeometryDiagram spec={spec} />;
  }
  if (spec.type === "cell") {
    return <CellDiagram spec={spec} />;
  }
  if (spec.type === "molecule") {
    return <MoleculeDiagram spec={spec} />;
  }
  if (spec.type === "mitosis") {
    return <MitosisDiagram spec={spec} />;
  }
  if (spec.type === "foodweb") {
    return <FoodWebDiagram spec={spec} />;
  }
  if (spec.type === "circuit") {
    return <CircuitDiagram spec={spec} />;
  }
  if (spec.type === "coordinate-plane") {
    return <CoordinatePlaneDiagram spec={spec} />;
  }
  if (spec.type === "freebody") {
    return <FreeBodyDiagram spec={spec} />;
  }
  if (spec.type === "reaction") {
    return <ReactionDiagram spec={spec} />;
  }
  return <CycleDiagram spec={spec} />;
}

function buildCuratedImageLinks(query: string) {
  const encoded = encodeURIComponent(query);

  return [
    {
      label: "Wikimedia Commons",
      href: `https://commons.wikimedia.org/w/index.php?search=${encoded}&title=Special:MediaSearch&go=Go&type=image`,
    },
    {
      label: "Wikipedia",
      href: `https://en.wikipedia.org/w/index.php?search=${encoded}`,
    },
    {
      label: "Britannica",
      href: `https://www.britannica.com/search?query=${encoded}`,
    },
  ];
}

function ImageSearchCard({ spec }: { spec: ImageSearchSpec }) {
  const links = buildCuratedImageLinks(spec.query);

  return (
    <div className="mt-4 rounded-[1.6rem] border border-[#d0a95b]/24 bg-[linear-gradient(180deg,_rgba(66,48,18,0.92)_0%,_rgba(37,28,14,0.98)_100%)] p-4 shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[#f7ebc8]">
            {spec.title || "Reference image search"}
          </p>
          <p className="mt-1 text-xs text-[#f3e4bd]">
            {spec.reason ||
              "The tutor chose trusted references because this visual is better shown as an external image."}
          </p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#f1d392]">
          Reference
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        {links.map((link) => (
          <a
            key={link.label}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className="rounded-2xl border border-[#d0a95b]/30 bg-white/10 px-4 py-2 text-sm font-medium text-[#fff3d3] transition hover:bg-white/16"
          >
            {link.label}
          </a>
        ))}
      </div>
    </div>
  );
}

function TutorAnswer({ answer }: { answer: string }) {
  const segments = splitAnswerSegments(answer);

  return (
    <div className="space-y-4">
      {segments.map((segment, index) => {
        if (segment.type === "graph") {
          const spec = parseGraphSpec(segment.content);
          if (!spec) {
            return (
              <pre
                key={`graph-${index}`}
                className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.05] p-4 text-sm text-[#d6cdea]"
              >
                {segment.content}
              </pre>
            );
          }

          return <FunctionGraph key={`graph-${index}`} spec={spec} />;
        }

        if (segment.type === "diagram") {
          const spec = parseDiagramSpec(segment.content);
          if (!spec) {
            return (
              <pre
                key={`diagram-${index}`}
                className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.05] p-4 text-sm text-[#d6cdea]"
              >
                {segment.content}
              </pre>
            );
          }

          return <DiagramRenderer key={`diagram-${index}`} spec={spec} />;
        }

        if (segment.type === "image-search") {
          const spec = parseImageSearchSpec(segment.content);
          if (!spec) {
            return (
              <pre
                key={`image-search-${index}`}
                className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.05] p-4 text-sm text-[#d6cdea]"
              >
                {segment.content}
              </pre>
            );
          }

          return <ImageSearchCard key={`image-search-${index}`} spec={spec} />;
        }

        return (
          <div
            key={`text-${index}`}
            className="space-y-2"
          >
            {renderTutorTextBlock(segment.content)}
          </div>
        );
      })}
    </div>
  );
}

function ConversationMessage({
  message,
  onSetCheckpoint,
  onResetToCheckpoint,
  checkpointSavingId,
  checkpointResettingId,
}: {
  message: TutorHistoryMessage;
  onSetCheckpoint: (messageId: number) => void;
  onResetToCheckpoint: (messageId: number) => void;
  checkpointSavingId: number | null;
  checkpointResettingId: number | null;
}) {
  const isAssistant = message.role === "assistant";
  const isSystem = message.role === "system";

  let containerClasses = "rounded-2xl border p-4 ";
  let labelClasses = "text-xs font-semibold uppercase tracking-[0.18em] ";

  if (isAssistant) {
    containerClasses +=
      "border-[#6d5b8d]/35 bg-[linear-gradient(180deg,_rgba(44,34,74,0.94)_0%,_rgba(27,21,46,0.98)_100%)] shadow-[0_16px_40px_rgba(0,0,0,0.2)]";
    labelClasses += "text-[#d8b66d]";
  } else if (isSystem) {
    containerClasses +=
      "border-[#7a6a4f]/35 bg-[linear-gradient(180deg,_rgba(55,45,27,0.92)_0%,_rgba(35,28,18,0.98)_100%)] shadow-[0_16px_40px_rgba(0,0,0,0.2)]";
    labelClasses += "text-[#f1d392]";
  } else {
    containerClasses +=
      "border-white/10 bg-white/[0.05] shadow-[0_16px_40px_rgba(0,0,0,0.16)]";
    labelClasses += "text-[#c8bfd9]";
  }

  return (
    <div className={containerClasses}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className={labelClasses}>
            {isAssistant ? "Tutor" : isSystem ? "System" : "You"}
          </p>
          {message.is_checkpoint && (
            <span className="mt-2 inline-flex rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-100">
              Saved checkpoint
            </span>
          )}
        </div>

        {isAssistant && (
          <div className="flex flex-col gap-2 sm:items-end">
            <button
              type="button"
              onClick={() => onSetCheckpoint(message.id)}
              disabled={checkpointSavingId === message.id || checkpointResettingId === message.id}
              className="rounded-full border border-[#d0a95b]/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-[#f7ebc8] transition hover:bg-white/16 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {checkpointSavingId === message.id
                ? "Saving checkpoint..."
                : message.is_checkpoint
                ? "Checkpoint saved"
                : "Set checkpoint"}
            </button>
            {message.is_checkpoint && (
              <button
                type="button"
                onClick={() => onResetToCheckpoint(message.id)}
                disabled={checkpointResettingId === message.id || checkpointSavingId === message.id}
                className="rounded-full border border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/16 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {checkpointResettingId === message.id
                  ? "Resetting..."
                  : "Reset to this checkpoint"}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="mt-2">
        {isAssistant || isSystem ? (
          <TutorAnswer answer={message.content} />
        ) : (
          <p className="whitespace-pre-wrap text-[#ede7f7]">{message.content}</p>
        )}
      </div>
    </div>
  );
}
