import os
from django.utils import timezone

from openai import OpenAI

from knowledge.models import Concept,ConceptRelation
from knowledge.services import semantic_search
from learning.models import LearnerConceptMastery
from learning.services import (
    get_personalized_recommendations,
    is_concept_unlocked,
    get_blocked_by,
)

from .models import (
    StudySession,
    StudyMessage,
    ConceptCheck,
    ConceptCheckStatus,
)
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
    return "REINFORCE"


def determine_response_strategy(session_type, mastery_score):
    if session_type == "REMEDIATE":
        return "guided_hint"

    if session_type == "CHECK":
        if mastery_score < 0.55:
            return "socratic_question"
        return "direct_teach"

    return "challenge"


def get_or_create_mastery(user, concept):
    mastery, _ = LearnerConceptMastery.objects.get_or_create(
        user=user,
        concept=concept,
        defaults={
            "mastery_score": 0.0,
            "practice_count": 0,
            "hint_level": 0,
        },
    )
    return mastery


def get_weak_concepts(user, threshold=0.5, limit=3):
    return (
        LearnerConceptMastery.objects.filter(user=user, mastery_score__lt=threshold)
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

def get_primary_remediation_concept(user, concept, threshold=0.6):
    """
    Return the weakest unmet prerequisite for the concept, if any.
    """
    unmet = get_unmastered_prerequisites(user, concept, threshold=threshold)

    if not unmet:
        return None

    unmet.sort(key=lambda item: item["score"])
    return unmet[0]["concept"]

def get_or_create_session(user):
    session, _ = StudySession.objects.get_or_create(user=user)
    return session


def get_recent_history(session, limit=6):
    messages = session.messages.order_by("-created_at")[:limit]
    return list(reversed(messages))


def detect_concept(query: str, subject=None):
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

    concept, _ = Concept.objects.get_or_create(
        subject=subject,
        name=concept_name,
    )
    return concept
   
def find_best_existing_subject_concept(query: str, subject):
    """
    Try to map the user's query onto an existing concept in the selected subject
    before creating a new concept.
    """
    if not subject:
        return None

    existing_concepts = list(
        Concept.objects.filter(subject=subject).order_by("name")
    )

    if not existing_concepts:
        return None

    cleaned_query = query.strip().lower()

    # First try exact or substring matches
    for concept in existing_concepts:
        name_lower = concept.name.lower()
        if cleaned_query == name_lower:
            return concept
        if cleaned_query in name_lower or name_lower in cleaned_query:
            return concept

    concept_names = [concept.name for concept in existing_concepts]

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You choose the single best existing academic concept from a list, "
                        "based on a student's question. "
                        "Return only one concept name from the provided list. "
                        "If none are a good fit, return NONE."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Student question: {query}\n\n"
                        f"Available concepts in this subject:\n"
                        + "\n".join(f"- {name}" for name in concept_names)
                    ),
                },
            ],
        )

        selected_name = response.choices[0].message.content.strip()

        if selected_name.upper() == "NONE":
            return None

        for concept in existing_concepts:
            if concept.name.lower() == selected_name.lower():
                return concept

    except Exception:
        return None

    return None

def get_concept_from_selection(
    query: str,
    concept_name: str | None = None,
    subject=None,
):
    if concept_name:
        selected = Concept.objects.filter(
            subject=subject,
            name__iexact=concept_name.strip(),
        ).first()
        if selected:
            return selected

    best_existing = find_best_existing_subject_concept(query, subject)
    if best_existing:
        return best_existing

    return detect_concept(query, subject=subject)

def should_switch_concept(current_concept, new_concept):
    """
    Decide whether the session should switch focus to a newly detected concept.
    """
    if not new_concept:
        return False

    if not current_concept:
        return True

    current_name = current_concept.name.strip().lower()
    new_name = new_concept.name.strip().lower()

    if current_name == new_name:
        return False

    # Treat close containment as the same focus
    if current_name in new_name or new_name in current_name:
        return False

    return True

def cancel_stale_pending_checks(session, active_concept):
    ConceptCheck.objects.filter(
        session=session,
        status=ConceptCheckStatus.PENDING,
    ).exclude(
        concept=active_concept,
    ).update(
        status=ConceptCheckStatus.CANCELLED,
        cancelled_at=timezone.now(),
        cancel_reason=f"Switched focus to {active_concept.name}",
    )


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
        mastery.mastery_score = min(1.0, current_score + 0.08)
    else:
        mastery.mastery_score = max(0.0, current_score - 0.08)

    mastery.practice_count += 1
    mastery.save()

    return mastery


