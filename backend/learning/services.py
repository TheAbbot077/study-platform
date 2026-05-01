from datetime import timedelta

from django.utils import timezone

from .models import LearnerConceptEvent, LearnerConceptMastery


def ensure_concept_mastery(user, concept):
    mastery_obj, _ = LearnerConceptMastery.objects.get_or_create(
        user=user,
        concept=concept,
        defaults={
            "mastery_score": 0.0,
            "stability": 1.0,
            "difficulty": 0.5,
            "practice_count": 0,
            "last_practiced": None,
        },
    )
    return mastery_obj


def _record_mastery_event(
    mastery_obj,
    *,
    event_type,
    score_before,
    score_after,
    source_session_type="",
    metadata=None,
):
    LearnerConceptEvent.objects.create(
        user=mastery_obj.user,
        concept=mastery_obj.concept,
        event_type=event_type,
        score_before=round(float(score_before), 4),
        score_after=round(float(score_after), 4),
        score_delta=round(float(score_after) - float(score_before), 4),
        practice_count_after=mastery_obj.practice_count,
        source_session_type=source_session_type or "",
        metadata=metadata or {},
    )


def apply_mastery_delta(
    user,
    concept,
    *,
    delta,
    event_type,
    source_session_type="",
    metadata=None,
    floor=0.0,
    ceiling=1.0,
    increment_practice=True,
    update_last_practiced=True,
):
    mastery_obj = ensure_concept_mastery(user, concept)
    score_before = float(mastery_obj.mastery_score or 0.0)
    score_after = max(float(floor), min(float(ceiling), score_before + float(delta)))

    mastery_obj.mastery_score = score_after

    if increment_practice:
        mastery_obj.practice_count += 1

    if update_last_practiced:
        mastery_obj.last_practiced = timezone.now()

    mastery_obj.save()

    _record_mastery_event(
        mastery_obj,
        event_type=event_type,
        score_before=score_before,
        score_after=score_after,
        source_session_type=source_session_type,
        metadata=metadata,
    )
    return mastery_obj


def apply_mastery_score(
    user,
    concept,
    *,
    new_score,
    event_type,
    source_session_type="",
    metadata=None,
    increment_practice=True,
    update_last_practiced=True,
):
    mastery_obj = ensure_concept_mastery(user, concept)
    score_before = float(mastery_obj.mastery_score or 0.0)
    score_after = max(0.0, min(1.0, float(new_score)))

    mastery_obj.mastery_score = score_after

    if increment_practice:
        mastery_obj.practice_count += 1

    if update_last_practiced:
        mastery_obj.last_practiced = timezone.now()

    mastery_obj.save()

    _record_mastery_event(
        mastery_obj,
        event_type=event_type,
        score_before=score_before,
        score_after=score_after,
        source_session_type=source_session_type,
        metadata=metadata,
    )
    return mastery_obj


def apply_concept_check_score(
    user,
    concept,
    *,
    score,
    source_session_type="CHECK",
    metadata=None,
):
    mastery = ensure_concept_mastery(user, concept)
    current = float(mastery.mastery_score or 0.0)
    new_score = (current * 0.7) + (float(score) * 0.3)
    new_score = max(0.0, min(1.0, new_score))

    if score >= 0.8:
        mastery.stability = min(5.0, mastery.stability + 0.1)
        mastery.difficulty = max(0.0, mastery.difficulty - 0.05)
    elif score >= 0.5:
        mastery.stability = min(5.0, mastery.stability + 0.03)
    else:
        mastery.stability = max(0.1, mastery.stability - 0.08)
        mastery.difficulty = min(1.0, mastery.difficulty + 0.05)

    mastery.save(update_fields=["stability", "difficulty"])

    return apply_mastery_score(
        user,
        concept,
        new_score=new_score,
        event_type="concept_check",
        source_session_type=source_session_type,
        metadata={
            "check_score": round(float(score), 4),
            **(metadata or {}),
        },
        increment_practice=True,
        update_last_practiced=True,
    )


