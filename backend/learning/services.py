from knowledge.models import Concept
from learning.models import LearnerConceptMastery


UNLOCK_THRESHOLD = 0.6
RECOMMENDED_THRESHOLD = 0.85
MASTERED_THRESHOLD = 0.85


def get_mastery_record(user, concept):
    return LearnerConceptMastery.objects.filter(
        user=user,
        concept=concept,
    ).first()


def get_mastery_score(user, concept):
    mastery = get_mastery_record(user, concept)
    return mastery.mastery_score if mastery else 0.0


def get_practice_count(user, concept):
    mastery = get_mastery_record(user, concept)
    return mastery.practice_count if mastery else 0


def get_mastery_label(score):
    if score < 0.3:
        return "Beginner"
    elif score < 0.6:
        return "Developing"
    elif score < 0.85:
        return "Strong"
    return "Mastered"


def get_user_concepts(user):
    """
    Return concepts that belong to this user's subjects.
    """
    return Concept.objects.filter(
        subject__user=user
    ).prefetch_related("prerequisites", "unlocks").distinct()

def get_subject_concepts(subject):
    return Concept.objects.filter(
        subject=subject
    ).prefetch_related("prerequisites", "unlocks").distinct()

def is_concept_unlocked(user, concept, threshold=UNLOCK_THRESHOLD):
    prereqs = concept.prerequisites.all()

    if not prereqs.exists():
        return True

    for prereq in prereqs:
        score = get_mastery_score(user, prereq)
        if score < threshold:
            return False

    return True


def get_unlocked_concepts(user):
    concepts = get_user_concepts(user)
    return [concept for concept in concepts if is_concept_unlocked(user, concept)]


def get_locked_concepts(user):
    concepts = get_user_concepts(user)
    return [concept for concept in concepts if not is_concept_unlocked(user, concept)]


def get_blocked_by(user, concept, threshold=UNLOCK_THRESHOLD):
    blockers = []

    for prereq in concept.prerequisites.all():
        score = get_mastery_score(user, prereq)
        if score < threshold:
            blockers.append({
                "concept": prereq,
                "score": score,
                "mastery_label": get_mastery_label(score),
            })

    blockers.sort(key=lambda item: item["score"])
    return blockers


def get_mastered_concepts(user, threshold=MASTERED_THRESHOLD):
    concepts = get_user_concepts(user)
    mastered = []

    for concept in concepts:
        score = get_mastery_score(user, concept)
        if score >= threshold:
            mastered.append({
                "concept": concept,
                "score": score,
                "mastery_label": get_mastery_label(score),
            })

    return mastered


def get_progress_summary(user):
    all_concepts = get_user_concepts(user).count()
    unlocked = len(get_unlocked_concepts(user))
    locked = len(get_locked_concepts(user))
    mastered = len(get_mastered_concepts(user))

    return {
        "total_concepts": all_concepts,
        "unlocked_concepts": unlocked,
        "locked_concepts": locked,
        "mastered_concepts": mastered,
    }


def get_concept_leverage(concept):
    """
    Higher leverage means this concept unlocks more future concepts.
    """
    return concept.unlocks.count()


def build_recommendation_reason(action, concept, score, practice_count, blockers=None):
    if action == "remediate":
        return (
            f"Your mastery in {concept.name} is still low, so strengthening it now "
            "will improve your foundation."
        )

    if action == "reinforce":
        return (
            f"You have started {concept.name}, but your understanding is still developing. "
            "A bit more practice should help solidify it."
        )

    if action == "advance":
        if practice_count == 0:
            return (
                f"You are ready to begin {concept.name} because its prerequisites are in place."
            )
        return (
            f"You are ready to push further in {concept.name} and build on what you already know."
        )

    if action == "prepare" and blockers:
        blocker_names = ", ".join([item["concept"].name for item in blockers[:2]])
        return (
            f"{concept.name} is almost available, but first strengthen: {blocker_names}."
        )

    return f"{concept.name} is a good next concept to focus on."


def get_recommendation_action(score, practice_count, unlocked):
    if unlocked:
        if score < 0.4:
            return "remediate"
        if score < 0.7:
            return "reinforce"
        if practice_count == 0:
            return "advance"
        if score < RECOMMENDED_THRESHOLD:
            return "advance"
        return None

    return "prepare"


def get_recommendation_priority(score, practice_count, unlocked, leverage, blockers_count=0):
    """
    Higher score = stronger recommendation priority.
    """
    priority = 0

    if unlocked:
        priority += 40
    else:
        priority += 10

    if score < 0.4:
        priority += 35
    elif score < 0.7:
        priority += 25
    elif score < RECOMMENDED_THRESHOLD:
        priority += 10

    if practice_count == 0:
        priority += 20

    priority += min(leverage * 5, 20)

    if not unlocked:
        priority -= blockers_count * 8

    return priority


def get_personalized_recommendations(user, limit=5):
    concepts = get_user_concepts(user)
    recommendations = []

    for concept in concepts:
        unlocked = is_concept_unlocked(user, concept)
        score = get_mastery_score(user, concept)
        practice_count = get_practice_count(user, concept)
        leverage = get_concept_leverage(concept)

        blockers = get_blocked_by(user, concept) if not unlocked else []
        action = get_recommendation_action(score, practice_count, unlocked)

        if action is None:
            continue

        if not unlocked and len(blockers) == 0:
            continue

        reason = build_recommendation_reason(
            action=action,
            concept=concept,
            score=score,
            practice_count=practice_count,
            blockers=blockers,
        )

        priority_score = get_recommendation_priority(
            score=score,
            practice_count=practice_count,
            unlocked=unlocked,
            leverage=leverage,
            blockers_count=len(blockers),
        )

        recommendations.append({
            "concept": concept,
            "score": score,
            "mastery_label": get_mastery_label(score),
            "action": action,
            "reason": reason,
            "practice_count": practice_count,
            "is_unlocked": unlocked,
            "priority_score": priority_score,
            "blocked_by": blockers,
        })

    recommendations.sort(
        key=lambda item: (-item["priority_score"], item["score"], item["concept"].name.lower())
    )

    return recommendations[:limit]


def get_recommended_concepts(user, limit=5):
    """
    Backward-compatible wrapper so older views/pages keep working.
    """
    return get_personalized_recommendations(user, limit=limit)