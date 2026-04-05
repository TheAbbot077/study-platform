import os

from openai import OpenAI

from knowledge.models import Concept
from knowledge.services import semantic_search
from learning.models import LearnerConceptMastery

from .models import StudySession, StudyMessage
from .assessment import (
    get_pending_concept_check,
    create_concept_check,
    evaluate_concept_check_answer,
    update_mastery_from_concept_check,
    should_trigger_concept_check,
    generate_concept_check_question,
)

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def determine_session_type(mastery_score):
    if mastery_score < 0.4:
        return "REMEDIATE"
    elif mastery_score < 0.7:
        return "CHECK"
    else:
        return "REINFORCE"


def determine_response_strategy(session_type, mastery_score):
    if session_type == "REMEDIATE":
        return "guided_hint"

    if session_type == "CHECK":
        if mastery_score < 0.55:
            return "socratic_question"
        return "direct_teach"

    return "direct_teach"


def get_weak_concepts(user, threshold=0.5, limit=2):
    return (
        LearnerConceptMastery.objects
        .filter(user=user, mastery_score__lt=threshold)
        .select_related("concept")
        .order_by("mastery_score")[:limit]
    )


def get_unmastered_prerequisites(user, concept, threshold=0.6):
    unmet = []

    for prereq in concept.prerequisites.all():
        mastery = LearnerConceptMastery.objects.filter(
            user=user,
            concept=prereq,
        ).first()

        score = mastery.mastery_score if mastery else 0.0

        if score < threshold:
            unmet.append({
                "concept": prereq,
                "score": score,
            })

    return unmet


def get_next_recommended_concepts(user, limit=3):
    mastered_ids = LearnerConceptMastery.objects.filter(
        user=user,
        mastery_score__gte=0.7,
    ).values_list("concept_id", flat=True)

    candidates = Concept.objects.exclude(id__in=mastered_ids).prefetch_related("prerequisites")[:50]

    recommendations = []

    for concept in candidates:
        prereqs = concept.prerequisites.all()

        if not prereqs.exists():
            recommendations.append(concept)
        else:
            all_ready = True

            for prereq in prereqs:
                mastery = LearnerConceptMastery.objects.filter(
                    user=user,
                    concept=prereq,
                ).first()

                score = mastery.mastery_score if mastery else 0.0
                if score < 0.6:
                    all_ready = False
                    break

            if all_ready:
                recommendations.append(concept)

        if len(recommendations) >= limit:
            break

    return recommendations


def get_or_create_session(user):
    session, _ = StudySession.objects.get_or_create(user=user)
    return session


def get_recent_history(session, limit=6):
    messages = session.messages.order_by("-created_at")[:limit]
    return list(reversed(messages))


def build_messages(
    query,
    context,
    history,
    session_type,
    response_strategy,
    hint_level=0,
    review_prompt="",
    prereq_prompt="",
):
    if session_type == "REMEDIATE":
        base_prompt = (
            "You are a patient tutor. Explain concepts simply, step-by-step, "
            "as if the student is struggling. Use clear examples."
        )
    elif session_type == "CHECK":
        base_prompt = (
            "You are a tutor. Explain clearly but encourage understanding. "
            "Do not over-explain. Focus on clarity."
        )
    else:  # REINFORCE
        base_prompt = (
            "You are an advanced tutor. Be concise and encourage deeper thinking. "
            "Make connections between ideas when possible."
        )

    if response_strategy == "guided_hint":
        if hint_level == 0:
            strategy_prompt = (
                "Give a very small hint only. Do not reveal the full answer."
            )
        elif hint_level == 1:
            strategy_prompt = (
                "Give a stronger hint with more detail, but still do not reveal the full answer."
            )
        elif hint_level == 2:
            strategy_prompt = (
                "Give a near-complete explanation but leave a small gap for the student to infer."
            )
        else:
            strategy_prompt = "Now give the full clear explanation."
    elif response_strategy == "socratic_question":
        strategy_prompt = (
            "Do not fully answer immediately. Start by asking one short guiding question "
            "that helps the student think."
        )
    else:  # direct_teach
        strategy_prompt = (
            "Give a direct but clear teaching answer. Keep it appropriately concise."
        )

    system_prompt = f"{base_prompt} {strategy_prompt} {review_prompt} {prereq_prompt}".strip()

    messages = [{"role": "system", "content": system_prompt}]

    for msg in history:
        messages.append({
            "role": msg.role,
            "content": msg.content,
        })

    messages.append({
        "role": "user",
        "content": f"""
Use the context below to help the student.

Context:
{context}

Student question:
{query}
""".strip()
    })

    return messages


