import json
import os
import re

from django.utils import timezone
from openai import OpenAI

from learning.services import apply_concept_check_score
from .models import (
    ConceptCheck,
    ConceptCheckAttempt,
    ConceptCheckResult,
    ConceptCheckStatus,
)

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "into",
    "your",
    "their",
    "about",
    "what",
    "when",
    "where",
    "which",
    "would",
    "could",
    "should",
    "because",
    "through",
    "have",
    "has",
    "had",
    "been",
    "being",
    "they",
    "them",
    "then",
    "than",
    "will",
    "just",
    "very",
    "more",
    "most",
    "onto",
}


def _tokenize_keywords(text):
    return {
        token
        for token in re.findall(r"[a-zA-Z][a-zA-Z0-9'-]{2,}", (text or "").lower())
        if token not in STOPWORDS
    }


def _clean_explanation_line(line):
    cleaned = re.sub(r"^#{2,6}\s*", "", (line or "").strip())
    cleaned = re.sub(r"^\*\*(.+)\*\*$", r"\1", cleaned)
    cleaned = re.sub(r"^\d+\.\s*", "", cleaned)
    cleaned = re.sub(r"^[-*]\s*", "", cleaned)
    return cleaned.strip()


def extract_taught_passage(tutor_answer):
    candidates = []

    for raw_line in (tutor_answer or "").splitlines():
        line = _clean_explanation_line(raw_line)
        lower = line.lower()

        if not line:
            continue
        if lower.startswith("quick check:"):
            continue
        if lower.startswith("after this topic"):
            continue
        if lower.startswith("what do you think"):
            continue
        if lower.startswith("would you like"):
            continue
        if lower.startswith("now, let's"):
            continue
        if lower.startswith("so let's"):
            continue
        if line.endswith("?"):
            continue

        candidates.append(line)

    passage = " ".join(candidates[:6]).strip()
    return passage[:900]


def extract_primary_taught_sentence(tutor_answer, concept_name=None):
    passage = extract_taught_passage(tutor_answer)
    if not passage:
        return ""

    sentences = re.split(r"(?<=[.!?])\s+", passage)
    concept_name_lower = (concept_name or "").lower()

    for sentence in sentences:
        stripped = sentence.strip()
        lower = stripped.lower()
        if not stripped:
            continue
        if lower.startswith("why it matters"):
            continue
        if lower.startswith("main subtopics"):
            continue
        if lower.startswith("key components"):
            continue
        if concept_name_lower and concept_name_lower in lower:
            return stripped[:220]

    return sentences[0].strip()[:220]


def build_concept_check_context(concept_check):
    concept = concept_check.concept
    prereqs = list(
        concept.prerequisites.order_by("name").values_list("name", flat=True)
    )

    lines = [
        f"Concept: {concept.name}",
        f"Subject: {concept.subject.name if concept.subject else 'Unknown subject'}",
        f"Difficulty stage: {concept.difficulty_stage or 'FOUNDATION'}",
        f"Description: {concept.description or 'No description available.'}",
        "Prerequisites: " + (", ".join(prereqs) if prereqs else "None"),
    ]

    if concept.source_document_id and concept.source_document:
        lines.append(f"Source document: {concept.source_document.title}")

    if concept_check.source_message_id and concept_check.source_message:
        taught_passage = extract_taught_passage(concept_check.source_message.content)
        lines.append(
            "Assess only the material explicitly taught in this tutor explanation, "
            "not later subtopics that have not been covered yet."
        )
        lines.append(
            "Tutor explanation to assess against: "
            + (taught_passage or concept_check.source_message.content.strip()[:800])
        )

    return "\n".join(lines)


def get_pending_concept_check(session, concept=None):
    queryset = ConceptCheck.objects.filter(
        session=session,
        status=ConceptCheckStatus.PENDING,
    )

    if concept is not None:
        queryset = queryset.filter(concept=concept)

    return queryset.order_by("-created_at").first()


def create_concept_check(session, concept, question, source_message=None, answer_key=""):
    return ConceptCheck.objects.create(
        session=session,
        concept=concept,
        question=question,
        answer_key=answer_key or "",
        source_message=source_message,
    )


