from django.db import models
from pgvector.django import VectorField


class Concept(models.Model):
    name = models.CharField(max_length=255, unique=True)
    description = models.TextField(blank=True)
    difficulty = models.FloatField(default=0.5)
    embedding = VectorField(dimensions=1536, null=True, blank=True)
    is_general_knowledge = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
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

    def __str__(self):
        return f"{self.from_concept} -{self.relation_type}-> {self.to_concept}"


class DocumentChunk(models.Model):
    document = models.ForeignKey(
        "uploads.Document",
        on_delete=models.CASCADE,
        related_name="chunks",
    )
    content = models.TextField()
    chunk_index = models.IntegerField()
    embedding = VectorField(dimensions=1536, null=True, blank=True)

    def __str__(self):
        return f"Chunk {self.chunk_index} - {self.document.title}"