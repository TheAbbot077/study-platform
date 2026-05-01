from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase

from accounts.models import User
from knowledge.models import Concept, DocumentChunk
from uploads.models import Document, Subject
from uploads.services import (
    _build_document_sections,
    _filter_extracted_data,
    _sample_document_for_extraction,
    get_embeddings,
    process_document,
    rebuild_subject_from_documents,
)


class UploadAPISmokeTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="learner",
            email="learner@example.com",
            password="testpass123",
        )
        self.other_user = User.objects.create_user(
            username="other",
            email="other@example.com",
            password="testpass123",
        )
        self.client.force_login(self.user)

    def test_subject_create_creates_subject_for_authenticated_user(self):
        response = self.client.post(
            "/api/uploads/subjects/",
            data={"name": "Biology"},
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["name"], "Biology")
        self.assertTrue(
            Subject.objects.filter(user=self.user, name="Biology").exists()
        )

    @patch("uploads.views.process_document_task.delay")
    def test_upload_to_syllabus_flow_lists_topics_for_selected_subject(
        self,
        mock_delay,
    ):
        subject = Subject.objects.create(user=self.user, name="Biology")

        upload_response = self.client.post(
            "/api/uploads/upload/",
            data={
                "title": "Biology Notes",
                "subject": subject.id,
                "file": SimpleUploadedFile("biology.pdf", b"pdf-content"),
            },
        )

        self.assertEqual(upload_response.status_code, 201)
        document = Document.objects.get(id=upload_response.json()["id"])
        mock_delay.assert_called_once_with(document.id)

        with patch("uploads.services.extract_text_from_pdf", return_value="1. Cells\nCells are basic units.\n2. Energy\nEnergy supports life."), patch(
            "uploads.services.get_embeddings",
            return_value=[[0.0] * 1536, [0.0] * 1536],
        ), patch(
            "uploads.services.extract_concepts_and_relationships",
            return_value={
                "concepts": [
                    {"name": "Cells", "description": "Basic units of life."},
                    {"name": "Energy", "description": "Supports biological processes."},
                ],
                "relationships": [
                    {"from": "Cells", "to": "Energy", "type": "PREREQ"},
                ],
            },
        ):
            process_document(document)

        document.refresh_from_db()
        self.assertEqual(document.status, "ready")

        concepts_response = self.client.get(
            f"/api/knowledge/concepts/?subject={subject.id}"
        )

        self.assertEqual(concepts_response.status_code, 200)
        payload = concepts_response.json()
        self.assertEqual(
            [item["name"] for item in payload],
            ["Biology Notes", "Cells", "Energy"],
        )
        self.assertEqual(payload[0]["node_type"], "CHAPTER")
        self.assertEqual(payload[1]["node_type"], "CONCEPT")
        self.assertEqual(payload[1]["parent_id"], payload[0]["id"])
        self.assertEqual(payload[1]["difficulty_stage"], "FOUNDATION")
        self.assertEqual(payload[2]["prerequisites"], ["Cells"])

    def test_document_list_only_returns_authenticated_users_documents(self):
        subject = Subject.objects.create(user=self.user, name="Physics")
        other_subject = Subject.objects.create(user=self.other_user, name="Chemistry")

        Document.objects.create(
            user=self.user,
            subject=subject,
            title="My notes",
            file=SimpleUploadedFile("notes.pdf", b"pdf-content"),
            status="ready",
        )
        Document.objects.create(
            user=self.other_user,
            subject=other_subject,
            title="Other notes",
            file=SimpleUploadedFile("other.pdf", b"pdf-content"),
            status="ready",
        )

        response = self.client.get("/api/uploads/documents/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]["title"], "My notes")
        self.assertEqual(payload[0]["subject"]["name"], "Physics")

    @patch("uploads.views.rebuild_subject_from_documents")
    def test_subject_rebuild_only_allows_owned_subject(self, mock_rebuild):
        subject = Subject.objects.create(user=self.user, name="Biology")
        other_subject = Subject.objects.create(user=self.other_user, name="Chemistry")
        mock_rebuild.return_value = {
            "subject_id": subject.id,
            "subject_name": subject.name,
            "documents_seen": 1,
            "documents_processed": 1,
            "concept_count": 3,
        }

        response = self.client.post(f"/api/uploads/subjects/{subject.id}/rebuild/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["subject_name"], "Biology")
        mock_rebuild.assert_called_once_with(subject)

        forbidden = self.client.post(f"/api/uploads/subjects/{other_subject.id}/rebuild/")
        self.assertEqual(forbidden.status_code, 404)


class UploadReliabilityTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="upload-learner",
            email="upload@example.com",
            password="testpass123",
        )
        self.subject = Subject.objects.create(user=self.user, name="Chemistry")

    @patch("uploads.services.extract_concepts_and_relationships")
    @patch("uploads.services.get_embeddings")
    @patch("uploads.services.extract_text_from_pdf")
    def test_process_document_marks_failed_when_no_topics_extracted(
        self,
        mock_extract_text,
        mock_get_embeddings,
        mock_extract_concepts,
    ):
        document = Document.objects.create(
            user=self.user,
            subject=self.subject,
            title="Empty Topics",
            file=SimpleUploadedFile("notes.pdf", b"pdf-content"),
            status="uploaded",
        )
        mock_extract_text.return_value = "Readable content but no structured topics."
        mock_get_embeddings.return_value = [[0.0] * 1536]
        mock_extract_concepts.return_value = {
            "concepts": [],
            "relationships": [],
        }

        process_document(document)
        document.refresh_from_db()

        self.assertEqual(document.status, "failed")
        self.assertIn("No study topics could be extracted", document.processing_error)

    @patch("uploads.services.client.embeddings.create")
    def test_get_embeddings_returns_vectors_in_input_order(self, mock_create):
        mock_create.return_value = type(
            "EmbeddingResponse",
            (),
            {
                "data": [
                    type("EmbeddingItem", (), {"embedding": [1.0, 0.0]})(),
                    type("EmbeddingItem", (), {"embedding": [0.0, 1.0]})(),
                ]
            },
        )()

        embeddings = get_embeddings(["first chunk", "second chunk"])

        self.assertEqual(embeddings, [[1.0, 0.0], [0.0, 1.0]])
        mock_create.assert_called_once()

    @patch("uploads.services.extract_concepts_and_relationships")
    @patch("uploads.services.get_embeddings")
    @patch("uploads.services.extract_text_from_pdf")
    def test_process_document_bulk_creates_all_chunks(
        self,
        mock_extract_text,
        mock_get_embeddings,
        mock_extract_concepts,
    ):
        document = Document.objects.create(
            user=self.user,
            subject=self.subject,
            title="Chunked Notes",
            file=SimpleUploadedFile("notes.pdf", b"pdf-content"),
            status="uploaded",
        )
        mock_extract_text.return_value = "A" * 1200
        mock_get_embeddings.return_value = [[0.0] * 1536] * 3
        mock_extract_concepts.return_value = {
            "concepts": [{"name": "Atoms", "description": "Basic units of matter."}],
            "relationships": [],
        }

        process_document(document)
        document.refresh_from_db()

        self.assertEqual(document.status, "ready")
        self.assertEqual(DocumentChunk.objects.filter(document=document).count(), 3)
        self.assertEqual(mock_get_embeddings.call_count, 1)

    @patch("uploads.services.extract_concepts_and_relationships")
    @patch("uploads.services.get_embeddings")
    @patch("uploads.services.extract_text_from_pdf")
    def test_process_document_processes_all_sections_in_single_run(
        self,
        mock_extract_text,
        mock_get_embeddings,
        mock_extract_concepts,
    ):
        document = Document.objects.create(
            user=self.user,
            subject=self.subject,
            title="Biology Book",
            file=SimpleUploadedFile("biology.pdf", b"pdf-content"),
            status="uploaded",
        )
        mock_extract_text.return_value = """
        Chapter 1 Chemistry of Life
        Atoms, molecules, water, and carbon form the basis of life.

        Chapter 2 Cell Structure
        Cells have membranes, organelles, and transport systems.
        """
        mock_get_embeddings.return_value = [[0.0] * 1536, [0.0] * 1536]
        mock_extract_concepts.side_effect = [
            {
                "chapter": {
                    "title": "Chapter 1 Chemistry of Life",
                    "summary": "Foundational chemistry ideas.",
                },
                "concepts": [
                    {
                        "name": "Atoms",
                        "description": "Basic units of matter.",
                        "subtopics": [],
                    }
                ],
                "relationships": [],
            },
            {
                "chapter": {
                    "title": "Chapter 2 Cell Structure",
                    "summary": "Introduces core cell parts.",
                },
                "concepts": [
                    {
                        "name": "Cell Membrane",
                        "description": "Boundary around the cell.",
                        "subtopics": [],
                    }
                ],
                "relationships": [],
            },
        ]

        process_document(document)
        document.refresh_from_db()

        self.assertEqual(document.status, "ready")
        self.assertEqual(document.sections.count(), 2)
        self.assertEqual(mock_extract_concepts.call_count, 2)
        self.assertTrue(
            Concept.objects.filter(subject=self.subject, name="Chapter 1 Chemistry of Life").exists()
        )
        self.assertTrue(
            Concept.objects.filter(subject=self.subject, name="Chapter 2 Cell Structure").exists()
        )

    @patch("uploads.services.save_extracted_concepts")
    @patch("uploads.services.extract_concepts_and_relationships")
    @patch("uploads.services.extract_text_from_pdf")
    def test_rebuild_subject_from_documents_continues_after_bad_document(
        self,
        mock_extract_text,
        mock_extract_concepts,
        mock_save_extracted,
    ):
        first_doc = Document.objects.create(
            user=self.user,
            subject=self.subject,
            title="Broken PDF",
            file=SimpleUploadedFile("broken.pdf", b"pdf-content"),
            status="ready",
        )
        second_doc = Document.objects.create(
            user=self.user,
            subject=self.subject,
            title="Good PDF",
            file=SimpleUploadedFile("good.pdf", b"pdf-content"),
            status="ready",
        )

        mock_extract_text.side_effect = ["", "Topic content about atoms and molecules."]
        mock_extract_concepts.return_value = {
            "concepts": [{"name": "Atoms", "description": "Basic units of matter."}],
            "relationships": [],
        }
        mock_save_extracted.return_value = {"concept_count": 1, "relationship_count": 0}

        result = rebuild_subject_from_documents(self.subject)
        first_doc.refresh_from_db()
        second_doc.refresh_from_db()

        self.assertEqual(result["documents_seen"], 2)
        self.assertEqual(result["documents_processed"], 1)
        self.assertEqual(result["documents_failed"], 1)
        self.assertEqual(first_doc.status, "failed")
        self.assertEqual(second_doc.status, "ready")
        self.assertEqual(len(result["failed_documents"]), 1)
        self.assertEqual(result["failed_documents"][0]["title"], "Broken PDF")

    @patch("uploads.services.extract_concepts_and_relationships")
    @patch("uploads.services.extract_text_from_pdf")
    def test_rebuild_subject_from_documents_returns_zero_counts_for_empty_subject(
        self,
        mock_extract_text,
        mock_extract_concepts,
    ):
        result = rebuild_subject_from_documents(self.subject)

        self.assertEqual(result["documents_seen"], 0)
        self.assertEqual(result["documents_processed"], 0)
        self.assertEqual(result["documents_failed"], 0)
        self.assertEqual(result["concept_count"], 0)
        mock_extract_text.assert_not_called()
        mock_extract_concepts.assert_not_called()

    def test_sample_document_for_extraction_skips_front_matter_and_covers_later_sections(self):
        text = "\n\n".join(
            [
                "Acknowledgements\nThanks to everyone who helped shape this book.",
                "Foreword\nThis edition reflects years of classroom teaching.",
                "Chapter 1 Chemistry of Life\nAtoms, elements, water, and macromolecules." * 10,
                "Chapter 12 Cell Communication\nSignal transduction and receptors." * 10,
                "Chapter 24 Natural Selection\nEvolution and population genetics." * 10,
                "Chapter 35 Plant Structure and Growth\nRoots, shoots, transport, and tissues." * 10,
            ]
        )

        sample = _sample_document_for_extraction(text, max_chars=3000)

        self.assertNotIn("Acknowledgements", sample)
        self.assertNotIn("Foreword", sample)
        self.assertIn("Chapter 1 Chemistry of Life", sample)
        self.assertIn("Chapter 24 Natural Selection", sample)
        self.assertIn("Chapter 35 Plant Structure and Growth", sample)

    def test_filter_extracted_data_removes_front_matter_concepts_and_orphaned_relationships(self):
        extracted_data = {
            "concepts": [
                {"name": "Acknowledgements", "description": "Thanks and credits."},
                {"name": "Atomic Structure", "description": "Protons, neutrons, and electrons."},
                {"name": "Cell Membranes", "description": "Selective barriers around cells."},
            ],
            "relationships": [
                {"from": "Acknowledgements", "to": "Atomic Structure", "type": "RELATED"},
                {"from": "Atomic Structure", "to": "Cell Membranes", "type": "RELATED"},
            ],
        }

        filtered = _filter_extracted_data(extracted_data)

        self.assertEqual(
            filtered["concepts"],
            [
                {
                    "name": "Atomic Structure",
                    "description": "Protons, neutrons, and electrons.",
                },
                {
                    "name": "Cell Membranes",
                    "description": "Selective barriers around cells.",
                },
            ],
        )
        self.assertEqual(
            filtered["relationships"],
            [
                {
                    "from": "Atomic Structure",
                    "to": "Cell Membranes",
                    "type": "RELATED",
                }
            ],
        )

    def test_build_document_sections_prefers_real_chapters_over_front_matter(self):
        text = """
        Acknowledgements
        Thank you to the reviewers.

        Foreword
        This edition improves explanations.

        Chapter 1 Chemistry of Life
        Atoms, molecules, water, and carbon chemistry explained in detail.

        Chapter 2 Cell Structure
        Organelles, membranes, transport, and microscopy explained in detail.
        """

        sections = _build_document_sections(text, fallback_title="AP Biology")

        self.assertEqual(len(sections), 2)
        self.assertEqual(sections[0]["title"], "Chapter 1 Chemistry of Life")
        self.assertEqual(sections[1]["title"], "Chapter 2 Cell Structure")
