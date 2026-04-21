from knowledge.models import StudentConceptMastery


def update_mastery(student, concept, result):
    """
    result: "correct", "partial", "incorrect"
    """

    mastery, _ = StudentConceptMastery.objects.get_or_create(
        student=student,
        concept=concept,
    )

    # Convert result → numeric delta
    if result == "correct":
        delta = 0.1
    elif result == "partial":
        delta = 0.04
    else:
        delta = -0.08

    # Update score
    mastery.score = max(0.0, min(1.0, mastery.score + delta))

    # Map score → level
    if mastery.score < 0.3:
        mastery.mastery_level = "LOW"
    elif mastery.score < 0.6:
        mastery.mastery_level = "MEDIUM"
    elif mastery.score < 0.85:
        mastery.mastery_level = "HIGH"
    else:
        mastery.mastery_level = "MASTERED"

    mastery.save()

    return mastery