def get_progress_summary(user):
    mastery_qs = LearnerConceptMastery.objects.filter(user=user).select_related("concept")

    total_concepts = mastery_qs.count()
    mastered = mastery_qs.filter(mastery_score__gte=0.8).count()
    in_progress = mastery_qs.filter(mastery_score__gte=0.4, mastery_score__lt=0.8).count()
    struggling = mastery_qs.filter(mastery_score__lt=0.4).count()

    average_mastery = 0.0
    if total_concepts > 0:
        average_mastery = sum(item.mastery_score for item in mastery_qs) / total_concepts

    strongest = (
        mastery_qs.order_by("-mastery_score", "-practice_count").first()
        if total_concepts > 0
        else None
    )
    weakest = (
        mastery_qs.order_by("mastery_score", "practice_count").first()
        if total_concepts > 0
        else None
    )

    recent_events = list(
        LearnerConceptEvent.objects.filter(user=user)
        .select_related("concept")
        .order_by("-created_at")[:5]
    )

    return {
        "total_concepts": total_concepts,
        "mastered": mastered,
        "in_progress": in_progress,
        "struggling": struggling,
        "average_mastery": round(average_mastery, 2),
        "strongest_concept": strongest.concept.name if strongest else None,
        "weakest_concept": weakest.concept.name if weakest else None,
        "recent_activity": [
            {
                "concept_name": event.concept.name,
                "event_type": event.event_type,
                "score_after": round(float(event.score_after), 2),
                "created_at": event.created_at.isoformat(),
            }
            for event in recent_events
        ],
    }


def _days_since_last_practiced(item):
    if not item.last_practiced:
        return 999
    delta = timezone.now() - item.last_practiced
    return delta.days


def _mastery_label(score):
    if score < 0.4:
        return "REMEDIATE"
    if score < 0.7:
        return "CHECK"
    return "REINFORCE"


def _determine_reinforcement_bucket(item):
    days_since = _days_since_last_practiced(item)
    mastery = float(item.mastery_score)

    if mastery < 0.35:
        return {
            "bucket": "urgent",
            "action": "Remediate",
            "reason": "Low mastery needs immediate reinforcement.",
            "suggested_interval_days": 1,
        }

    if mastery < 0.60:
        return {
            "bucket": "soon",
            "action": "Review",
            "reason": "Understanding is forming but still unstable.",
            "suggested_interval_days": 2,
        }

    if days_since >= 7:
        return {
            "bucket": "refresh",
            "action": "Refresh",
            "reason": "Previously learned concept is due for spaced reinforcement.",
            "suggested_interval_days": 7,
        }

    return {
        "bucket": "stable",
        "action": "Maintain",
        "reason": "Concept is stable and does not need immediate review.",
        "suggested_interval_days": 14,
    }


def _build_review_timing(item, decision):
    interval_days = int(decision["suggested_interval_days"])
    if decision["bucket"] == "urgent":
        next_review_at = timezone.now()
    elif not item.last_practiced:
        next_review_at = timezone.now()
    else:
        next_review_at = item.last_practiced + timedelta(days=interval_days)

    now = timezone.now()
    is_due = next_review_at <= now
    days_until_due = max(0, (next_review_at.date() - now.date()).days)

    if is_due:
        due_status = "due_now"
        review_reason = "Ready for reinforcement now."
    elif days_until_due <= 1:
        due_status = "due_soon"
        review_reason = "Approaching the next review window."
    else:
        due_status = "scheduled"
        review_reason = "Scheduled for a later review window."

    return {
        "next_review_at": next_review_at.isoformat(),
        "is_due": is_due,
        "days_until_due": days_until_due,
        "due_status": due_status,
        "review_reason": review_reason,
    }


