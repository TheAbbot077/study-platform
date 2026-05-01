from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from learning.models import LearnerConceptMastery
from learning.services import get_blocked_by

from .models import Concept


class SubjectConceptListAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        subject_id = request.query_params.get("subject")

        if not subject_id:
            return Response(
                {"error": "Subject is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        concepts = list(
            Concept.objects.filter(
                subject_id=subject_id,
                subject__user=request.user,
            )
            .select_related("subject", "parent")
            .prefetch_related("prerequisites", "children")
            .order_by("syllabus_order", "name")
        )

        mastery_by_concept_id = {
            item.concept_id: item
            for item in LearnerConceptMastery.objects.filter(
                user=request.user,
                concept__in=concepts,
            )
        }

        data = []
        for index, concept in enumerate(concepts):
            mastery = mastery_by_concept_id.get(concept.id)
            mastery_score = (
                round(float(mastery.mastery_score), 2)
                if mastery is not None
                else None
            )
            practice_count = mastery.practice_count if mastery is not None else 0
            blocked_by = get_blocked_by(request.user, concept)
            prerequisite_names = [
                prereq.name
                for prereq in concept.prerequisites.all()
                if prereq.subject_id == concept.subject_id
            ]

            data.append(
                {
                    "id": concept.id,
                    "name": concept.name,
                    "description": concept.description,
                    "node_type": concept.node_type,
                    "parent_id": concept.parent_id,
                    "child_ids": [child.id for child in concept.children.all()],
                    "subject_id": concept.subject_id,
                    "order_index": concept.syllabus_order,
                    "difficulty_stage": concept.difficulty_stage,
                    "mastery_score": mastery_score,
                    "practice_count": practice_count,
                    "is_started": practice_count > 0,
                    "prerequisites": prerequisite_names,
                    "blocked_by": [item["concept"].name for item in blocked_by],
                    "is_locked": len(blocked_by) > 0,
                }
            )

        return Response(data, status=status.HTTP_200_OK)