def build_adaptive_review_prompt(weak_concepts):
    if not weak_concepts:
        return ""

    concept_names = [item.concept.name for item in weak_concepts]
    return (
        "The student has weaker understanding in these concepts: "
        + ", ".join(concept_names)
        + ". When relevant, connect the current explanation back to them in a supportive way."
    )


def build_prereq_prompt(unmet_prereqs):
    if not unmet_prereqs:
        return ""

    prereq_names = [item["concept"].name for item in unmet_prereqs]
    return (
        "The student may be missing prerequisite knowledge for this concept: "
        + ", ".join(prereq_names)
        + ". Briefly repair prerequisite gaps before or during the explanation."
    )


def build_mastery_prompt(mastery, concept):
    score = mastery.mastery_score or 0.0

    if score < 0.4:
        return (
            f"The student currently has low mastery in {concept.name}. "
            "Use very simple language, short steps, intuition, and concrete examples. "
            "Avoid assuming prior understanding."
        )

    if score < 0.7:
        return (
            f"The student has developing mastery in {concept.name}. "
            "Encourage reasoning, check understanding, and avoid giving everything away too quickly."
        )

    return (
        f"The student has strong mastery in {concept.name}. "
        "Be concise, accurate, and push for deeper understanding, comparisons, or more advanced insight."
    )


def build_graph_context(concept):
    """
    Build structured concept graph context for the tutor prompt.
    """
    prereqs = list(concept.prerequisites.all().order_by("name"))

    related_outgoing = ConceptRelation.objects.filter(
        from_concept=concept,
        relation_type="RELATED",
    ).select_related("to_concept")

    related_incoming = ConceptRelation.objects.filter(
        to_concept=concept,
        relation_type="RELATED",
    ).select_related("from_concept")

    part_of_relations = ConceptRelation.objects.filter(
        from_concept=concept,
        relation_type="PART_OF",
    ).select_related("to_concept")

    has_parts_relations = ConceptRelation.objects.filter(
        to_concept=concept,
        relation_type="PART_OF",
    ).select_related("from_concept")

    related_names = sorted({
        rel.to_concept.name for rel in related_outgoing
    } | {
        rel.from_concept.name for rel in related_incoming
    })

    part_of_names = [rel.to_concept.name for rel in part_of_relations]
    has_parts_names = [rel.from_concept.name for rel in has_parts_relations]

    lines = [
        f"Target concept: {concept.name}",
        f"Description: {concept.description or 'No description available.'}",
    ]

    if concept.subject:
        lines.append(f"Subject: {concept.subject.name}")

    if concept.source_document:
        lines.append(f"Source document: {concept.source_document.title}")

    lines.append(
        "Prerequisites: "
        + (", ".join(prereq.name for prereq in prereqs) if prereqs else "None")
    )

    lines.append(
        "Related concepts: "
        + (", ".join(related_names) if related_names else "None")
    )

    lines.append(
        "Part of: "
        + (", ".join(part_of_names) if part_of_names else "None")
    )

    lines.append(
        "Has parts: "
        + (", ".join(has_parts_names) if has_parts_names else "None")
    )

    return "\n".join(lines)

def build_remediation_message(failed_concept, prerequisite_concept):
    return (
        f"It looks like the difficulty with {failed_concept.name} may come from a gap in "
        f"{prerequisite_concept.name}.\n\n"
        f"Let's step back and strengthen {prerequisite_concept.name} first, then we can return to "
        f"{failed_concept.name} with a stronger foundation."
    )

def build_remediation_message(failed_concept, prerequisite_concept):
    return (
        f"It looks like the difficulty with {failed_concept.name} may come from a gap in "
        f"{prerequisite_concept.name}.\n\n"
        f"Let's step back and strengthen {prerequisite_concept.name} first, then we can return to "
        f"{failed_concept.name} with a stronger foundation."
    )

def build_followup_prompt(attempt_result, concept, remediation_concept=None):
    if remediation_concept:
        return (
            f"Next step: let's rebuild the foundation with {remediation_concept.name}.\n\n"
            f"Try this: in one or two sentences, explain the key idea behind {remediation_concept.name}."
        )

    if attempt_result == "correct":
        return (
            f"Next step: let's deepen your understanding of {concept.name}.\n\n"
            f"Try this: apply {concept.name} to a real-world example in your own words."
        )

    if attempt_result == "partial":
        return (
            f"Next step: focus on the missing piece in {concept.name}.\n\n"
            f"Try this: answer again, but this time make sure you explain the main purpose or mechanism clearly."
        )

    return (
        f"Next step: let's slow down and rebuild {concept.name} step by step.\n\n"
        f"Try this: give a very simple explanation of {concept.name}, as if teaching it to a beginner."
    )