def get_reinforcement_plan(user, limit=5):
    mastery_qs = (
        LearnerConceptMastery.objects.filter(user=user)
        .select_related("concept", "concept__subject")
        .order_by("mastery_score", "last_practiced")
    )

    plan = []

    for item in mastery_qs:
        decision = _determine_reinforcement_bucket(item)
        if decision["bucket"] == "stable":
            continue

        prerequisites = list(
            item.concept.prerequisites.values_list("name", flat=True)[:3]
        )
        timing = _build_review_timing(item, decision)

        plan.append(
            {
                "concept_id": item.concept.id,
                "concept_name": item.concept.name,
                "subject_id": item.concept.subject_id,
                "concept": item.concept,
                "mastery_score": round(float(item.mastery_score), 2),
                "mastery_percent": int(float(item.mastery_score) * 100),
                "practice_count": item.practice_count,
                "last_practiced": (
                    item.last_practiced.isoformat() if item.last_practiced else None
                ),
                "days_since_practice": _days_since_last_practiced(item),
                "priority": decision["bucket"],
                "action": decision["action"],
                "reason": decision["reason"],
                "suggested_interval_days": decision["suggested_interval_days"],
                "prerequisites": prerequisites,
                **timing,
            }
        )

    priority_order = {"due_now": 0, "due_soon": 1, "scheduled": 2}

    plan.sort(
        key=lambda x: (
            priority_order.get(x["due_status"], 99),
            x["days_until_due"],
            x["mastery_score"],
            -x["days_since_practice"],
        )
    )

    return {
        "count": len(plan[:limit]),
        "items": plan[:limit],
    }


def get_next_reinforcement_target(user):
    plan = get_reinforcement_plan(user, limit=1)
    if not plan["items"]:
        return None
    return plan["items"][0]


def get_personalized_recommendations(user, limit=3):
    mastery_qs = (
        LearnerConceptMastery.objects.filter(user=user)
        .select_related("concept", "concept__subject")
        .order_by("mastery_score", "last_practiced")
    )

    recommendations = []

    for item in mastery_qs:
        decision = _determine_reinforcement_bucket(item)
        if decision["bucket"] == "stable":
            continue

        timing = _build_review_timing(item, decision)
        recommendations.append(
            {
                "concept": item.concept,
                "subject_id": item.concept.subject_id,
                "action": decision["action"],
                "reason": decision["reason"],
                "priority": decision["bucket"],
                "mastery_score": float(item.mastery_score),
                "mastery_label": _mastery_label(float(item.mastery_score)),
                "practice_count": item.practice_count,
                "days_since_practice": _days_since_last_practiced(item),
                "due_status": timing["due_status"],
                "days_until_due": timing["days_until_due"],
            }
        )

    due_order = {"due_now": 0, "due_soon": 1, "scheduled": 2}
    recommendations.sort(
        key=lambda x: (
            due_order.get(x["due_status"], 99),
            x["days_until_due"],
            x["mastery_score"],
            -x["days_since_practice"],
        )
    )

    return recommendations[:limit]


def get_blocked_by(user, concept, threshold=0.4):
    blockers = []

    for prereq in concept.prerequisites.all():
        mastery = LearnerConceptMastery.objects.filter(
            user=user,
            concept=prereq,
        ).first()

        score = float(mastery.mastery_score) if mastery else 0.0

        if score < threshold:
            blockers.append(
                {
                    "concept": prereq,
                    "score": score,
                    "mastery_label": _mastery_label(score),
                }
            )

    blockers.sort(key=lambda item: item["score"])
    return blockers


def is_concept_unlocked(user, concept, threshold=0.4):
    return len(get_blocked_by(user, concept, threshold=threshold)) == 0


def get_concept_mastery(user, concept):
    return LearnerConceptMastery.objects.filter(
        user=user,
        concept=concept,
    ).first()


def get_mastery_score(user, concept):
    mastery = get_concept_mastery(user, concept)
    if not mastery:
        return 0.0
    return float(mastery.mastery_score)


def update_mastery(user, concept, delta=0.0, floor=0.0, ceiling=1.0):
    return apply_mastery_delta(
        user,
        concept,
        delta=delta,
        event_type="manual",
        floor=floor,
        ceiling=ceiling,
    )


def update_mastery_score(
    user,
    concept,
    new_score,
    increment_practice=True,
    update_last_practiced=True,
):
    return apply_mastery_score(
        user,
        concept,
        new_score=new_score,
        event_type="manual",
        increment_practice=increment_practice,
        update_last_practiced=update_last_practiced,
    )
