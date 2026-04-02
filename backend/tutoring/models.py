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


class ConceptCheck(models.Model):
    session = models.ForeignKey(
        StudySession,
        on_delete=models.CASCADE,
        related_name="checks",
    )
    concept = models.ForeignKey("knowledge.Concept", on_delete=models.CASCADE)
    question = models.TextField()
    user_answer = models.TextField(blank=True)
    score = models.FloatField(default=0.0)
    feedback = models.TextField(blank=True)
    confidence = models.FloatField(default=0.0)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Check for {self.concept.name} in Session {self.session.id}"