def build_messages(
    query,
    context,
    graph_context,
    history,
    session_type,
    response_strategy,
    concept_name,
    subject_name=None,
    hint_level=0,
    review_prompt="",
    prereq_prompt="",
    mastery_prompt="",
):
    if session_type == "REMEDIATE":
        base_prompt = (
            "You are a patient and highly adaptive tutor. "
            "Teach step-by-step, use approachable language, and help the student build confidence."
        )
    elif session_type == "CHECK":
        base_prompt = (
            "You are an adaptive tutor. "
            "Balance explanation with prompting the student to think."
        )
    else:
        base_prompt = (
            "You are an adaptive expert tutor. "
            "Be concise, intellectually engaging, and help the student deepen understanding."
        )

    if response_strategy == "guided_hint":
        if hint_level == 0:
            strategy_prompt = (
                "Give only a small hint first. Do not fully reveal the answer. "
                "Help the student take the first step."
            )
        elif hint_level == 1:
            strategy_prompt = (
                "Give a somewhat stronger hint with structure, but still leave some thinking for the student."
            )
        elif hint_level == 2:
            strategy_prompt = (
                "Give a near-complete explanation, but preserve a small reasoning step for the student."
            )
        else:
            strategy_prompt = (
                "Give a full, simple explanation now because the student needs direct support."
            )
    elif response_strategy == "socratic_question":
        strategy_prompt = (
            "Begin with one short guiding question, then continue with a brief explanation if helpful. "
            "Do not overwhelm the student."
        )
    elif response_strategy == "challenge":
        strategy_prompt = (
            "Answer clearly and concisely, then extend the answer with one deeper connection, implication, "
            "or challenge question."
        )
    else:
        strategy_prompt = (
            "Give a direct teaching answer that is clear, accurate, and appropriately sized."
        )

    subject_prompt = ""
    if subject_name:
        subject_prompt = (
            f"The student is currently studying the subject '{subject_name}'. "
            "Prioritize explanations and retrieved context that fit this subject."
        )

    system_prompt = " ".join(
        part
        for part in [
            base_prompt,
            strategy_prompt,
            mastery_prompt,
            review_prompt,
            prereq_prompt,
            subject_prompt,
            (
                f"The current target concept is {concept_name}. "
                "Stay focused on that concept unless a prerequisite must be repaired first."
            ),
        ]
        if part
    ).strip()

    messages = [{"role": "system", "content": system_prompt}]

    for msg in history:
        messages.append({
            "role": msg.role,
            "content": msg.content,
        })

    messages.append({
        "role": "user",
        "content": f"""
Use the study context and concept graph below to help the student.

Concept graph:
{graph_context}

Study context:
{context}

Student question:
{query}

Instructions:
- Explain the concept clearly and accurately.
- Use prerequisite relationships when helpful.
- Use related concepts to deepen understanding when relevant.
- If the retrieved text is incomplete, still use the concept graph structure to give a coherent explanation.
- Stay focused on the target concept unless repairing a prerequisite gap is necessary.
""".strip(),
    })

    return messages


def build_next_step_data(user, current_concept):
    recommendations = get_personalized_recommendations(user, limit=3)

    if not recommendations:
        return None

    next_item = None
    for item in recommendations:
        if item["concept"].id != current_concept.id:
            next_item = item
            break

    if next_item is None:
        next_item = recommendations[0]

    return {
        "name": next_item["concept"].name,
        "action": next_item["action"],
        "reason": next_item["reason"],
    }