def _normalize_objective_answer(answer):
    cleaned = clean_text_for_check(answer)
    if not cleaned:
        return ""

    upper = cleaned.upper()
    if upper.startswith("OPTION "):
        upper = upper.replace("OPTION ", "", 1)
    if upper in {"A", "B", "C", "D"}:
        return upper
    if upper.startswith(("A)", "B)", "C)", "D)")):
        return upper[0]
    if upper in {"TRUE", "T"}:
        return "TRUE"
    if upper in {"FALSE", "F"}:
        return "FALSE"
    return upper


def clean_text_for_check(answer):
    return re.sub(r"\s+", " ", (answer or "").strip())


def evaluate_objective_answer(concept_check, student_answer):
    answer_key = (concept_check.answer_key or "").strip().upper()
    if not answer_key:
        return None

    normalized = _normalize_objective_answer(student_answer)
    if normalized not in {"A", "B", "C", "D", "TRUE", "FALSE"}:
        return None

    if normalized == answer_key:
        return (
            ConceptCheckResult.CORRECT,
            0.92,
            f"Correct - you have the basic idea of {concept_check.concept.name}, so we can keep moving.",
        )

    return (
        ConceptCheckResult.INCORRECT,
        0.2,
        f"Not quite. Let's quickly repair the key idea in {concept_check.concept.name} before moving on.",
    )


def evaluate_concept_check_answer(concept_check, student_answer):
    """
    LLM-based evaluator for concept check answers.
    Falls back to a topic-aware rule-based evaluator if the API fails.
    """
    cleaned = student_answer.strip()
    concept_context = build_concept_check_context(concept_check)

    objective_result = evaluate_objective_answer(concept_check, cleaned)
    if objective_result is not None:
        result, score, feedback = objective_result
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
                        "- Grade against the specific topic being taught, not just generic writing quality\n"
                        "- Reward answers that capture the core meaning, mechanism, or application of this exact concept\n"
                        "- Mark as partial when the student is on the right topic but misses a key idea or explanation\n"
                        "- Mark as incorrect when the answer is off-topic, too vague, or confuses this concept with another\n"
                        "- If the question is multiple choice or true/false, selecting the correct option should count as correct even if the answer is short\n"
                        "- If correct: briefly reinforce the idea\n"
                        "- If partial: explain what is missing and guide improvement\n"
                        "- If incorrect: clearly explain the correct concept simply\n"
                        "- Keep feedback concise but educational\n"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"{concept_context}\n\n"
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
        result, score, feedback = fallback_rule_based_evaluation(
            concept_check,
            cleaned,
        )

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


def fallback_rule_based_evaluation(concept_check, cleaned_answer):
    """
    Safe fallback if the LLM call fails.
    """
    answer_words = cleaned_answer.split()
    if len(cleaned_answer) < 8:
        return (
            ConceptCheckResult.INCORRECT,
            0.2,
            "That answer is too short to show understanding. Try explaining the idea more clearly.",
        )

    concept_keywords = _tokenize_keywords(concept_check.concept.name)
    concept_keywords |= _tokenize_keywords(concept_check.concept.description)
    if concept_check.source_message_id and concept_check.source_message:
        concept_keywords |= _tokenize_keywords(
            extract_taught_passage(concept_check.source_message.content)
        )
    question_keywords = _tokenize_keywords(concept_check.question)
    answer_keywords = _tokenize_keywords(cleaned_answer)

    overlap = len(answer_keywords & (concept_keywords | question_keywords))

    if len(answer_words) < 4:
        return (
            ConceptCheckResult.PARTIAL,
            0.5,
            "You are on the right track, but give a fuller explanation in your own words.",
        )

    if overlap == 0:
        return (
            ConceptCheckResult.INCORRECT,
            0.3,
            f"Your answer does not yet show the main idea of {concept_check.concept.name}. Try focusing on what it means or how it works.",
        )

    if overlap < 2 or len(answer_words) < 8:
        return (
            ConceptCheckResult.PARTIAL,
            0.55,
            f"You are on the right topic, but your explanation of {concept_check.concept.name} still needs one or two key details.",
        )

    return (
        ConceptCheckResult.CORRECT,
        0.85,
        f"Good job - that shows a reasonable understanding of {concept_check.concept.name}.",
    )


