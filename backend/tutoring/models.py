from django.conf import settings
from django.db import models


class StudySession(models.Model):
    SESSION_TYPES = [
        ("TEACH", "Teach"),
        ("CHECK", "Check"),
        ("REMEDIATE", "Remediate"),
        ("REINFORCE", "Reinforce"),
    ]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    target_concept = models.ForeignKey(
        "knowledge.Concept",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    session_type = models.CharField(max_length=20, choices=SESSION_TYPES, default="TEACH")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        if self.target_concept:
            return f"{self.user.username} - {self.session_type} - {self.target_concept.name}"
        return f"{self.user.username} - {self.session_type}"


class StudyMessage(models.Model):
    ROLE_CHOICES = [
        ("system", "System"),
        ("user", "User"),
        ("assistant", "Assistant"),
    ]

    session = models.ForeignKey(
        StudySession,
        on_delete=models.CASCADE,
        related_name="messages",
    )
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.role} - Session {self.session.id}"


class ConceptCheckStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    ANSWERED = "answered", "Answered"
    EVALUATED = "evaluated", "Evaluated"
    CANCELLED = "cancelled", "Cancelled"


class ConceptCheckResult(models.TextChoices):
    CORRECT = "correct", "Correct"
    PARTIAL = "partial", "Partial"
    INCORRECT = "incorrect", "Incorrect"


class ConceptCheck(models.Model):
    session = models.ForeignKey(
        StudySession,
        on_delete=models.CASCADE,
        related_name="concept_checks",
    )
    concept = models.ForeignKey(
        "knowledge.Concept",
        on_delete=models.CASCADE,
        related_name="concept_checks",
    )
    source_message = models.ForeignKey(
        StudyMessage,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="generated_concept_checks",
    )
    question = models.TextField()
    status = models.CharField(
        max_length=20,
        choices=ConceptCheckStatus.choices,
        default=ConceptCheckStatus.PENDING,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    answered_at = models.DateTimeField(null=True, blank=True)
    evaluated_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancel_reason = models.CharField(max_length=255, blank=True)

    def __str__(self):
        return f"{self.concept.name} - {self.status}"


class ConceptCheckAttempt(models.Model):
    concept_check = models.ForeignKey(
        ConceptCheck,
        on_delete=models.CASCADE,
        related_name="attempts",
    )
    student_answer = models.TextField()
    feedback = models.TextField(blank=True)
    result = models.CharField(
        max_length=20,
        choices=ConceptCheckResult.choices,
        null=True,
        blank=True,
    )
    score = models.FloatField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Attempt for {self.concept_check.concept.name}"