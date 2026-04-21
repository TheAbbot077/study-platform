from django.conf import settings
from django.db import models


class Subject(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="subjects",
    )
    name = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "name")
        ordering = ["name"]

    def __str__(self):
        return self.name


class Document(models.Model):
    STATUS_CHOICES = [
        ("uploaded", "Uploaded"),
        ("processing", "Processing"),
        ("ready", "Ready"),
        ("failed", "Failed"),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="documents",
    )
    subject = models.ForeignKey(
        Subject,
        on_delete=models.CASCADE,
        related_name="documents",
        null=True,
        blank=True,
    )
    title = models.CharField(max_length=255)
    file = models.FileField(upload_to="documents/")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="uploaded")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.title