def default_feedback_for_result(result):
    if result == ConceptCheckResult.CORRECT:
        return "Good job - that shows a solid understanding."
    if result == ConceptCheckResult.PARTIAL:
        return "You are partly right, but your explanation is still missing an important idea."
    return "That does not seem correct yet. Try again using the main idea of the concept."


def update_mastery_from_concept_check(user, concept, score):
    return apply_concept_check_score(
        user,
        concept,
        score=score,
        source_session_type="CHECK",
    )


def should_trigger_concept_check(mastery_obj):
    if mastery_obj is None:
        return True

    score = mastery_obj.mastery_score or 0.0
    return score < 0.7


def generate_concept_check_question(concept, tutor_answer):
    """
    Generate a short objective concept-check question based on the concept
    and the tutor's previous explanation.
    Falls back to a topic-aware multiple-choice or true/false question if the API fails.
    """
    prereqs = list(concept.prerequisites.order_by("name").values_list("name", flat=True))
    concept_context = "\n".join(
        [
            f"Concept: {concept.name}",
            f"Subject: {concept.subject.name if concept.subject else 'Unknown subject'}",
            f"Difficulty stage: {concept.difficulty_stage or 'FOUNDATION'}",
            f"Description: {concept.description or 'No description available.'}",
            "Prerequisites: " + (", ".join(prereqs) if prereqs else "None"),
        ]
    )
    taught_passage = extract_taught_passage(tutor_answer)

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an expert tutor creating a very short objective concept-check question. "
                        "Return ONLY valid JSON with this structure:\n"
                        "{\n"
                        '  "question": "full visible question text with options or true/false instruction",\n'
                        '  "answer_key": "A|B|C|D|TRUE|FALSE"\n'
                        "}\n\n"
                        "Rules:\n"
                        "- Use only multiple choice or true/false.\n"
                        "- The check must assess only the material explicitly taught in the latest explanation.\n"
                        "- Do not ask Socratic, open-ended, or broad application questions.\n"
                        "- Keep it easy to answer quickly so the lesson can keep moving.\n"
                        "- If using multiple choice, include exactly four options labeled A) through D).\n"
                        "- End with a short instruction like 'Reply with A, B, C, or D.' or 'Reply with True or False.'"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"{concept_context}\n"
                        f"Taught material: {taught_passage or tutor_answer}\n\n"
                        "Write one short concept-check question."
                    ),
                },
            ],
        )

        raw_payload = response.choices[0].message.content.strip()
        parsed = json.loads(raw_payload)
        question = clean_text_for_check(parsed.get("question", ""))
        answer_key = clean_text_for_check(parsed.get("answer_key", "")).upper()

        if (
            not question
            or answer_key not in {"A", "B", "C", "D", "TRUE", "FALSE"}
        ):
            return fallback_concept_check_question(concept, tutor_answer)

        return {
            "question": question,
            "answer_key": answer_key,
        }

    except Exception:
        return fallback_concept_check_question(concept, tutor_answer)


def fallback_concept_check_question(concept, tutor_answer=None):
    taught_sentence = extract_primary_taught_sentence(tutor_answer, concept.name)
    if taught_sentence:
        statement = taught_sentence.rstrip(".!?")
        return {
            "question": (
                f"Quick check (True/False): {statement}. Reply with True or False."
            ),
            "answer_key": "TRUE",
        }

    if concept.difficulty_stage == "ADVANCED":
        return {
            "question": (
                f"Quick check (multiple choice): Which option best matches {concept.name}?\n"
                f"A) An unrelated topic\n"
                f"B) A core idea from {concept.name}\n"
                f"C) A publishing note\n"
                f"D) A glossary heading\n"
                "Reply with A, B, C, or D."
            ),
            "answer_key": "B",
        }
    if concept.difficulty_stage == "CORE":
        return {
            "question": (
                f"Quick check (multiple choice): Which option best describes {concept.name}?\n"
                f"A) A main study idea in this lesson\n"
                f"B) The book's acknowledgement page\n"
                f"C) A random internet topic\n"
                f"D) The document file type\n"
                "Reply with A, B, C, or D."
            ),
            "answer_key": "A",
        }
    return {
        "question": (
            f"Quick check (True/False): {concept.name} is one of the basic ideas in this lesson. "
            "Reply with True or False."
        ),
        "answer_key": "TRUE",
    }