def detect_concept(query: str):
    """
    Use the LLM to extract the main academic concept from the user's query.
    Falls back to the cleaned query if extraction fails.
    """
    cleaned_query = query.strip()

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You extract the main academic concept from a student's question. "
                        "Return only the concept name, with no explanation, no punctuation around it, "
                        "and no extra words like 'the concept is'. "
                        "Examples:\n"
                        "Question: What is photosynthesis?\n"
                        "Answer: photosynthesis\n"
                        "Question: Explain Newton's second law\n"
                        "Answer: Newton's second law\n"
                        "Question: How does cellular respiration work?\n"
                        "Answer: cellular respiration"
                    ),
                },
                {
                    "role": "user",
                    "content": cleaned_query,
                },
            ],
        )

        concept_name = response.choices[0].message.content.strip()
        concept_name = concept_name.strip().strip(".").strip('"').strip("'")

        if not concept_name:
            concept_name = cleaned_query.lower()

    except Exception:
        concept_name = cleaned_query.lower()

    concept, _ = Concept.objects.get_or_create(name=concept_name)
    return concept


def update_mastery(user, concept, correct=True):
    mastery, _ = LearnerConceptMastery.objects.get_or_create(
        user=user,
        concept=concept,
        defaults={
            "mastery_score": 0.0,
            "practice_count": 0,
            "hint_level": 0,
        },
    )

    current_score = mastery.mastery_score or 0.0

    if correct:
        mastery.mastery_score = min(1.0, current_score + 0.1)
    else:
        mastery.mastery_score = max(0.0, current_score - 0.1)

    mastery.practice_count += 1
    mastery.save()

    return mastery


def answer_question(user, query: str):
    session = get_or_create_session(user)

    StudyMessage.objects.create(
        session=session,
        role="user",
        content=query,
    )

    pending_check = get_pending_concept_check(session)

    if pending_check:
        attempt = evaluate_concept_check_answer(pending_check, query)
        mastery = update_mastery_from_concept_check(
            user=user,
            concept=pending_check.concept,
            score=attempt.score or 0.0,
        )

        session.session_type = determine_session_type(mastery.mastery_score)
        session.save(update_fields=["session_type"])

        if attempt.result == "incorrect":
            mastery.hint_level = min(3, mastery.hint_level + 1)
        else:
            mastery.hint_level = 0
        mastery.save(update_fields=["hint_level"])

        reply = (
            f"{attempt.feedback}\n\n"
            f"(Your understanding of {pending_check.concept.name} is now around "
            f"{mastery.mastery_score:.2f})"
        )

        StudyMessage.objects.create(
            session=session,
            role="assistant",
            content=reply,
        )

        return reply

    concept = detect_concept(query)

    chunks = semantic_search(query, limit=5)
    context = "\n\n".join([chunk.content for chunk in chunks]) if chunks else ""

    history = get_recent_history(session)

    weak_concepts = get_weak_concepts(user)
    review_prompt = ""
    if weak_concepts:
        concept_names = [item.concept.name for item in weak_concepts]
        review_prompt = (
            "The student previously struggled with: "
            + ", ".join(concept_names)
            + ". Occasionally revisit these concepts when relevant."
        )

    unmet_prereqs = get_unmastered_prerequisites(user, concept)
    prereq_prompt = ""
    if unmet_prereqs:
        prereq_names = [item["concept"].name for item in unmet_prereqs]
        prereq_prompt = (
            "The student may be missing prerequisite knowledge for this concept: "
            + ", ".join(prereq_names)
            + ". If helpful, briefly support those prerequisite ideas first."
        )

    mastery, _ = LearnerConceptMastery.objects.get_or_create(
        user=user,
        concept=concept,
        defaults={
            "mastery_score": 0.0,
            "practice_count": 0,
            "hint_level": 0,
        },
    )

    # Reset hint progression for a fresh direct question on this concept
    mastery.hint_level = 0
    mastery.save(update_fields=["hint_level"])

    session.session_type = determine_session_type(mastery.mastery_score)
    session.save(update_fields=["session_type"])

    response_strategy = determine_response_strategy(
        session.session_type,
        mastery.mastery_score,
    )

    messages = build_messages(
        query=query,
        context=context,
        history=history,
        session_type=session.session_type,
        response_strategy=response_strategy,
        hint_level=mastery.hint_level,
        review_prompt=review_prompt,
        prereq_prompt=prereq_prompt,
    )

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
    )

    answer = response.choices[0].message.content.strip()

    assistant_message = StudyMessage.objects.create(
        session=session,
        role="assistant",
        content=answer,
    )

    if should_trigger_concept_check(mastery):
        check_question = generate_concept_check_question(concept, answer)

        create_concept_check(
            session=session,
            concept=concept,
            question=check_question,
            source_message=assistant_message,
        )

        answer = f"{answer}\n\n{check_question}"

    recommended = get_next_recommended_concepts(user, limit=2)
    if recommended:
        recommended_names = ", ".join([c.name for c in recommended])
        answer = f"{answer}\n\nSuggested next concepts to study: {recommended_names}"

    assistant_message.content = answer
    assistant_message.save(update_fields=["content"])

    return answer