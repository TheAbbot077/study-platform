from pgvector.django import L2Distance
from uploads.services import get_embedding
from .models import DocumentChunk


def semantic_search(query: str, limit=5):
    query_embedding = get_embedding(query)

    chunks = (
        DocumentChunk.objects.annotate(
            distance=L2Distance("embedding", query_embedding)
        )
        .order_by("distance")[:limit]
    )

    return chunks