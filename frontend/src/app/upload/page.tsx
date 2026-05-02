"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  FormEvent,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { apiFetch, getDisplayErrorMessage } from "../../lib/api";

type UploadResponse = {
  id: number;
  title: string;
  file: string;
  status: string;
  created_at: string;
  subject?: number | null;
};

type Subject = {
  id: number;
  name: string;
  created_at: string;
};

type DocumentListItem = {
  id: number;
  title: string;
  file: string;
  status: string;
  processing_error?: string;
  created_at: string;
  subject: {
    id: number;
    name: string;
  } | null;
};

type RebuildResult = {
  subject_name?: string;
  documents_processed?: number;
  documents_failed?: number;
  documents_skipped?: number;
  concept_count?: number;
  failed_documents?: Array<{
    document_id: number;
    title: string;
    reason: string;
  }>;
};

type ProcessingStage = "uploaded" | "processing" | "ready" | "failed";

function StatusBadge({ status }: { status: string }) {
  let classes =
    "inline-flex rounded-full px-3 py-1 text-xs font-semibold ";

  if (status === "ready") {
    classes += "bg-green-100 text-green-700";
  } else if (status === "processing") {
    classes += "bg-yellow-100 text-yellow-800";
  } else if (status === "failed") {
    classes += "bg-red-100 text-red-700";
  } else {
    classes += "bg-blue-100 text-blue-700";
  }

  return <span className={classes}>{status}</span>;
}

function getFailureMessage(doc: DocumentListItem) {
  const detail = doc.processing_error?.trim();

  if (detail) {
    return detail;
  }

  return "Processing failed for this document. Try re-uploading a text-based PDF.";
}

function getProcessingProgress(status: ProcessingStage) {
  if (status === "uploaded") {
    return 18;
  }
  if (status === "processing") {
    return 68;
  }
  return 100;
}

