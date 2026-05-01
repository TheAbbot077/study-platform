import os

from django.db import transaction
from django.utils import timezone
from openai import OpenAI

from knowledge.models import Concept, ConceptRelation
from knowledge.services import semantic_search
from learning.models import LearnerConceptMastery
from learning.services import (
    apply_mastery_delta,
    get_personalized_recommendations,
    is_concept_unlocked,
    get_blocked_by,
    ensure_concept_mastery,
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
    extract_primary_taught_sentence,
)

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def determine_session_type(mastery_score):
    if mastery_score < 0.4:
        return "REMEDIATE"
    elif mastery_score < 0.7:
        return "CHECK"
    return "REINFORCE"


def determine_response_strategy(session_type, mastery_score, concept=None):
    if session_type == "REMEDIATE":
        return "guided_hint"

    if session_type == "CHECK":
        if concept is not None and concept.node_type == "CHAPTER":
            return "socratic_question"
        if mastery_score < 0.55:
            return "socratic_question"
        return "direct_teach"

    return "challenge"


def get_or_create_mastery(user, concept):
    mastery = ensure_concept_mastery(user, concept)
    if mastery.hint_level is None:
        mastery.hint_level = 0
        mastery.save(update_fields=["hint_level"])
    return mastery


def get_weak_concepts(user, threshold=0.5, limit=3, subject=None):
    queryset = LearnerConceptMastery.objects.filter(
        user=user,
        mastery_score__lt=threshold,
    ).select_related("concept")

    if subject is not None:
        queryset = queryset.filter(concept__subject=subject)

    return queryset.order_by("mastery_score")[:limit]


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


def get_recent_history(session, concept=None, limit=6):
    messages = session.messages.order_by("-created_at")
    if concept is not None:
        messages = messages.filter(concept=concept)
    messages = messages[:limit]
    return list(reversed(messages))


def get_latest_concept_message(session, concept, role=None):
    messages = session.messages.filter(concept=concept)
    if role is not None:
        messages = messages.filter(role=role)
    return messages.order_by("-created_at").first()


def set_checkpoint(user, message):
    if message.session.user_id != user.id:
        raise ValueError("You do not have access to that tutor message.")

    if message.concept_id is None:
        raise ValueError("Only concept-scoped tutor messages can be used as checkpoints.")

    if message.role != "assistant":
        raise ValueError("Set checkpoints on tutor messages so the learner can return to an explanation point.")

    StudyMessage.objects.filter(
        session=message.session,
        concept=message.concept,
        is_checkpoint=True,
    ).exclude(id=message.id).update(is_checkpoint=False)

    if not message.is_checkpoint:
        message.is_checkpoint = True
        message.save(update_fields=["is_checkpoint"])

    return message


@transaction.atomic
def reset_to_checkpoint(user, checkpoint_message):
    if checkpoint_message.session.user_id != user.id:
        raise ValueError("You do not have access to that checkpoint.")

    if checkpoint_message.concept_id is None or not checkpoint_message.is_checkpoint:
        raise ValueError("Choose a saved checkpoint before resetting.")

    session = checkpoint_message.session
    concept = checkpoint_message.concept

    messages_to_delete = StudyMessage.objects.filter(
        session=session,
        concept=concept,
        created_at__gt=checkpoint_message.created_at,
    )

    checks_to_delete = ConceptCheck.objects.filter(
        session=session,
        concept=concept,
        created_at__gt=checkpoint_message.created_at,
    )

    if checkpoint_message.role == "assistant":
        checks_to_delete = checks_to_delete.exclude(source_message=checkpoint_message)

    checks_to_delete.delete()
    messages_to_delete.delete()

    session.target_concept = concept
    session.save(update_fields=["target_concept"])

    return checkpoint_message


def detect_concept(query: str, subject=None):
    cleaned_query = query.strip()

    if not cleaned_query:
        return None

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
        defaults={"node_type": "CONCEPT"},
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

    if not cleaned_query:
        return None

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
        normalized_name = concept_name.strip()
        selected = Concept.objects.filter(
            subject=subject,
            name__iexact=normalized_name,
        ).first()
        if selected:
            return selected

        if normalized_name:
            concept, _ = Concept.objects.get_or_create(
                subject=subject,
                name=normalized_name,
                defaults={"node_type": "CONCEPT"},
            )
            return concept

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


