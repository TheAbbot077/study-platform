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

    class Meta:
        unique_together = ("user", "concept")

    def __str__(self):
        return f"{self.user.username} - {self.concept.name} ({self.mastery_score})"