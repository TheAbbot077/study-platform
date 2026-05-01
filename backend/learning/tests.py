from django.test import TestCase
from django.utils import timezone

from accounts.models import User
from knowledge.models import Concept
from learning.models import LearnerConceptEvent, LearnerConceptMastery
from learning.services import (
    apply_concept_check_score,
    apply_mastery_delta,
    get_reinforcement_plan,
)
from uploads.models import Subject


class LearningAPISmokeTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="learner",
            email="learner@example.com",
            password="testpass123",
        )
        self.client.force_login(self.user)

        self.subject = Subject.objects.create(user=self.user, name="Biology")
        self.cells = Concept.objects.create(subject=self.subject, name="Cells")
        self.photosynthesis = Concept.objects.create(
            subject=self.subject,
            name="Photosynthesis",
        )

        LearnerConceptMastery.objects.create(
            user=self.user,
            concept=self.cells,
            mastery_score=0.9,
            practice_count=4,
            last_practiced=timezone.now(),
        )
        LearnerConceptMastery.objects.create(
            user=self.user,
            concept=self.photosynthesis,
            mastery_score=0.2,
            practice_count=1,
            last_practiced=timezone.now(),
        )

    def test_progress_summary_returns_learning_overview(self):
        response = self.client.get("/api/learning/progress/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["total_concepts"], 2)
        self.assertEqual(payload["mastered"], 1)
        self.assertEqual(payload["struggling"], 1)
        self.assertEqual(payload["strongest_concept"], "Cells")
        self.assertEqual(payload["weakest_concept"], "Photosynthesis")
        self.assertIn("recent_activity", payload)
        self.assertEqual(payload["recent_activity"], [])

    def test_reinforcement_endpoint_returns_prioritized_items(self):
        response = self.client.get("/api/learning/reinforcement/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("plan", payload)
        self.assertGreaterEqual(payload["plan"]["count"], 1)
        self.assertEqual(payload["plan"]["items"][0]["concept_name"], "Photosynthesis")
        self.assertIn("due_status", payload["plan"]["items"][0])
        self.assertIn("next_review_at", payload["plan"]["items"][0])
        self.assertEqual(payload["plan"]["items"][0]["due_status"], "due_now")

    def test_mastery_delta_creates_history_event(self):
        mastery = apply_mastery_delta(
            self.user,
            self.cells,
            delta=0.05,
            event_type="teach",
            source_session_type="TEACH",
        )

        event = LearnerConceptEvent.objects.filter(
            user=self.user,
            concept=self.cells,
        ).latest("created_at")

        self.assertEqual(event.event_type, "teach")
        self.assertEqual(event.source_session_type, "TEACH")
        self.assertAlmostEqual(event.score_after, mastery.mastery_score, places=4)
        self.assertEqual(event.practice_count_after, mastery.practice_count)

    def test_concept_check_update_creates_history_event(self):
        mastery = apply_concept_check_score(
            self.user,
            self.photosynthesis,
            score=0.8,
            source_session_type="CHECK",
        )

        event = LearnerConceptEvent.objects.filter(
            user=self.user,
            concept=self.photosynthesis,
        ).latest("created_at")

        self.assertEqual(event.event_type, "concept_check")
        self.assertEqual(event.source_session_type, "CHECK")
        self.assertAlmostEqual(event.score_after, mastery.mastery_score, places=4)

    def test_progress_summary_includes_recent_activity_after_event(self):
        apply_mastery_delta(
            self.user,
            self.cells,
            delta=0.03,
            event_type="teach",
            source_session_type="TEACH",
        )

        response = self.client.get("/api/learning/progress/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["recent_activity"]), 1)
        self.assertEqual(payload["recent_activity"][0]["concept_name"], "Cells")
        self.assertEqual(payload["recent_activity"][0]["event_type"], "teach")

    def test_reinforcement_plan_orders_due_now_before_due_soon(self):
        cells_mastery = LearnerConceptMastery.objects.get(
            user=self.user,
            concept=self.cells,
        )
        cells_mastery.mastery_score = 0.5
        cells_mastery.last_practiced = timezone.now()
        cells_mastery.save(update_fields=["mastery_score", "last_practiced"])

        photosynthesis_mastery = LearnerConceptMastery.objects.get(
            user=self.user,
            concept=self.photosynthesis,
        )
        photosynthesis_mastery.mastery_score = 0.2
        photosynthesis_mastery.last_practiced = timezone.now()
        photosynthesis_mastery.save(update_fields=["mastery_score", "last_practiced"])

        plan = get_reinforcement_plan(self.user, limit=5)

        self.assertGreaterEqual(plan["count"], 2)
        self.assertEqual(plan["items"][0]["concept_name"], "Photosynthesis")
        self.assertEqual(plan["items"][0]["due_status"], "due_now")
        self.assertIn(plan["items"][1]["due_status"], ["due_now", "due_soon", "scheduled"])

    def test_reinforcement_plan_marks_high_mastery_recent_concept_as_stable(self):
        cells_mastery = LearnerConceptMastery.objects.get(
            user=self.user,
            concept=self.cells,
        )
        cells_mastery.mastery_score = 0.95
        cells_mastery.last_practiced = timezone.now()
        cells_mastery.save(update_fields=["mastery_score", "last_practiced"])

        plan = get_reinforcement_plan(self.user, limit=5)
        concept_names = [item["concept_name"] for item in plan["items"]]

        self.assertNotIn("Cells", concept_names)