def get_first_teachable_descendant(concept):
    if concept is None:
        return None

    if not concept.children.exists():
        return concept

    queue = list(concept.children.order_by("syllabus_order", "name"))
    while queue:
        current = queue.pop(0)
        children = list(current.children.order_by("syllabus_order", "name"))
        if not children:
            return current
        queue = children + queue

    return concept


def chapter_ready_for_review(user, chapter):
    descendants = list(
        Concept.objects.filter(
            subject=chapter.subject,
            parent__isnull=False,
        )
        .exclude(children__isnull=False)
        .filter(parent__parent=chapter)
    )
    if not descendants:
        return False

    mastery_by_concept_id = {
        item.concept_id: item
        for item in LearnerConceptMastery.objects.filter(
            user=user,
            concept__in=descendants,
        )
    }

    return all(
        mastery_by_concept_id.get(descendant.id) is not None
        and mastery_by_concept_id[descendant.id].practice_count > 0
        for descendant in descendants
    )

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


def build_autostart_query(concept, mastery, user=None):
    if concept.node_type == "CHAPTER":
        if user is not None and chapter_ready_for_review(user, concept):
            concept_names = list(
                concept.children.order_by("syllabus_order", "name").values_list("name", flat=True)
            )
            return (
                f"Run a short end-of-chapter review for {concept.name}. Use broad but friendly questions "
                f"that connect these ideas: {', '.join(concept_names)}. Use a more Socratic review style "
                f"than the quick concept checks."
            )
        concept_names = list(
            concept.children.order_by("syllabus_order", "name").values_list("name", flat=True)
        )
        components_text = ", ".join(concept_names) if concept_names else concept.name
        return (
            f"Introduce the chapter {concept.name} to a beginner. Explain what the chapter is about, "
            f"why it matters, and outline its main concepts: {components_text}. "
            f"End by telling the learner which concept or subtopic should come first."
        )

    if concept.node_type == "CONCEPT" and concept.children.exists():
        subtopic_names = list(
            concept.children.order_by("syllabus_order", "name").values_list("name", flat=True)
        )
        subtopics_text = ", ".join(subtopic_names) if subtopic_names else concept.name
        return (
            f"Introduce {concept.name} clearly and explain that it will be built from these subtopics: "
            f"{subtopics_text}. Give a short overview before teaching the first subtopic."
        )

    if mastery.practice_count == 0:
        return (
            f"Introduce {concept.name} to a beginner. Give a broad overview of the topic, "
            f"explain why it matters, outline the main subtopics the student can expect, "
            f"and include a short section that begins with 'After this topic you will be able to...'."
        )

    mastery_score = mastery.mastery_score
    session_type = determine_session_type(mastery_score)

    if session_type == "REMEDIATE":
        return f"Give a very simple explanation of {concept.name} for a beginner."
    if session_type == "CHECK":
        return f"Ask a short question to check understanding of {concept.name}."
    return f"Give a slightly challenging application question about {concept.name}."


def update_mastery(user, concept, correct=True):
    event_type = "teach" if correct else "remediation"
    source_session_type = "TEACH" if correct else "REMEDIATE"
    delta = 0.08 if correct else -0.08
    return apply_mastery_delta(
        user,
        concept,
        delta=delta,
        event_type=event_type,
        source_session_type=source_session_type,
    )


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


