import os
import json

from openai import OpenAI
from django.utils import timezone

from learning.models import LearnerConceptMastery
from .models import (
    ConceptCheck,
    ConceptCheckAttempt,
    ConceptCheckStatus,
    ConceptCheckResult,
)

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def get_pending_concept_check(session):
    return (
        ConceptCheck.objects
        .filter(session=session, status=ConceptCheckStatus.PENDING)
        .order_by("-created_at")
        .first()
    )


def create_concept_check(session, concept, question, source_message=None):
    return ConceptCheck.objects.create(
        session=session,
        concept=concept,
        question=question,
        source_message=source_message,
    )


def evaluate_concept_check_answer(concept_check, student_answer):
    """
    LLM-based evaluator for concept check answers.
    Falls back to a simple rule-based evaluator if the API fails.
    """
    cleaned = student_answer.strip()

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a tutor evaluating a student's answer.\n\n"
                        "Return ONLY valid JSON with this structure:\n"
                        "{\n"
                        '  "result": "correct" | "partial" | "incorrect",\n'
                        '  "score": number between 0.0 and 1.0,\n'
                        '  "feedback": "short explanation or guidance"\n'
                        "}\n\n"
                        "Guidelines:\n"
                        "- If correct: briefly reinforce the idea\n"
                        "- If partial: explain what is missing and guide improvement\n"
                        "- If incorrect: clearly explain the correct concept simply\n"
                        "- Keep feedback concise but educational\n"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Concept: {concept_check.concept.name}\n"
                        f"Question: {concept_check.question}\n"
                        f"Student answer: {cleaned}"
                    ),
                },
            ],
        )

        raw_output = response.choices[0].message.content.strip()
        parsed = json.loads(raw_output)

        raw_result = str(parsed.get("result", "")).strip().lower()
        feedback = str(parsed.get("feedback", "")).strip()
        score = float(parsed.get("score", 0.0))

        if raw_result == "correct":
            result = ConceptCheckResult.CORRECT
        elif raw_result == "partial":
            result = ConceptCheckResult.PARTIAL
        else:
            result = ConceptCheckResult.INCORRECT

        score = max(0.0, min(1.0, score))

        if not feedback:
            feedback = default_feedback_for_result(result)

    except Exception:
        result, score, feedback = fallback_rule_based_evaluation(cleaned)

    attempt = ConceptCheckAttempt.objects.create(
        concept_check=concept_check,
        student_answer=student_answer,
        feedback=feedback,
        result=result,
        score=score,
    )

    concept_check.status = ConceptCheckStatus.EVALUATED
    concept_check.answered_at = timezone.now()
    concept_check.evaluated_at = timezone.now()
    concept_check.save(update_fields=["status", "answered_at", "evaluated_at"])

    return attempt


def fallback_rule_based_evaluation(cleaned_answer):
    """
    Safe fallback if the LLM call fails.
    """
    if len(cleaned_answer) < 8:
        return (
            ConceptCheckResult.INCORRECT,
            0.2,
            "That answer is too short to show understanding. Try explaining the idea more clearly.",
        )
    elif len(cleaned_answer.split()) < 4:
        return (
            ConceptCheckResult.PARTIAL,
            0.5,
            "You are on the right track, but give a fuller explanation in your own words.",
        )
    else:
        return (
            ConceptCheckResult.CORRECT,
            0.85,
            "Good job — that shows a reasonable understanding of the concept.",
        )


def default_feedback_for_result(result):
    if result == ConceptCheckResult.CORRECT:
        return "Good job — that shows a solid understanding."
    if result == ConceptCheckResult.PARTIAL:
        return "You are partly right, but your explanation is still missing an important idea."
    return "That does not seem correct yet. Try again using the main idea of the concept."


def update_mastery_from_concept_check(user, concept, score):
    mastery, _ = LearnerConceptMastery.objects.get_or_create(
        user=user,
        concept=concept,
        defaults={
            "mastery_score": 0.0,
            "practice_count": 0,
        },
    )

    current = mastery.mastery_score or 0.0
    new_score = (current * 0.7) + (score * 0.3)

    mastery.mastery_score = max(0.0, min(1.0, new_score))
    mastery.practice_count += 1
    mastery.last_practiced = timezone.now()

    if score >= 0.8:
        mastery.stability = min(5.0, mastery.stability + 0.1)
        mastery.difficulty = max(0.0, mastery.difficulty - 0.05)
    elif score >= 0.5:
        mastery.stability = min(5.0, mastery.stability + 0.03)
    else:
        mastery.stability = max(0.1, mastery.stability - 0.08)
        mastery.difficulty = min(1.0, mastery.difficulty + 0.05)

    mastery.save()

    return mastery


def should_trigger_concept_check(mastery_obj):
    if mastery_obj is None:
        return True

    score = mastery_obj.mastery_score or 0.0
    return score < 0.7


def generate_concept_check_question(concept, tutor_answer):
    """
    Generate a short Socratic concept-check question based on the concept
    and the tutor's previous explanation.
    Falls back to a generic question if the API fails.
    """
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an expert tutor creating a short follow-up concept-check question. "
                        "Ask one clear Socratic question that checks whether the student understands "
                        "the core idea. Keep it concise. Return only the question."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Concept: {concept.name}\n"
                        f"Tutor explanation: {tutor_answer}\n\n"
                        "Write one short concept-check question."
                    ),
                },
            ],
        )

        question = response.choices[0].message.content.strip()
        question = question.strip().strip('"').strip("'")

        if not question:
            question = (
                f"Quick check: in your own words, what is the key idea behind {concept.name}?"
            )

        return question

    except Exception:
        return f"Quick check: in your own words, what is the key idea behind {concept.name}?"