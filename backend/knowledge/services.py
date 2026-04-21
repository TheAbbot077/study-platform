from pgvector.django import L2Distance
from uploads.services import get_embedding
from .models import DocumentChunk


def semantic_search(query: str, limit=5, subject_id=None):
    query_embedding = get_embedding(query)

    chunks = DocumentChunk.objects.all()

    if subject_id:
        chunks = chunks.filter(document__subject_id=subject_id)

    chunks = (
        chunks.annotate(
            distance=L2Distance("embedding", query_embedding)
        )
        .order_by("distance")[:limit]
    )

    return chunks