def build_followup_prompt(
    attempt_result,
    concept,
    remediation_concept=None,
    next_action="continue",
    source_message=None,
):
    if remediation_concept:
        return (
            f"Next step: let's rebuild the foundation with {remediation_concept.name}.\n\n"
            f"Try this: in one or two sentences, explain the key idea behind {remediation_concept.name}."
        )

    if attempt_result == "correct":
        if next_action == "advance":
            return (
                f"Next step: good job - you've got the basics of {concept.name}.\n\n"
                f"Let's move on to the next part of the lesson."
            )

        return (
            f"Next step: you've shown the basic idea of {concept.name}.\n\n"
            f"Let's keep the lesson moving forward."
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


def decide_concept_check_outcome(user, concept, mastery, attempt):
    score = float(attempt.score or 0.0)
    remediation_concept = None
    next_action = "continue"

    if attempt.result == "correct":
        if score >= 0.7:
            status_line = (
                "Strong enough - you got the key idea, so we can move forward."
            )
            session_type = "REINFORCE"
            next_action = "advance"
        else:
            status_line = (
                "Nice work - your understanding is improving, so we can keep building on this topic."
            )
            session_type = determine_session_type(mastery.mastery_score)
    elif attempt.result == "partial":
        if score >= 0.6:
            status_line = (
                "Good progress - you are on the right idea, so stay with this topic and tighten the missing piece."
            )
            session_type = "CHECK"
        else:
            status_line = (
                "You are close, but the gap is important enough that the tutor should slow down and scaffold more."
            )
            session_type = "REMEDIATE"
            next_action = "remediate"
            remediation_concept = get_primary_remediation_concept(
                user=user,
                concept=concept,
            )
    else:
        status_line = (
            "That shows a real gap in understanding, so the tutor will slow down and scaffold more."
        )
        session_type = "REMEDIATE"
        next_action = "remediate"
        remediation_concept = get_primary_remediation_concept(
            user=user,
            concept=concept,
        )

    next_focus = remediation_concept if remediation_concept else concept
    return {
        "status_line": status_line,
        "session_type": session_type,
        "remediation_concept": remediation_concept,
        "next_focus": next_focus,
        "next_action": next_action,
    }

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
            (
                "You are responsible for the lesson flow. Do not ask the learner to choose the next topic, "
                "the next method, or whether to continue. Instead, decide the next teaching step yourself "
                "and state it clearly."
            ),
            (
                "If the learner asks about an idea that belongs to a later topic, give a short helpful preview, "
                "explicitly say that the full treatment comes later in the course, and then return to the current concept."
            ),
            (
                "Do not permanently switch the lesson to a later topic just because it came up in a question. "
                "Only switch focus when repairing a prerequisite gap is truly necessary."
            ),
            (
                "End each teaching response with a teacher-directed next step tied to the current concept. "
                "Avoid endings like 'Would you like...' or 'Let me know...'."
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
- If the student asks about a later topic, answer briefly, label it as a preview of a later topic, and then return to the current lesson flow.
- Keep control of the lesson sequence yourself. Do not ask the learner which topic to do next.
- Finish by giving the next concrete step in the current lesson, not by offering a menu of options.
- When a visual graph would help, include exactly one fenced code block using the language tag `graph`.
- Inside the `graph` block, use simple `key: value` lines.
- Supported graph fields are:
  - `type: function`
  - `title: ...`
  - `equation: y=x^2` or `equation: x^2`
  - `x_min: ...`
  - `x_max: ...`
  - `y_min: ...`
  - `y_max: ...`
  - `x_label: ...`
  - `y_label: ...`
- Write graph equations in plain parser-friendly math such as `y=x^2-8*x+10`, `y=sqrt(x)`, or `y=(x+2)*(x+5)`.
- Avoid LaTeX graph equations like `\\frac{...}{...}` inside `graph` blocks.
- Only include a graph block for mathematical or quantitative explanations where a plotted graph is genuinely helpful.
- When you include a graph, always set `x_label` and `y_label` to the quantities being represented.
- Use concrete contextual labels whenever possible, such as `time (seconds)`, `distance (metres)`, `price ($)`, `temperature (°C)`, `population`, `velocity (m/s)`, or `probability`.
- For pure algebra with no real-world quantity, use mathematically clear labels like `x value`, `y value`, `input`, or `output` instead of generic axis titles in prose.
- Example graph block:
```graph
type: function
title: Distance over time
equation: y=4*x
x_label: time (seconds)
y_label: distance (metres)
x_min: 0
x_max: 10
y_min: 0
y_max: 45
```
- When a visual diagram would help, include exactly one fenced code block using the language tag `diagram`.
- Inside the `diagram` block, use simple `key: value` lines.
- Supported diagram templates are:
  - Atom diagrams:
    - `type: atom`
    - `title: ...`
    - `element: Carbon`
    - `protons: 6`
    - `neutrons: 6`
    - `shells: 2,4`
  - Geometry diagrams:
    - `type: geometry`
    - `title: ...`
    - `shape: triangle` or `rectangle` or `circle` or `angle`
    - `labels: A,B,C`
    - `side_labels: 3,4,5`
    - `radius_label: r`
    - `angle_label: 60°`
  - Cell diagrams:
    - `type: cell`
    - `title: ...`
    - `cell_type: plant` or `animal`
    - `labels: nucleus,cell membrane,cytoplasm`
  - Molecule diagrams:
    - `type: molecule`
    - `title: ...`
    - `formula: H2O` or `CO2` or `O2` or `CH4` or `NH3`
  - Mitosis diagrams:
    - `type: mitosis`
    - `title: ...`
    - `stage: interphase` or `prophase` or `metaphase` or `anaphase` or `telophase`
    - `labels: chromosomes,spindle fibers,nucleus`
  - Food web diagrams:
    - `type: foodweb`
    - `title: ...`
    - `organisms: Sun,Grass,Rabbit,Fox`
    - `links: Sun>Grass,Grass>Rabbit,Rabbit>Fox`
  - Electric circuit diagrams:
    - `type: circuit`
    - `title: ...`
    - `circuit_type: series` or `parallel`
    - `labels: battery,switch,bulb`
    - `switch_state: open` or `closed`
  - Coordinate-plane geometry diagrams:
    - `type: coordinate-plane`
    - `title: ...`
    - `points: A(1,2),B(4,5),C(-2,3)`
    - `segments: A>B,B>C`
    - `equation: y=x+1`
  - Free-body diagrams:
    - `type: freebody`
    - `title: ...`
    - `object_label: Box`
    - `forces: Normal@up,Weight@down,Friction@left,Applied force@right`
  - Chemical reaction diagrams:
    - `type: reaction`
    - `title: ...`
    - `reactants: Hydrogen,Oxygen`
    - `products: Water`
    - `conditions: Spark energy`
  - Cycle or process diagrams:
    - `type: cycle`
    - `title: ...`
    - `cycle_type: life` or `process`
    - `stages: Egg,Larva,Pupa,Adult`
- Prefer diagrams for atoms, basic geometry, labeled cells, simple molecules, mitosis stages, food webs, electric circuits, coordinate-plane visuals, free-body force diagrams, reaction setups, and process cycles.
- If the visual would be better shown with an external reference image than with the available templates, include exactly one fenced code block using the language tag `image-search`.
- Inside the `image-search` block, use:
  - `title: ...`
  - `query: ...`
  - `reason: ...`
- Use `image-search` only when the built-in graph and diagram templates are not a good fit.
""".strip(),
    })

    return messages


def build_next_step_data(user, current_concept):
    if current_concept.node_type in {"CHAPTER", "CONCEPT"} and current_concept.children.exists():
        first_descendant = get_first_teachable_descendant(current_concept)
        if first_descendant and first_descendant.id != current_concept.id:
            return build_focus_next_step(
                first_descendant,
                "Start",
                f"Start with {first_descendant.name} before moving up to the larger idea of {current_concept.name}.",
            )

    current_mastery = LearnerConceptMastery.objects.filter(
        user=user,
        concept=current_concept,
    ).first()

    current_score = (
        float(current_mastery.mastery_score)
        if current_mastery and current_mastery.mastery_score is not None
        else None
    )

    if current_score is not None and current_score < 0.4:
        return build_focus_next_step(
            current_concept,
            "Remediate",
            f"Stay with {current_concept.name} a little longer so you can repair the foundation before moving on.",
        )

    if current_score is not None and current_score < 0.7:
        return build_focus_next_step(
            current_concept,
            "Continue",
            f"Keep working on {current_concept.name} until the key ideas feel more secure.",
        )

    recommendations = [
        item
        for item in get_personalized_recommendations(user, limit=6)
        if item["concept"].node_type == "SUBTOPIC"
    ]
    same_subject_recommendations = [
        item
        for item in recommendations
        if item["concept"].subject_id == current_concept.subject_id
    ]

    if same_subject_recommendations:
        recommendations = same_subject_recommendations

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
        "subject_id": next_item["concept"].subject_id,
        "action": next_item["action"],
        "reason": next_item["reason"],
    }


def build_focus_next_step(concept, action, reason):
    return {
        "name": concept.name,
        "subject_id": concept.subject_id,
        "action": action,
        "reason": reason,
    }


def build_continue_action_prompt(concept, next_step=None):
    if next_step and next_step.get("name") and next_step["name"] != concept.name:
        return (
            f"Let us look at {next_step['name']} next. Whenever you're ready, click Next and we can begin."
        )

    return (
        f"Let us look deeper into {concept.name} next. Whenever you're ready, click Next and we can begin."
    )


def normalize_check_payload(payload):
    if isinstance(payload, dict):
        return {
            "question": payload.get("question", ""),
            "answer_key": payload.get("answer_key", ""),
        }

    return {
        "question": str(payload or ""),
        "answer_key": "",
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

    concept = selected_concept
   
    concept_switched = False
    previous_concept_name = session.target_concept.name if session.target_concept else None

    if should_switch_concept(session.target_concept, selected_concept):
        session.target_concept = selected_concept
        session.save(update_fields=["target_concept"])
        concept_switched = True

    StudyMessage.objects.create(
        session=session,
        role="user",
        content=query,
    )

    pending_check = get_pending_concept_check(session, concept=selected_concept)

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

        reply = attempt.feedback

        followup_prompt = build_followup_prompt(
            attempt_result=attempt.result,
            concept=pending_check.concept,
            remediation_concept=remediation_concept,
            next_action=decision["next_action"],
            source_message=pending_check.source_message,
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
        if not query or query.strip() == "":
            mastery = get_or_create_mastery(user, selected_concept)
            session_type = determine_session_type(mastery.mastery_score)

            if session_type == "REMEDIATE":
                query = f"Give a very simple explanation of {selected_concept.name} for a beginner."
            elif session_type == "CHECK":
                query = f"Ask a short question to check understanding of {selected_concept.name}."
            else:
                query = f"Give a slightly challenging application question about {selected_concept.name}."
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
        concept=concept,
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

    if (not concept.children.exists()) and should_trigger_concept_check(mastery):
        check_payload = normalize_check_payload(
            generate_concept_check_question(concept, answer)
        )

        create_concept_check(
            session=session,
            concept=concept,
            question=check_payload["question"],
            answer_key=check_payload.get("answer_key", ""),
            source_message=assistant_message,
        )

        answer = f"{answer}\n\n{check_payload['question']}"
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


def answer_tutor_request(
    user,
    query: str,
    concept_name: str | None = None,
    subject=None,
):
    session = get_or_create_session(user)
    raw_query = (query or "").strip()
    continue_requested = raw_query == "__NEXT__"
    if continue_requested:
        raw_query = ""

    selected_concept = get_concept_from_selection(
        raw_query,
        concept_name,
        subject=subject,
    )
    if selected_concept is None:
        return None

    concept = selected_concept
    concept_switched = False
    previous_concept_name = (
        session.target_concept.name if session.target_concept else None
    )

    if should_switch_concept(session.target_concept, selected_concept):
        session.target_concept = selected_concept
        session.save(update_fields=["target_concept"])
        concept_switched = True

    pending_check = get_pending_concept_check(session, concept=selected_concept)

    if raw_query and pending_check and pending_check.concept_id == selected_concept.id:
        StudyMessage.objects.create(
            session=session,
            concept=selected_concept,
            role="user",
            content=raw_query,
        )

        attempt = evaluate_concept_check_answer(pending_check, raw_query)
        mastery = update_mastery_from_concept_check(
            user=user,
            concept=pending_check.concept,
            score=attempt.score or 0.0,
        )

        decision = decide_concept_check_outcome(
            user=user,
            concept=pending_check.concept,
            mastery=mastery,
            attempt=attempt,
        )

        session.session_type = decision["session_type"]
        session.save(update_fields=["session_type"])

        if decision["next_action"] == "remediate":
            mastery.hint_level = min(3, mastery.hint_level + 1)
        else:
            mastery.hint_level = 0
        mastery.save(update_fields=["hint_level"])

        remediation_concept = decision["remediation_concept"]
        next_focus = decision["next_focus"]
        status_line = decision["status_line"]

        reply = attempt.feedback

        followup_prompt = build_followup_prompt(
            attempt_result=attempt.result,
            concept=pending_check.concept,
            remediation_concept=remediation_concept,
            next_action=decision["next_action"],
            source_message=pending_check.source_message,
        )
        reply = f"{reply}\n\n{followup_prompt}"

        concept_switched = False
        previous_concept_name = (
            session.target_concept.name if session.target_concept else None
        )

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

        StudyMessage.objects.create(
            session=session,
            concept=next_focus,
            role="assistant",
            content=reply,
        )

        if decision["next_action"] == "advance":
            next_step = build_next_step_data(user, next_focus)
        else:
            next_step = build_focus_next_step(
                next_focus,
                "Remediate" if decision["next_action"] == "remediate" else "Continue",
                (
                    f"Stay with {next_focus.name} and complete the guided follow-up before moving on."
                ),
            )

        return {
            "query": raw_query,
            "answer": reply,
            "focused_concept": next_focus.name,
            "subject_id": next_focus.subject_id,
            "concept_switched": concept_switched,
            "previous_concept": previous_concept_name,
            "mastery_score": mastery.mastery_score,
            "session_type": session.session_type,
            "next_step": next_step,
            "next_action_prompt": followup_prompt,
            "next_action_type": "respond",
        }

    mastery = get_or_create_mastery(user, concept)
    pending_check = get_pending_concept_check(session, concept=concept)
    latest_assistant_message = get_latest_concept_message(
        session,
        concept,
        role="assistant",
    )

    if (
        not raw_query
        and latest_assistant_message is not None
        and not continue_requested
    ):
        if pending_check and pending_check.concept_id == concept.id:
            next_action_prompt = "Continue by answering the quick check when you're ready."
            next_action_type = "respond"
            next_step = build_focus_next_step(
                concept,
                "Continue",
                f"Stay with {concept.name} and answer the quick check to keep building mastery.",
            )
        else:
            next_step = build_next_step_data(user, concept)
            next_action_prompt = build_continue_action_prompt(concept, next_step)
            next_action_type = "advance"

        return {
            "query": "",
            "answer": latest_assistant_message.content,
            "focused_concept": concept.name,
            "subject_id": concept.subject_id,
            "concept_switched": concept_switched,
            "previous_concept": previous_concept_name,
            "mastery_score": mastery.mastery_score,
            "session_type": determine_session_type(mastery.mastery_score),
            "next_step": next_step,
            "next_action_prompt": next_action_prompt,
            "next_action_type": next_action_type,
        }

    effective_query = (
        build_continue_action_prompt(concept, build_next_step_data(user, concept))
        if continue_requested
        else (raw_query or build_autostart_query(concept, mastery, user=user))
    )

    StudyMessage.objects.create(
        session=session,
        concept=concept,
        role="user",
        content=effective_query,
    )

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
            "query": effective_query,
            "answer": answer,
            "focused_concept": concept.name,
            "subject_id": concept.subject_id,
            "concept_switched": concept_switched,
            "previous_concept": previous_concept_name,
            "mastery_score": None,
            "session_type": session.session_type,
            "next_step": build_next_step_data(user, concept),
            "next_action_prompt": None,
            "next_action_type": None,
        }

    search_query = (
        f"{concept.name}\n\n{effective_query}" if concept_name else effective_query
    )
    chunks = semantic_search(
        search_query,
        limit=5,
        subject_id=subject.id if subject else None,
    )
    context = "\n\n".join(chunk.content for chunk in chunks) if chunks else ""
    graph_context = build_graph_context(concept)
    history = get_recent_history(session, concept=concept)

    weak_concepts = get_weak_concepts(user, subject=subject or concept.subject)
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
        concept=concept,
    )

    if session.session_type == "REMEDIATE" and unmet_prereqs:
        mastery.hint_level = min(3, mastery.hint_level + 1)
    else:
        mastery.hint_level = 0
    mastery.save(update_fields=["hint_level"])

    messages = build_messages(
        query=effective_query,
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
        concept=concept,
        role="assistant",
        content=answer,
    )

    if (not concept.children.exists()) and should_trigger_concept_check(mastery):
        check_payload = normalize_check_payload(
            generate_concept_check_question(concept, answer)
        )
        create_concept_check(
            session=session,
            concept=concept,
            question=check_payload["question"],
            answer_key=check_payload.get("answer_key", ""),
            source_message=assistant_message,
        )
        answer = f"{answer}\n\n{check_payload['question']}"
        updated_mastery_score = mastery.mastery_score
        next_step = build_focus_next_step(
            concept,
            "Continue",
            f"Stay with {concept.name} and answer the quick check before moving to another topic.",
        )
        next_action_prompt = "Answer the quick check below before moving to the next part of the lesson."
        next_action_type = "respond"
    else:
        mastery = update_mastery(user=user, concept=concept, correct=True)
        session.session_type = determine_session_type(mastery.mastery_score)
        session.save(update_fields=["session_type"])
        updated_mastery_score = mastery.mastery_score
        next_step = build_next_step_data(user, concept)
        next_action_prompt = build_continue_action_prompt(concept, next_step)
        next_action_type = "advance"

    assistant_message.content = answer
    assistant_message.save(update_fields=["content"])

    return {
        "query": effective_query,
        "answer": answer,
        "focused_concept": concept.name,
        "subject_id": concept.subject_id,
        "subject": subject.name if subject else None,
        "graph_context": graph_context,
        "concept_switched": concept_switched,
        "previous_concept": previous_concept_name,
        "mastery_score": updated_mastery_score,
        "session_type": session.session_type,
        "next_step": next_step,
        "next_action_prompt": next_action_prompt,
        "next_action_type": next_action_type,
    }
