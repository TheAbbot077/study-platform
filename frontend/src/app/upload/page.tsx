"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";

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
  created_at: string;
  subject: {
    id: number;
    name: string;
  } | null;
};

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

export default function UploadPage() {
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
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [uploadedDocuments, setUploadedDocuments] = useState<UploadResponse[]>([]);

  const hasProcessingDocuments = useMemo(() => {
    return documents.some(
      (doc) => doc.status === "uploaded" || doc.status === "processing"
    );
  }, [documents]);

  async function loadSubjects() {
    try {
      setLoadingSubjects(true);
      const result = await apiFetch("/api/uploads/subjects/");
      setSubjects(Array.isArray(result) ? result : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingSubjects(false);
    }
  }

  async function loadDocuments() {
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
  }

  useEffect(() => {
    loadSubjects();
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [subjectId]);

  useEffect(() => {
    if (!hasProcessingDocuments) return;

    const interval = setInterval(() => {
      loadDocuments();
    }, 4000);

    return () => clearInterval(interval);
  }, [hasProcessingDocuments, subjectId]);

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
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-16">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Upload study documents</h1>
            <p className="mt-2 text-sm text-gray-600">
              Add one or many study files and attach them to a subject.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/subjects"
              className="rounded-2xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100"
            >
              Subjects
            </Link>
            <Link
              href="/progress"
              className="rounded-2xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100"
            >
              Progress
            </Link>
          </div>
        </div>

        <div className="rounded-3xl border border-gray-200 bg-white p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Subject
              </label>

              {loadingSubjects ? (
                <p className="text-sm text-gray-500">Loading subjects...</p>
              ) : subjects.length === 0 ? (
                <div className="rounded-2xl bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
                  No subjects yet.{" "}
                  <Link href="/subjects" className="font-semibold underline">
                    Create a subject first
                  </Link>
                  .
                </div>
              ) : (
                <select
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  className="w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none focus:border-gray-500"
                >
                  <option value="">No subject</option>
                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Title prefix
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none focus:border-gray-500"
                placeholder="e.g. Biology notes"
                required
              />
              <p className="mt-2 text-xs text-gray-500">
                For multiple files, the file name will be added automatically.
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Choose files
              </label>
              <input
                type="file"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
                className="w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900"
                required
              />

              {files.length > 0 && (
                <div className="mt-3 rounded-2xl bg-gray-50 p-4">
                  <p className="text-sm font-medium text-gray-700">
                    {files.length} file{files.length === 1 ? "" : "s"} selected
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-gray-600">
                    {files.map((file) => (
                      <li key={file.name}>{file.name}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {error && (
              <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            )}

            {successMessage && (
              <p className="rounded-2xl bg-green-50 px-4 py-3 text-sm text-green-700">
                {successMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || loadingSubjects}
              className="w-full rounded-2xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Uploading..." : files.length > 1 ? "Upload documents" : "Upload document"}
            </button>
          </form>
        </div>

        {uploadedDocuments.length > 0 && (
          <div className="rounded-3xl border border-blue-200 bg-blue-50 p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-blue-950">Upload queued</h2>
            <p className="mt-3 text-sm text-blue-900">
              Your files were uploaded successfully and are being processed in the background.
            </p>

            <div className="mt-4 space-y-2">
              {uploadedDocuments.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between rounded-2xl bg-white px-4 py-3"
                >
                  <span className="text-sm font-medium text-gray-900">{doc.title}</span>
                  <StatusBadge status={doc.status} />
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => router.push("/tutor")}
                className="rounded-2xl bg-blue-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
              >
                Start studying
              </button>

              <button
                type="button"
                onClick={() => router.push("/progress")}
                className="rounded-2xl border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-900 transition hover:bg-blue-100"
              >
                View progress
              </button>
            </div>
          </div>
        )}

        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Document processing status</h2>
              <p className="mt-2 text-sm text-gray-600">
                Background processing updates automatically while files are being prepared.
              </p>
            </div>

            <button
              type="button"
              onClick={loadDocuments}
              className="rounded-2xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100"
            >
              Refresh
            </button>
          </div>

          {loadingDocuments ? (
            <p className="mt-4 text-sm text-gray-600">Loading documents...</p>
          ) : documents.length === 0 ? (
            <p className="mt-4 text-sm text-gray-600">
              No uploaded documents yet.
            </p>
          ) : (
            <div className="mt-5 space-y-3">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="rounded-2xl border border-gray-200 bg-gray-50 p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{doc.title}</h3>

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-500">
                        {doc.subject && (
                          <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-gray-700">
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
                    <p className="mt-3 text-sm text-yellow-700">
                      Your document is currently being chunked and embedded in the background.
                    </p>
                  )}

                  {doc.status === "uploaded" && (
                    <p className="mt-3 text-sm text-blue-700">
                      Upload complete. Processing should begin shortly.
                    </p>
                  )}

                  {doc.status === "ready" && (
                    <p className="mt-3 text-sm text-green-700">
                      Ready for tutoring and retrieval.
                    </p>
                  )}

                  {doc.status === "failed" && (
                    <p className="mt-3 text-sm text-red-700">
                      Processing failed for this document. You may need to re-upload it.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}