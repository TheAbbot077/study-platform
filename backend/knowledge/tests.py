from django.test import TestCase

from accounts.models import User
from knowledge.models import Concept
from knowledge.services import rebuild_subject_syllabus
from learning.models import LearnerConceptMastery
from uploads.models import Document, Subject
from uploads.services import save_extracted_concepts


class KnowledgeAPISmokeTests(TestCase):
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
        self.subject = Subject.objects.create(user=self.user, name="Biology")
        self.other_subject = Subject.objects.create(user=self.other_user, name="Physics")
        self.cells = Concept.objects.create(subject=self.subject, name="Cells")
        self.energy = Concept.objects.create(subject=self.subject, name="Energy")
        self.respiration = Concept.objects.create(subject=self.subject, name="Respiration")
        self.energy.prerequisites.add(self.cells)
        self.respiration.prerequisites.add(self.energy)
        rebuild_subject_syllabus(self.subject)
        Concept.objects.create(subject=self.other_subject, name="Motion")

        LearnerConceptMastery.objects.create(
            user=self.user,
            concept=self.cells,
            mastery_score=0.72,
            practice_count=3,
        )
        self.client.force_login(self.user)

    def test_subject_concepts_returns_mastery_state_for_owned_subject(self):
        response = self.client.get(f"/api/knowledge/concepts/?subject={self.subject.id}")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload), 3)
        self.assertEqual(payload[0]["name"], "Cells")
        self.assertEqual(payload[0]["mastery_score"], 0.72)
        self.assertEqual(payload[0]["practice_count"], 3)
        self.assertTrue(payload[0]["is_started"])
        self.assertFalse(payload[0]["is_locked"])
        self.assertEqual(payload[0]["node_type"], "CONCEPT")
        self.assertIsNone(payload[0]["parent_id"])
        self.assertEqual(payload[0]["difficulty_stage"], "FOUNDATION")
        self.assertEqual(payload[0]["order_index"], 0)
        self.assertEqual(payload[1]["name"], "Energy")
        self.assertIsNone(payload[1]["mastery_score"])
        self.assertEqual(payload[1]["practice_count"], 0)
        self.assertFalse(payload[1]["is_started"])
        self.assertFalse(payload[1]["is_locked"])
        self.assertEqual(payload[1]["difficulty_stage"], "CORE")
        self.assertEqual(payload[1]["prerequisites"], ["Cells"])
        self.assertEqual(payload[2]["name"], "Respiration")
        self.assertTrue(payload[2]["is_locked"])
        self.assertEqual(payload[2]["difficulty_stage"], "ADVANCED")
        self.assertEqual(payload[2]["blocked_by"], ["Energy"])
        self.assertEqual(payload[2]["prerequisites"], ["Energy"])

    def test_subject_concepts_hides_other_users_subject(self):
        response = self.client.get(
            f"/api/knowledge/concepts/?subject={self.other_subject.id}"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_rebuild_subject_syllabus_assigns_progressive_order_and_difficulty(self):
        cells = Concept.objects.get(id=self.cells.id)
        energy = Concept.objects.get(id=self.energy.id)
        respiration = Concept.objects.get(id=self.respiration.id)

        self.assertEqual(cells.syllabus_order, 0)
        self.assertEqual(cells.difficulty_stage, "FOUNDATION")
        self.assertEqual(energy.syllabus_order, 1)
        self.assertEqual(energy.difficulty_stage, "CORE")
        self.assertEqual(respiration.syllabus_order, 2)
        self.assertEqual(respiration.difficulty_stage, "ADVANCED")

    def test_document_structure_infers_missing_prerequisites(self):
        chemistry = Subject.objects.create(user=self.user, name="Chemistry")
        document = Document.objects.create(
            user=self.user,
            subject=chemistry,
            title="Chemistry Notes",
            file="documents/chemistry-notes.pdf",
        )

        extracted_data = {
            "concepts": [
                {"name": "Atoms", "description": "Basic units of matter."},
                {"name": "Molecules", "description": "Groups of atoms."},
                {"name": "Chemical Reactions", "description": "Changes involving molecules."},
            ],
            "relationships": [],
        }
        raw_text = """
        1. Atoms
        Atoms are the building blocks of matter.

        2. Molecules
        Molecules are formed when atoms join together.

        3. Chemical Reactions
        Chemical reactions describe how molecules change.
        """

        save_extracted_concepts(document, extracted_data, raw_text=raw_text)

        chapter = Concept.objects.get(subject=chemistry, name="Chemistry Notes")
        atoms = Concept.objects.get(subject=chemistry, name="Atoms")
        molecules = Concept.objects.get(subject=chemistry, name="Molecules")
        reactions = Concept.objects.get(subject=chemistry, name="Chemical Reactions")

        self.assertIn(atoms, molecules.prerequisites.all())
        self.assertIn(molecules, reactions.prerequisites.all())
        self.assertEqual(chapter.node_type, "CHAPTER")
        self.assertEqual(atoms.parent_id, chapter.id)
        self.assertEqual(atoms.syllabus_order, 1)
        self.assertEqual(molecules.syllabus_order, 2)
        self.assertEqual(reactions.syllabus_order, 3)

    def test_save_extracted_concepts_creates_chapter_concept_subtopic_tree(self):
        chemistry = Subject.objects.create(user=self.user, name="Organic Chemistry")
        document = Document.objects.create(
            user=self.user,
            subject=chemistry,
            title="Organic Chemistry Notes",
            file="documents/organic-chemistry.pdf",
        )

        extracted_data = {
            "chapter": {
                "title": "Chapter 1 Basic Chemistry of Life",
                "summary": "Introduces atoms, water, and carbon.",
            },
            "concepts": [
                {
                    "name": "Atoms",
                    "description": "Basic units of matter.",
                    "subtopics": [
                        {"name": "Protons", "description": "Positive particles."},
                        {"name": "Electrons", "description": "Negative particles."},
                    ],
                }
            ],
            "relationships": [],
        }

        result = save_extracted_concepts(document, extracted_data, raw_text="Atoms and particles.")

        chapter = Concept.objects.get(subject=chemistry, name="Chapter 1 Basic Chemistry of Life")
        atoms = Concept.objects.get(subject=chemistry, name="Atoms")
        protons = Concept.objects.get(subject=chemistry, name="Protons")
        electrons = Concept.objects.get(subject=chemistry, name="Electrons")

        self.assertEqual(result["concept_count"], 3)
        self.assertEqual(chapter.node_type, "CHAPTER")
        self.assertIsNone(chapter.parent_id)
        self.assertEqual(atoms.node_type, "CONCEPT")
        self.assertEqual(atoms.parent_id, chapter.id)
        self.assertEqual(protons.node_type, "SUBTOPIC")
        self.assertEqual(protons.parent_id, atoms.id)
        self.assertEqual(electrons.parent_id, atoms.id)
