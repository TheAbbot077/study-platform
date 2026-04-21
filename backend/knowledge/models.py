from django.db import models
from pgvector.django import VectorField


class Concept(models.Model):
    subject = models.ForeignKey(
        "uploads.Subject",
        on_delete=models.CASCADE,
        related_name="concepts",
        null=True,
        blank=True,
    )
    source_document = models.ForeignKey(
        "uploads.Document",
        on_delete=models.SET_NULL,
        related_name="concepts",
        null=True,
        blank=True,
    )
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    prerequisites = models.ManyToManyField(
        "self",
        symmetrical=False,
        blank=True,
        related_name="unlocks",
    )

    class Meta:
        unique_together = ("subject", "name")
        ordering = ["name"]

    def __str__(self):
        if self.subject:
            return f"{self.name} ({self.subject.name})"
        return self.name


class ConceptRelation(models.Model):
    RELATION_TYPES = [
        ("PREREQ", "Prerequisite"),
        ("RELATED", "Related"),
        ("PART_OF", "Part Of"),
    ]

    from_concept = models.ForeignKey(
        "Concept",
        related_name="outgoing_relations",
        on_delete=models.CASCADE,
    )
    to_concept = models.ForeignKey(
        "Concept",
        related_name="incoming_relations",
        on_delete=models.CASCADE,
    )
    relation_type = models.CharField(max_length=20, choices=RELATION_TYPES)

    class Meta:
        unique_together = ("from_concept", "to_concept", "relation_type")

    def __str__(self):
        return f"{self.from_concept} -{self.relation_type}-> {self.to_concept}"


class DocumentChunk(models.Model):
    document = models.ForeignKey(
        "uploads.Document",
        on_delete=models.CASCADE,
        related_name="chunks",
    )
    chunk_index = models.IntegerField(default=0)
    content = models.TextField()
    embedding = VectorField(dimensions=1536, null=True, blank=True)

    class Meta:
        ordering = ["chunk_index"]

    def __str__(self):
        return f"Chunk {self.chunk_index} from {self.document.title}"