function ProcessingProgressCard({
  documents,
}: {
  documents: DocumentListItem[];
}) {
  const processingDocuments = documents.filter(
    (doc) => doc.status === "uploaded" || doc.status === "processing"
  );

  if (processingDocuments.length === 0) {
    return null;
  }

  const averageProgress = Math.max(
    12,
    Math.round(
      processingDocuments.reduce(
        (sum, doc) => sum + getProcessingProgress(doc.status as ProcessingStage),
        0
      ) / processingDocuments.length
    )
  );

  return (
    <div className="rounded-[2rem] border border-amber-300/20 bg-[linear-gradient(180deg,_rgba(58,42,17,0.92)_0%,_rgba(33,25,12,0.97)_100%)] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#e1bd73]">
            Processing in progress
          </p>
          <h2 className="mt-2 text-xl font-semibold text-[#fbf7ee]">
            Document is being processed, please be patient as this may take a while.
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#d4cae4]">
            Large books can take longer while Abbot Study extracts text, builds sections,
            creates embeddings, and prepares the syllabus for tutoring.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-center">
          <p className="text-2xl font-semibold text-[#f7e2a7]">{averageProgress}%</p>
          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[#d6cde8]">
            Estimated progress
          </p>
        </div>
      </div>

      <div className="mt-5 h-4 overflow-hidden rounded-full bg-white/10">
        <div
          className="relative h-full rounded-full bg-[linear-gradient(90deg,_#d09d43_0%,_#f0d79a_45%,_#d09d43_100%)] transition-all duration-700"
          style={{ width: `${averageProgress}%` }}
        >
          <div className="absolute inset-0 animate-pulse bg-white/20" />
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {processingDocuments.map((doc) => {
          const progress = getProcessingProgress(doc.status as ProcessingStage);

          return (
            <div
              key={doc.id}
              className="rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-[#fbf7ee]">{doc.title}</p>
                  <p className="mt-1 text-xs text-[#cfc6e1]">
                    {doc.status === "uploaded"
                      ? "Queued for worker pickup."
                      : "Currently being processed by the background worker."}
                  </p>
                </div>
                <StatusBadge status={doc.status} />
              </div>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,_#9dd5f3_0%,_#d09d43_100%)] transition-all duration-700"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UploadPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialSubject = searchParams.get("subject") || "";

  const [title, setTitle] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [subjectId, setSubjectId] = useState(initialSubject);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [loadingSubjects, setLoadingSubjects] = useState(true);
  const [loadingDocuments, setLoadingDocuments] = useState(true);
  const [loading, setLoading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [uploadedDocuments, setUploadedDocuments] = useState<UploadResponse[]>([]);

  const hasProcessingDocuments = useMemo(() => {
    return documents.some(
      (doc) => doc.status === "uploaded" || doc.status === "processing"
    );
  }, [documents]);

  const loadSubjects = useCallback(async () => {
    try {
      setLoadingSubjects(true);
      const result = await apiFetch("/api/uploads/subjects/");
      setSubjects(Array.isArray(result) ? result : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingSubjects(false);
    }
  }, []);

  const loadDocuments = useCallback(async () => {
    try {
      setLoadingDocuments(true);

      const url = subjectId
        ? `/api/uploads/documents/?subject=${encodeURIComponent(subjectId)}`
        : "/api/uploads/documents/";

      const result = await apiFetch(url);
      setDocuments(Array.isArray(result) ? result : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingDocuments(false);
    }
  }, [subjectId]);

  useEffect(() => {
    loadSubjects();
  }, [loadSubjects]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    if (!hasProcessingDocuments) return;

    const interval = setInterval(() => {
      loadDocuments();
    }, 4000);

    return () => clearInterval(interval);
  }, [hasProcessingDocuments, loadDocuments]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!title.trim()) {
      setError("Please enter a document title prefix.");
      return;
    }

    if (files.length === 0) {
      setError("Please choose at least one file to upload.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      setSuccessMessage("");
      setUploadedDocuments([]);

      const results: UploadResponse[] = [];

      for (const file of files) {
        const formData = new FormData();

        const fileTitle =
          files.length === 1
            ? title
            : `${title} - ${file.name.replace(/\.[^/.]+$/, "")}`;

        formData.append("title", fileTitle);
        formData.append("file", file);

        if (subjectId) {
          formData.append("subject", subjectId);
        }

        const result = await apiFetch("/api/uploads/upload/", {
          method: "POST",
          body: formData,
        });

        results.push(result as UploadResponse);
      }

      setUploadedDocuments(results);
      setSuccessMessage(
        results.length === 1
          ? "Document uploaded and queued for background processing."
          : `${results.length} documents uploaded and queued for background processing.`
      );

      setTitle("");
      setFiles([]);
      await loadDocuments();
    } catch (err) {
      console.error(err);
      setError(
        getDisplayErrorMessage(
          err,
          "Upload failed. Please try again with a supported document."
        )
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleRebuildSyllabus() {
    if (!subjectId) {
      setError("Choose a subject before rebuilding its syllabus.");
      return;
    }

    try {
      setRebuilding(true);
      setError("");
      setSuccessMessage("");

      const result = (await apiFetch(`/api/uploads/subjects/${subjectId}/rebuild/`, {
        method: "POST",
      })) as RebuildResult;

      const processed =
        typeof result?.documents_processed === "number"
          ? result.documents_processed
          : 0;
      const failed =
        typeof result?.documents_failed === "number"
          ? result.documents_failed
          : 0;
      const skipped =
        typeof result?.documents_skipped === "number"
          ? result.documents_skipped
          : 0;
      const conceptCount =
        typeof result?.concept_count === "number" ? result.concept_count : 0;

      setSuccessMessage(
        `Syllabus rebuilt for ${result?.subject_name || "this subject"}. ` +
          `${processed} document${processed === 1 ? "" : "s"} reprocessed and ` +
          `${conceptCount} topic${conceptCount === 1 ? "" : "s"} sequenced.` +
          (failed > 0
            ? ` ${failed} document${failed === 1 ? "" : "s"} failed during rebuild.`
            : "") +
          (skipped > 0
            ? ` ${skipped} document${skipped === 1 ? "" : "s"} skipped.`
            : "")
      );

      if (result?.failed_documents?.length) {
        setError(
          result.failed_documents
            .map((item) => `${item.title}: ${item.reason}`)
            .join(" ")
        );
      }

      await loadDocuments();
    } catch (err) {
      console.error(err);
      setError(
        getDisplayErrorMessage(
          err,
          "Syllabus rebuild failed. Please try again in a moment."
        )
      );
    } finally {
      setRebuilding(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#120f23] px-4 py-8 text-[#fbf7ee] sm:px-6 sm:py-12">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(214,169,78,0.16),_transparent_24%),radial-gradient(circle_at_bottom_right,_rgba(82,59,142,0.28),_transparent_32%)]" />
      <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:42px_42px]" />

      <div className="relative mx-auto max-w-6xl space-y-6">
        <section className="rounded-[2rem] border border-[#d0a95b]/20 bg-[#18132d]/90 px-6 py-8 shadow-[0_30px_90px_rgba(0,0,0,0.35)] backdrop-blur-sm">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <div>
              <div className="inline-flex rounded-full border border-[#d0a95b]/35 bg-[#231a3d] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#e5c57d]">
                Upload Center
              </div>
              <h1 className="mt-5 text-4xl font-semibold tracking-tight text-[#fbf7ee] sm:text-5xl">
                Add materials to a subject and let Abbot Study prepare the learning path.
              </h1>
              <p className="mt-5 max-w-3xl text-sm leading-7 text-[#cbc2df] sm:text-base">
                Upload one or many files, attach them to the right subject, and rebuild
                the syllabus whenever you want the latest extraction and sequencing logic.
              </p>
            </div>

            <div className="rounded-[1.75rem] border border-[#d0a95b]/20 bg-[linear-gradient(180deg,_rgba(36,27,61,0.95)_0%,_rgba(23,18,41,0.95)_100%)] p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d8b66d]">
                Upload flow
              </p>
              <ol className="mt-5 space-y-4 text-sm text-[#d0c7e3]">
                <li className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  1. Choose the subject these materials belong to.
                </li>
                <li className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  2. Upload one file or a small batch with a clear title prefix.
                </li>
                <li className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  3. Let processing complete, then rebuild the syllabus if needed.
                </li>
                <li className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  4. Open the subject progress page and begin topic-by-topic study.
                </li>
              </ol>
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <section className="rounded-[2rem] border border-[#d0a95b]/20 bg-[#19142d]/92 p-8 shadow-[0_24px_70px_rgba(0,0,0,0.3)] backdrop-blur-sm">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#ddb86c]">
                  New upload
                </p>
                <h2 className="mt-3 text-2xl font-semibold text-[#fbf7ee]">
                  Upload study documents
                </h2>
                <p className="mt-2 text-sm text-[#beb5d3]">
                  Add one or many study files and attach them to a subject.
                </p>
              </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#d6cde7]">
                Subject
              </label>

              {loadingSubjects ? (
                <p className="text-sm text-[#bdb4d2]">Loading subjects...</p>
              ) : subjects.length === 0 ? (
                <div className="rounded-2xl border border-amber-300/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  No subjects yet.{" "}
                  <Link href="/subjects" className="font-semibold underline">
                    Create a subject first
                  </Link>
                  .
                </div>
              ) : (
                <div className="space-y-3">
                  <select
                    value={subjectId}
                    onChange={(e) => setSubjectId(e.target.value)}
                    className="w-full rounded-2xl border border-[#564775] bg-[#17122b] px-4 py-3 text-sm text-[#fbf7ee] outline-none focus:border-[#d0a95b]"
                  >
                    <option value="">No subject</option>
                    {subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>

                  <div className="rounded-2xl border border-[#6f5fb0]/30 bg-[#20193b] p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-[#f4dfae]">
                          Rebuild syllabus
                        </p>
                        <p className="mt-1 text-sm text-[#c6bdd9]">
                          Re-read existing documents for the selected subject and regenerate its topics, prerequisites, and study order.
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={!subjectId || rebuilding}
                        onClick={handleRebuildSyllabus}
                        className="rounded-2xl bg-[#caa04f] px-4 py-2 text-sm font-semibold text-[#20183b] transition hover:bg-[#e0b86a] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {rebuilding ? "Rebuilding..." : "Rebuild syllabus"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#d6cde7]">
                Title prefix
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-2xl border border-[#564775] bg-[#17122b] px-4 py-3 text-sm text-[#fbf7ee] outline-none focus:border-[#d0a95b]"
                placeholder="e.g. Biology notes"
                required
              />
              <p className="mt-2 text-xs text-[#9e94b7]">
                For multiple files, the file name will be added automatically.
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#d6cde7]">
                Choose files
              </label>
              <input
                type="file"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
                className="w-full rounded-2xl border border-[#564775] bg-[#17122b] px-4 py-3 text-sm text-[#fbf7ee] file:mr-4 file:rounded-xl file:border-0 file:bg-[#caa04f] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-[#20183b]"
                required
              />

              {files.length > 0 && (
                <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-sm font-medium text-[#f4dfae]">
                    {files.length} file{files.length === 1 ? "" : "s"} selected
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-[#c6bdd9]">
                    {files.map((file) => (
                      <li key={file.name}>{file.name}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {error && (
              <p className="rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </p>
            )}

            {successMessage && (
              <p className="rounded-2xl border border-emerald-300/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                {successMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || loadingSubjects}
              className="w-full rounded-2xl bg-[#caa04f] px-4 py-3 text-sm font-semibold text-[#20183b] transition hover:bg-[#e0b86a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Uploading..." : files.length > 1 ? "Upload documents" : "Upload document"}
            </button>
          </form>
          </section>

          <section className="space-y-6">
        <ProcessingProgressCard documents={documents} />

        {uploadedDocuments.length > 0 && (
          <div className="rounded-[2rem] border border-sky-300/20 bg-[linear-gradient(180deg,_rgba(26,54,87,0.92)_0%,_rgba(17,36,59,0.94)_100%)] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
            <h2 className="text-xl font-semibold text-[#eef6ff]">Upload queued</h2>
            <p className="mt-3 text-sm text-sky-100">
              Your files were uploaded successfully and are being processed in the background.
            </p>

            <div className="mt-4 space-y-2">
              {uploadedDocuments.map((doc) => (
                <div
                  key={doc.id}
                  className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="text-sm font-medium text-[#fbf7ee]">{doc.title}</span>
                  <StatusBadge status={doc.status} />
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => router.push("/tutor")}
                className="rounded-2xl bg-[#caa04f] px-4 py-2 text-sm font-semibold text-[#20183b] transition hover:bg-[#e0b86a]"
              >
                Start studying
              </button>

              <button
                type="button"
                onClick={() => router.push("/progress")}
                className="rounded-2xl border border-sky-300/30 bg-white/10 px-4 py-2 text-sm font-semibold text-sky-100 transition hover:bg-white/15"
              >
                View progress
              </button>
            </div>
          </div>
        )}

        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-[0_18px_48px_rgba(0,0,0,0.22)] backdrop-blur-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-[#fbf7ee]">Document processing status</h2>
              <p className="mt-2 text-sm text-[#c6bdd9]">
                Background processing updates automatically while files are being prepared.
              </p>
            </div>

            <button
              type="button"
              onClick={loadDocuments}
              className="rounded-2xl border border-[#6d5b8d] bg-[#1b1530] px-4 py-2 text-sm font-semibold text-[#f2dfb0] transition hover:bg-[#251d43] sm:self-auto"
            >
              Refresh
            </button>
          </div>

          {loadingDocuments ? (
            <p className="mt-4 text-sm text-[#c6bdd9]">Loading documents...</p>
          ) : documents.length === 0 ? (
            <p className="mt-4 text-sm text-[#c6bdd9]">
              No uploaded documents yet.
            </p>
          ) : (
            <div className="mt-5 space-y-3">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="rounded-2xl border border-white/10 bg-[#1b1530] p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-[#fbf7ee]">{doc.title}</h3>

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#a79dbf]">
                        {doc.subject && (
                          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-[#d4cbe6]">
                            {doc.subject.name}
                          </span>
                        )}
                        <span>
                          Uploaded: {new Date(doc.created_at).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <StatusBadge status={doc.status} />
                  </div>

                  {doc.status === "processing" && (
                    <div className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-500/10 p-4">
                      <p className="text-sm font-semibold text-amber-100">
                        Document is being processed, please be patient as this may take a while.
                      </p>
                      <p className="mt-1 text-sm text-amber-200">
                        Your document is currently being chunked, embedded, and prepared for syllabus extraction.
                      </p>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full w-[68%] rounded-full bg-[linear-gradient(90deg,_#d09d43_0%,_#f0d79a_100%)] animate-pulse" />
                      </div>
                    </div>
                  )}

                  {doc.status === "uploaded" && (
                    <div className="mt-3 rounded-2xl border border-sky-300/20 bg-sky-500/10 p-4">
                      <p className="text-sm font-semibold text-sky-100">
                        Document is being processed, please be patient as this may take a while.
                      </p>
                      <p className="mt-1 text-sm text-sky-200">
                        Upload complete. The background worker should begin processing shortly.
                      </p>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full w-[18%] rounded-full bg-[linear-gradient(90deg,_#78c5ff_0%,_#d09d43_100%)] animate-pulse" />
                      </div>
                    </div>
                  )}

                  {doc.status === "ready" && (
                    <p className="mt-3 text-sm text-emerald-200">
                      Ready for tutoring and retrieval.
                    </p>
                  )}

                  {doc.status === "failed" && (
                    <div className="mt-3 rounded-2xl border border-red-300/20 bg-red-500/10 p-3">
                      <p className="text-sm font-semibold text-red-100">
                        Processing failed
                      </p>
                      <p className="mt-1 text-sm text-red-200">
                        {getFailureMessage(doc)}
                      </p>
                      {doc.subject && (
                        <p className="mt-2 text-xs text-red-200">
                          You can fix the file and re-upload it, or use{" "}
                          <span className="font-semibold">Rebuild syllabus</span> after improving the subject documents.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
          </section>
        </div>
      </div>
    </main>
  );
}

export default function UploadPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-100" />}>
      <UploadPageContent />
    </Suspense>
  );
}
