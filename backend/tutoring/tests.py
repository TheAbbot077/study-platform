from unittest.mock import patch

from django.test import TestCase

from accounts.models import User
from knowledge.models import Concept
from learning.models import LearnerConceptMastery
from tutoring.assessment import (
    evaluate_objective_answer,
    fallback_concept_check_question,
    fallback_rule_based_evaluation,
)
from tutoring.models import ConceptCheck, StudyMessage, StudySession
from tutoring.services import (
    answer_tutor_request,
    build_autostart_query,
    build_followup_prompt,
    decide_concept_check_outcome,
    get_recent_history,
)
from uploads.models import Subject


class TutorAPISmokeTests(TestCase):
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
        self.other_subject = Subject.objects.create(
            user=self.other_user,
            name="Physics",
        )
        self.client.force_login(self.user)

    @patch("tutoring.views.answer_tutor_request")
    def test_tutor_ask_returns_service_result_for_owned_subject(self, mock_answer):
        mock_answer.return_value = {
            "query": "Explain cells",
            "answer": "Cells are the basic unit of life.",
            "focused_concept": "Cells",
            "concept_switched": False,
            "previous_concept": None,
            "mastery_score": 0.2,
            "session_type": "REMEDIATE",
            "next_step": None,
            "next_action_prompt": None,
        }

        response = self.client.post(
            "/api/tutor/ask/",
            data={
                "query": "Explain cells",
                "subject_id": self.subject.id,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["focused_concept"], "Cells")
        mock_answer.assert_called_once()
        self.assertEqual(mock_answer.call_args.kwargs["user"], self.user)
        self.assertEqual(mock_answer.call_args.kwargs["subject"], self.subject)

    @patch("tutoring.views.answer_tutor_request")
    def test_tutor_ask_rejects_subject_owned_by_another_user(self, mock_answer):
        response = self.client.post(
            "/api/tutor/ask/",
            data={
                "query": "Explain motion",
                "subject_id": self.other_subject.id,
            },
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(
            response.json()["error"],
            "Selected subject was not found.",
        )
        mock_answer.assert_not_called()

    def test_tutor_history_returns_concept_scoped_messages(self):
        subject = Subject.objects.create(user=self.user, name="Chemistry")
        concept = Concept.objects.create(name="Atoms", subject=subject)
        other_concept = Concept.objects.create(name="Bonds", subject=subject)
        session = StudySession.objects.create(
            user=self.user,
            target_concept=concept,
        )

        StudyMessage.objects.create(
            session=session,
            concept=concept,
            role="assistant",
            content="Atoms are the basic building blocks of matter.",
        )
        StudyMessage.objects.create(
            session=session,
            concept=other_concept,
            role="assistant",
            content="Bonds connect atoms together.",
        )

        response = self.client.get(
            "/api/tutor/history/",
            data={
                "concept_name": "Atoms",
                "subject_id": subject.id,
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["concept_name"], "Atoms")
        self.assertEqual(len(payload["messages"]), 1)
        self.assertEqual(
            payload["messages"][0]["content"],
            "Atoms are the basic building blocks of matter.",
        )
        self.assertFalse(payload["messages"][0]["is_checkpoint"])

    def test_tutor_history_rejects_subject_owned_by_another_user(self):
        response = self.client.get(
            "/api/tutor/history/",
            data={
                "concept_name": "Motion",
                "subject_id": self.other_subject.id,
            },
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(
            response.json()["error"],
            "Selected subject was not found.",
        )

    def test_tutor_history_without_subject_does_not_leak_other_user_concept(self):
        other_concept = Concept.objects.create(
            name="Shared Topic",
            subject=self.other_subject,
        )
        other_session = StudySession.objects.create(
            user=self.other_user,
            target_concept=other_concept,
        )
        StudyMessage.objects.create(
            session=other_session,
            concept=other_concept,
            role="assistant",
            content="Private explanation from another learner.",
        )

        response = self.client.get(
            "/api/tutor/history/",
            data={"concept_name": "Shared Topic"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["subject_id"], None)
        self.assertEqual(payload["messages"], [])

    def test_tutor_checkpoint_marks_selected_assistant_message(self):
        subject = Subject.objects.create(user=self.user, name="Chemistry")
        concept = Concept.objects.create(name="Atoms", subject=subject)
        session = StudySession.objects.create(user=self.user, target_concept=concept)
        assistant_message = StudyMessage.objects.create(
            session=session,
            concept=concept,
            role="assistant",
            content="Atoms are building blocks of matter.",
        )

        response = self.client.post(
            "/api/tutor/checkpoint/",
            data={"message_id": assistant_message.id},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        assistant_message.refresh_from_db()
        self.assertTrue(assistant_message.is_checkpoint)

    def test_tutor_reset_trims_messages_after_checkpoint(self):
        subject = Subject.objects.create(user=self.user, name="Chemistry")
        concept = Concept.objects.create(name="Atoms", subject=subject)
        session = StudySession.objects.create(user=self.user, target_concept=concept)
        checkpoint = StudyMessage.objects.create(
            session=session,
            concept=concept,
            role="assistant",
            content="Atoms are the smallest units of matter.",
            is_checkpoint=True,
        )
        later_user = StudyMessage.objects.create(
            session=session,
            concept=concept,
            role="user",
            content="I am confused now.",
        )
        later_assistant = StudyMessage.objects.create(
            session=session,
            concept=concept,
            role="assistant",
            content="Let's jump into orbital hybridization.",
        )
        ConceptCheck.objects.create(
            session=session,
            concept=concept,
            source_message=later_assistant,
            question="What is hybridization?",
        )

        response = self.client.post(
            "/api/tutor/reset/",
            data={"message_id": checkpoint.id},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(StudyMessage.objects.filter(id=later_user.id).exists())
        self.assertFalse(StudyMessage.objects.filter(id=later_assistant.id).exists())
        self.assertEqual(
            list(
                StudyMessage.objects.filter(session=session, concept=concept)
                .order_by("created_at")
                .values_list("id", flat=True)
            ),
            [checkpoint.id],
        )
        self.assertEqual(
            ConceptCheck.objects.filter(session=session, concept=concept).count(),
            0,
        )


class TutorServiceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="service-learner",
            email="service-learner@example.com",
            password="testpass123",
        )
        self.session = StudySession.objects.create(user=self.user)
        self.food_hygiene = Concept.objects.create(name="Food Hygiene")
        self.air_pollution = Concept.objects.create(name="Air Pollution")

    def test_get_recent_history_is_scoped_to_active_concept(self):
        StudyMessage.objects.create(
            session=self.session,
            concept=self.food_hygiene,
            role="user",
            content="Food question",
        )
        StudyMessage.objects.create(
            session=self.session,
            concept=self.food_hygiene,
            role="assistant",
            content="Food answer",
        )
        StudyMessage.objects.create(
            session=self.session,
            concept=self.air_pollution,
            role="user",
            content="Air question",
        )

        history = get_recent_history(self.session, concept=self.air_pollution)

        self.assertEqual(len(history), 1)
        self.assertEqual(history[0].content, "Air question")

    def test_build_autostart_query_introduces_not_started_concepts(self):
        mastery = LearnerConceptMastery.objects.create(
            user=self.user,
            concept=self.air_pollution,
            mastery_score=0.0,
            practice_count=0,
        )

        prompt = build_autostart_query(self.air_pollution, mastery)

        self.assertIn("Introduce Air Pollution to a beginner", prompt)
        self.assertIn("After this topic you will be able to...", prompt)

    def test_build_followup_prompt_stays_on_recently_taught_material_for_regular_correct_answer(self):
        source_message = StudyMessage(
            content=(
                "Atoms have a nucleus made of protons and neutrons. "
                "Electrons move around the nucleus."
            )
        )

        prompt = build_followup_prompt(
            attempt_result="correct",
            concept=self.air_pollution,
            next_action="continue",
            source_message=source_message,
        )

        self.assertIn("you've shown the basic idea of Air Pollution", prompt)
        self.assertIn("Let's keep the lesson moving forward", prompt)
        self.assertNotIn("real-world example", prompt)

    def test_build_followup_prompt_uses_application_only_for_advance(self):
        prompt = build_followup_prompt(
            attempt_result="correct",
            concept=self.air_pollution,
            next_action="advance",
        )

        self.assertIn("move on to the next part of the lesson", prompt)

    @patch("tutoring.services.client.chat.completions.create")
    def test_revisiting_concept_resumes_previous_assistant_message(self, mock_completion):
        mastery = LearnerConceptMastery.objects.create(
            user=self.user,
            concept=self.air_pollution,
            mastery_score=0.45,
            practice_count=1,
        )
        StudyMessage.objects.create(
            session=self.session,
            concept=self.air_pollution,
            role="assistant",
            content="We were working through the main causes of air pollution.",
        )

        result = answer_tutor_request(
            user=self.user,
            query="",
            concept_name=self.air_pollution.name,
        )

        self.assertEqual(
            result["answer"],
            "We were working through the main causes of air pollution.",
        )
        self.assertEqual(result["focused_concept"], self.air_pollution.name)
        self.assertEqual(result["mastery_score"], mastery.mastery_score)
        self.assertEqual(result["next_step"]["name"], self.air_pollution.name)
        self.assertEqual(result["next_step"]["action"], "Continue")
        self.assertEqual(
            result["next_action_prompt"],
            "Let us look deeper into Air Pollution next. Whenever you're ready, click Next and we can begin.",
        )
        self.assertEqual(result["next_action_type"], "advance")
        mock_completion.assert_not_called()

    @patch("tutoring.services.generate_concept_check_question")
    @patch("tutoring.services.should_trigger_concept_check", return_value=True)
    @patch("tutoring.services.semantic_search", return_value=[])
    @patch("tutoring.services.client.chat.completions.create")
    def test_autostart_keeps_next_step_on_selected_concept_until_check_is_done(
        self,
        mock_completion,
        _mock_search,
        _mock_should_trigger,
        mock_question,
    ):
        subject = Subject.objects.create(user=self.user, name="Science")
        current_concept = Concept.objects.create(name="Atoms", subject=subject)
        next_concept = Concept.objects.create(name="Biology", subject=subject)

        self.session.target_concept = current_concept
        self.session.save(update_fields=["target_concept"])

        LearnerConceptMastery.objects.create(
            user=self.user,
            concept=current_concept,
            mastery_score=0.15,
            practice_count=1,
        )
        LearnerConceptMastery.objects.create(
            user=self.user,
            concept=next_concept,
            mastery_score=0.0,
            practice_count=0,
        )

        mock_completion.return_value = type(
            "CompletionStub",
            (),
            {
                "choices": [
                    type(
                        "ChoiceStub",
                        (),
                        {
                            "message": type(
                                "MessageStub",
                                (),
                                {"content": "Biology is the study of life."},
                            )()
                        },
                    )()
                ]
            },
        )()
        mock_question.return_value = "What does biology study?"

        result = answer_tutor_request(
            user=self.user,
            query="",
            concept_name=next_concept.name,
            subject=subject,
        )

        self.assertEqual(result["focused_concept"], next_concept.name)
        self.assertEqual(result["next_step"]["name"], next_concept.name)
        self.assertEqual(result["next_step"]["action"], "Continue")

    def test_pending_check_resume_keeps_next_step_on_same_concept(self):
        subject = Subject.objects.create(user=self.user, name="Science")
        current_concept = Concept.objects.create(name="Atoms", subject=subject)
        next_concept = Concept.objects.create(name="Biology", subject=subject)

        self.session.target_concept = next_concept
        self.session.save(update_fields=["target_concept"])

        LearnerConceptMastery.objects.create(
            user=self.user,
            concept=current_concept,
            mastery_score=0.1,
            practice_count=1,
        )
        LearnerConceptMastery.objects.create(
            user=self.user,
            concept=next_concept,
            mastery_score=0.0,
            practice_count=0,
        )

        assistant_message = StudyMessage.objects.create(
            session=self.session,
            concept=next_concept,
            role="assistant",
            content="Biology is the study of life.\n\nQuick check: What does biology study?",
        )
        ConceptCheck.objects.create(
            session=self.session,
            concept=next_concept,
            question="What does biology study?",
            source_message=assistant_message,
        )

        result = answer_tutor_request(
            user=self.user,
            query="",
            concept_name=next_concept.name,
            subject=subject,
        )

        self.assertEqual(result["focused_concept"], next_concept.name)
        self.assertEqual(result["next_step"]["name"], next_concept.name)
        self.assertEqual(result["next_step"]["action"], "Continue")
        self.assertEqual(
            result["next_action_prompt"],
            "Continue by answering the quick check when you're ready.",
        )

    def test_revisiting_low_mastery_concept_keeps_next_step_on_same_topic(self):
        subject = Subject.objects.create(user=self.user, name="Science")
        current_concept = Concept.objects.create(name="Atoms", subject=subject)
        other_concept = Concept.objects.create(name="Biology", subject=subject)

        LearnerConceptMastery.objects.create(
            user=self.user,
            concept=current_concept,
            mastery_score=0.15,
            practice_count=1,
        )
        LearnerConceptMastery.objects.create(
            user=self.user,
            concept=other_concept,
            mastery_score=0.0,
            practice_count=0,
        )
        StudyMessage.objects.create(
            session=self.session,
            concept=current_concept,
            role="assistant",
            content="Try explaining how protons and electrons affect the atom.",
        )

        result = answer_tutor_request(
            user=self.user,
            query="",
            concept_name=current_concept.name,
            subject=subject,
        )

        self.assertEqual(result["focused_concept"], current_concept.name)
        self.assertEqual(result["next_step"]["name"], current_concept.name)
        self.assertEqual(result["next_step"]["action"], "Remediate")

    @patch("tutoring.services.update_mastery_from_concept_check")
    @patch("tutoring.services.evaluate_concept_check_answer")
    def test_answering_saved_quick_check_after_switch_still_evaluates_same_concept(
        self,
        mock_evaluate,
        mock_update_mastery,
    ):
        subject = Subject.objects.create(user=self.user, name="Science")
        previous_concept = Concept.objects.create(name="Atoms", subject=subject)
        returning_concept = Concept.objects.create(name="Biology", subject=subject)

        self.session.target_concept = previous_concept
        self.session.save(update_fields=["target_concept"])

        mastery = LearnerConceptMastery.objects.create(
            user=self.user,
            concept=returning_concept,
            mastery_score=0.85,
            practice_count=1,
        )
        mock_update_mastery.return_value = mastery
        mock_evaluate.return_value = type(
            "AttemptStub",
            (),
            {
                "score": 0.85,
                "result": "correct",
                "feedback": "Nice work - that answer shows understanding.",
            },
        )()

        assistant_message = StudyMessage.objects.create(
            session=self.session,
            concept=returning_concept,
            role="assistant",
            content="Quick check: What does biology study?",
        )
        check = ConceptCheck.objects.create(
            session=self.session,
            concept=returning_concept,
            question="What does biology study?",
            source_message=assistant_message,
        )

        result = answer_tutor_request(
            user=self.user,
            query="Biology studies life and living organisms.",
            concept_name=returning_concept.name,
            subject=subject,
        )

        mock_evaluate.assert_called_once_with(
            check,
            "Biology studies life and living organisms.",
        )
        self.assertEqual(result["focused_concept"], returning_concept.name)
        self.assertIn("Nice work - that answer shows understanding.", result["answer"])

    def test_decide_concept_check_outcome_advances_on_strong_correct_answer(self):
        mastery = LearnerConceptMastery.objects.create(
            user=self.user,
            concept=self.air_pollution,
            mastery_score=0.78,
            practice_count=2,
        )
        attempt = type(
            "AttemptStub",
            (),
            {"result": "correct", "score": 0.92},
        )()

        decision = decide_concept_check_outcome(
            user=self.user,
            concept=self.air_pollution,
            mastery=mastery,
            attempt=attempt,
        )

        self.assertEqual(decision["session_type"], "REINFORCE")
        self.assertEqual(decision["next_action"], "advance")
        self.assertEqual(decision["next_focus"], self.air_pollution)
        self.assertIsNone(decision["remediation_concept"])

    def test_decide_concept_check_outcome_remediates_on_weak_partial_answer(self):
        subject = Subject.objects.create(user=self.user, name="Science")
        particles = Concept.objects.create(name="Particles", subject=subject)
        air_quality = Concept.objects.create(name="Air Quality", subject=subject)
        air_quality.prerequisites.add(particles)
        mastery = LearnerConceptMastery.objects.create(
            user=self.user,
            concept=air_quality,
            mastery_score=0.42,
            practice_count=2,
        )
        LearnerConceptMastery.objects.create(
            user=self.user,
            concept=particles,
            mastery_score=0.2,
            practice_count=1,
        )
        attempt = type(
            "AttemptStub",
            (),
            {"result": "partial", "score": 0.45},
        )()

        decision = decide_concept_check_outcome(
            user=self.user,
            concept=air_quality,
            mastery=mastery,
            attempt=attempt,
        )

        self.assertEqual(decision["session_type"], "REMEDIATE")
        self.assertEqual(decision["next_action"], "remediate")
        self.assertEqual(decision["remediation_concept"], particles)
        self.assertEqual(decision["next_focus"], particles)


class AssessmentQualityTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="assess-learner",
            email="assess@example.com",
            password="testpass123",
        )
        self.subject = Subject.objects.create(user=self.user, name="Mathematics")
        self.concept = Concept.objects.create(
            name="Exponents",
            subject=self.subject,
            description="Exponents show repeated multiplication of the same base.",
            difficulty_stage="FOUNDATION",
        )
        self.session = StudySession.objects.create(user=self.user)
        self.source_message = StudyMessage.objects.create(
            session=self.session,
            concept=self.concept,
            role="assistant",
            content="Exponents are a short way to write repeated multiplication.",
        )
        self.check = ConceptCheck.objects.create(
            session=self.session,
            concept=self.concept,
            question="What does 3^4 mean?",
            source_message=self.source_message,
        )

    def test_topic_aware_fallback_marks_off_topic_answer_incorrect(self):
        result, score, feedback = fallback_rule_based_evaluation(
            self.check,
            "It is when plants make food from sunlight.",
        )

        self.assertEqual(result, "incorrect")
        self.assertLess(score, 0.5)
        self.assertIn("Exponents", feedback)

    def test_topic_aware_fallback_rewards_on_topic_explanation(self):
        result, score, feedback = fallback_rule_based_evaluation(
            self.check,
            "It means 3 multiplied by itself 4 times, so repeated multiplication.",
        )

        self.assertEqual(result, "correct")
        self.assertGreaterEqual(score, 0.8)
        self.assertIn("Exponents", feedback)

    def test_fallback_concept_check_question_uses_difficulty_stage(self):
        payload = fallback_concept_check_question(self.concept)

        self.assertEqual(payload["answer_key"], "TRUE")
        self.assertIn("True or False", payload["question"])

    def test_fallback_concept_check_question_uses_material_that_was_just_taught(self):
        payload = fallback_concept_check_question(
            self.concept,
            (
                "Exponents are a short way to write repeated multiplication.\n\n"
                "Would you like to talk about powers next?"
            ),
        )

        self.assertEqual(payload["answer_key"], "TRUE")
        self.assertIn(
            "Exponents are a short way to write repeated multiplication",
            payload["question"],
        )

    def test_topic_aware_fallback_uses_taught_explanation_keywords(self):
        self.check.question = "What did the tutor just explain about exponents?"
        self.check.save(update_fields=["question"])

        result, score, _feedback = fallback_rule_based_evaluation(
            self.check,
            "It means repeated multiplication written in a shorter way.",
        )

        self.assertEqual(result, "correct")
        self.assertGreaterEqual(score, 0.8)

    def test_objective_answer_key_marks_correct_choice_without_open_ended_reasoning(self):
        self.check.answer_key = "B"
        self.check.save(update_fields=["answer_key"])

        result = evaluate_objective_answer(self.check, "B")

        self.assertEqual(result[0], "correct")
        self.assertGreaterEqual(result[1], 0.9)

    def test_objective_answer_key_marks_wrong_choice_incorrect(self):
        self.check.answer_key = "FALSE"
        self.check.save(update_fields=["answer_key"])

        result = evaluate_objective_answer(self.check, "True")

        self.assertEqual(result[0], "incorrect")
        self.assertLess(result[1], 0.3)
