import heapq

from pgvector.django import L2Distance
from uploads.services import get_embedding
from .models import Concept, DocumentChunk


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


def _concept_sort_key(concept):
    source_document = concept.source_document
    document_rank = source_document.created_at.isoformat() if source_document else ""
    document_id = source_document.id if source_document else 0
    node_rank = {"CHAPTER": 0, "CONCEPT": 1, "SUBTOPIC": 2}.get(
        getattr(concept, "node_type", "CONCEPT"),
        1,
    )
    parent_name = concept.parent.name.lower() if getattr(concept, "parent", None) else ""
    return (
        document_rank,
        document_id,
        concept.syllabus_order,
        node_rank,
        parent_name,
        concept.name.lower(),
        concept.id,
    )


def rebuild_subject_syllabus(subject):
    concepts = list(
        Concept.objects.filter(subject=subject)
        .select_related("source_document")
        .prefetch_related("prerequisites")
    )

    if not concepts:
        return []

    concept_by_id = {concept.id: concept for concept in concepts}
    indegree = {concept.id: 0 for concept in concepts}
    outgoing = {concept.id: [] for concept in concepts}
    prereq_depth = {concept.id: 0 for concept in concepts}

    for concept in concepts:
        subject_prereqs = [
            prereq
            for prereq in concept.prerequisites.all()
            if prereq.subject_id == concept.subject_id and prereq.id in concept_by_id
        ]
        indegree[concept.id] = len(subject_prereqs)

        for prereq in subject_prereqs:
            outgoing[prereq.id].append(concept.id)

        parent = getattr(concept, "parent", None)
        if parent and parent.id in concept_by_id:
            indegree[concept.id] += 1
            outgoing[parent.id].append(concept.id)

    heap = []
    for concept in concepts:
        if indegree[concept.id] == 0:
            heapq.heappush(heap, (_concept_sort_key(concept), concept.id))

    ordered_ids = []

    while heap:
        _, concept_id = heapq.heappop(heap)
        ordered_ids.append(concept_id)

        for dependent_id in outgoing[concept_id]:
            dependent = concept_by_id[dependent_id]
            current = concept_by_id[concept_id]
            if dependent.prerequisites.filter(id=current.id).exists():
                prereq_depth[dependent_id] = max(
                    prereq_depth[dependent_id],
                    prereq_depth[concept_id] + 1,
                )
            indegree[dependent_id] -= 1

            if indegree[dependent_id] == 0:
                heapq.heappush(heap, (_concept_sort_key(dependent), dependent_id))

    if len(ordered_ids) < len(concepts):
        remaining_ids = [
            concept.id for concept in concepts if concept.id not in set(ordered_ids)
        ]
        remaining_ids.sort(
            key=lambda concept_id: (
                indegree[concept_id],
                _concept_sort_key(concept_by_id[concept_id]),
            )
        )
        ordered_ids.extend(remaining_ids)

    updated_concepts = []
    for order_index, concept_id in enumerate(ordered_ids):
        concept = concept_by_id[concept_id]
        concept.syllabus_order = order_index
        if getattr(concept, "node_type", "CONCEPT") == "CHAPTER":
            concept.difficulty_stage = "FOUNDATION"
        elif getattr(concept, "node_type", "CONCEPT") == "SUBTOPIC":
            concept.difficulty_stage = "FOUNDATION"
        elif prereq_depth[concept_id] == 0:
            concept.difficulty_stage = "FOUNDATION"
        elif prereq_depth[concept_id] == 1:
            concept.difficulty_stage = "CORE"
        else:
            concept.difficulty_stage = "ADVANCED"

        concept.save(update_fields=["syllabus_order", "difficulty_stage"])
        updated_concepts.append(concept)

    return updated_concepts