def answer_question(
    user,
    query: str,
    concept_name: str | None = None,
    subject=None,
):
    session = get_or_create_session(user)

    selected_concept = get_concept_from_selection(
        query,
        concept_name,
        subject=subject,
    )

    concept_switched = False
    previous_concept_name = session.target_concept.name if session.target_concept else None

    if should_switch_concept(session.target_concept, selected_concept):
        session.target_concept = selected_concept
        session.save(update_fields=["target_concept"])
        concept_switched = True

    cancel_stale_pending_checks(session, selected_concept)

    StudyMessage.objects.create(
        session=session,
        role="user",
        content=query,
    )

    pending_check = get_pending_concept_check(session)

    if pending_check and pending_check.concept_id == selected_concept.id:
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

        remediation_concept = None

        if attempt.result == "correct":
            status_line = "Nice work — your understanding is improving."
        elif attempt.result == "partial":
            status_line = "Good progress — you have part of it, but there is still a gap to close."
        else:
            status_line = "That shows a gap in understanding, so the tutor will slow down and scaffold more."
            remediation_concept = get_primary_remediation_concept(
                user=user,
                concept=pending_check.concept,
            )

        reply = (
            f"{attempt.feedback}\n\n"
            f"{status_line}\n"
            f"(Your understanding of {pending_check.concept.name} is now around "
            f"{mastery.mastery_score:.2f})"
        )

        followup_prompt = build_followup_prompt(
            attempt_result=attempt.result,
            concept=pending_check.concept,
            remediation_concept=remediation_concept,
        )

        reply = f"{reply}\n\n{followup_prompt}"

        concept_switched = False
        previous_concept_name = session.target_concept.name if session.target_concept else None

        if remediation_concept:
            remediation_message = build_remediation_message(
                failed_concept=pending_check.concept,
                prerequisite_concept=remediation_concept,
            )
            reply = f"{reply}\n\n{remediation_message}"

            if should_switch_concept(session.target_concept, remediation_concept):
                session.target_concept = remediation_concept
                session.save(update_fields=["target_concept"])
                concept_switched = True

        next_step = build_next_step_data(
            user,
            remediation_concept if remediation_concept else pending_check.concept,
        )

        StudyMessage.objects.create(
            session=session,
            role="assistant",
            content=reply,
        )

        return {
            "query": query,
            "answer": reply,
            "focused_concept": (
                remediation_concept.name if remediation_concept else pending_check.concept.name
            ),
            "concept_switched": concept_switched,
            "previous_concept": previous_concept_name,
            "mastery_score": mastery.mastery_score,
            "session_type": session.session_type,
            "next_step": next_step,
            "next_action_prompt": followup_prompt,
        }

    concept = selected_concept

    if not is_concept_unlocked(user, concept):
        blockers = get_blocked_by(user, concept)

        blocker_lines = [
            f'- {item["concept"].name}: {item["score"]:.2f} ({item["mastery_label"]})'
            for item in blockers
        ]

        blocker_text = "\n".join(blocker_lines)

        answer = (
            f"{concept.name} is not fully unlocked yet.\n\n"
            f"Before studying it, strengthen these prerequisite concepts:\n"
            f"{blocker_text}\n\n"
            f"Once those foundations improve, {concept.name} will unlock naturally."
        )

        return {
            "query": query,
            "answer": answer,
            "focused_concept": concept.name,
            "concept_switched": concept_switched,
            "previous_concept": previous_concept_name,
            "mastery_score": None,
            "session_type": session.session_type,
            "next_step": build_next_step_data(user, concept),
            "next_action_prompt": None,
        }

    mastery = get_or_create_mastery(user, concept)

    search_query = f"{concept.name}\n\n{query}" if concept_name else query
    chunks = semantic_search(
        search_query,
        limit=5,
        subject_id=subject.id if subject else None,
    )
    context = "\n\n".join([chunk.content for chunk in chunks]) if chunks else ""
    graph_context = build_graph_context(concept)
    
    history = get_recent_history(session)

    weak_concepts = get_weak_concepts(user)
    unmet_prereqs = get_unmastered_prerequisites(user, concept)

    review_prompt = build_adaptive_review_prompt(weak_concepts)
    prereq_prompt = build_prereq_prompt(unmet_prereqs)
    mastery_prompt = build_mastery_prompt(mastery, concept)

    if unmet_prereqs and mastery.mastery_score < 0.7:
        session.session_type = "REMEDIATE"
    else:
        session.session_type = determine_session_type(mastery.mastery_score)

    session.save(update_fields=["session_type"])

    response_strategy = determine_response_strategy(
        session.session_type,
        mastery.mastery_score,
    )

    if session.session_type == "REMEDIATE" and unmet_prereqs:
        mastery.hint_level = min(3, mastery.hint_level + 1)
    else:
        mastery.hint_level = 0

    mastery.save(update_fields=["hint_level"])

    messages = build_messages(
        query=query,
        context=context,
        graph_context=graph_context,
        history=history,
        session_type=session.session_type,
        response_strategy=response_strategy,
        concept_name=concept.name,
        subject_name=subject.name if subject else None,
        hint_level=mastery.hint_level,
        review_prompt=review_prompt,
        prereq_prompt=prereq_prompt,
        mastery_prompt=mastery_prompt,
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

        answer = f"{answer}\n\nQuick check: {check_question}"
        updated_mastery_score = mastery.mastery_score
    else:
        mastery = update_mastery(user=user, concept=concept, correct=True)
        session.session_type = determine_session_type(mastery.mastery_score)
        session.save(update_fields=["session_type"])
        updated_mastery_score = mastery.mastery_score

    assistant_message.content = answer
    assistant_message.save(update_fields=["content"])

    return {
        "query": query,
        "answer": answer,
        "focused_concept": concept.name,
        "subject": subject.name if subject else None,
        "graph_context": graph_context,
        "concept_switched": concept_switched,
        "previous_concept": previous_concept_name,
        "mastery_score": updated_mastery_score,
        "session_type": session.session_type,
        "next_step": build_next_step_data(user, concept),
        "next_action_prompt": None,
    }