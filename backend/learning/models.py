from django.conf import settings
from django.db import models


class LearnerConceptMastery(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    concept = models.ForeignKey("knowledge.Concept", on_delete=models.CASCADE)
    mastery_score = models.FloatField(default=0.0)
    stability = models.FloatField(default=1.0)
    difficulty = models.FloatField(default=0.5)
    practice_count = models.IntegerField(default=0)
    last_practiced = models.DateTimeField(null=True, blank=True)
    hint_level = models.IntegerField(default=0)

    class Meta:
        unique_together = ("user", "concept")

    def __str__(self):
        return f"{self.user.username} - {self.concept.name} ({self.mastery_score})"


class LearnerConceptEvent(models.Model):
    EVENT_TYPES = [
        ("teach", "Teach"),
        ("concept_check", "Concept Check"),
        ("reinforcement", "Reinforcement"),
        ("remediation", "Remediation"),
        ("manual", "Manual"),
    ]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    concept = models.ForeignKey("knowledge.Concept", on_delete=models.CASCADE)
    event_type = models.CharField(max_length=30, choices=EVENT_TYPES)
    score_before = models.FloatField(default=0.0)
    score_after = models.FloatField(default=0.0)
    score_delta = models.FloatField(default=0.0)
    practice_count_after = models.IntegerField(default=0)
    source_session_type = models.CharField(max_length=20, blank=True, default="")
    metadata = models.JSONField(blank=True, default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return (
            f"{self.user.username} - {self.concept.name} - "
            f"{self.event_type} ({self.score_before:.2f}->{self.score_after:.2f})"
        )
