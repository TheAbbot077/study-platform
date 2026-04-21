from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from uploads.models import Subject, Document
from learning.models import LearnerConceptMastery
from .services import (
    get_progress_summary,
    get_personalized_recommendations,
)


class LearningProgressAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user

        summary = get_progress_summary(user)

        user_subjects = Subject.objects.filter(user=user).prefetch_related("documents")

        mastery_records = (
            LearnerConceptMastery.objects.filter(user=user)
            .select_related("concept")
            .order_by("concept__name")
        )

        studied_concepts = []
        for record in mastery_records:
            studied_concepts.append({
                "id": record.concept.id,
                "name": record.concept.name,
                "mastery_score": record.mastery_score,
                "practice_count": record.practice_count,
                "last_practiced": record.last_practiced,
            })

        subjects = []
        for subject in user_subjects:
            subject_documents = subject.documents.all()

            mastery_scores = [
                record.mastery_score
                for record in mastery_records
                if record.mastery_score is not None
            ]

            average_mastery = (
                sum(mastery_scores) / len(mastery_scores)
                if mastery_scores
                else None
            )

            subjects.append({
                "id": subject.id,
                "name": subject.name,
                "document_count": subject_documents.count(),
                "average_mastery": average_mastery,
                "documents": [
                    {
                        "id": doc.id,
                        "title": doc.title,
                        "status": doc.status,
                        "created_at": doc.created_at,
                    }
                    for doc in subject_documents
                ],
            })

        recommended_concepts = []
        for item in get_personalized_recommendations(user, limit=5):
            recommended_concepts.append({
                "id": item["concept"].id,
                "name": item["concept"].name,
                "mastery_score": item["score"],
                "mastery_label": item["mastery_label"],
                "action": item["action"],
                "reason": item["reason"],
                "practice_count": item["practice_count"],
                "is_unlocked": item["is_unlocked"],
                "blocked_by": [
                    {
                        "id": blocker["concept"].id,
                        "name": blocker["concept"].name,
                        "score": blocker["score"],
                        "mastery_label": blocker["mastery_label"],
                    }
                    for blocker in item["blocked_by"]
                ],
            })

        top_recommendation = recommended_concepts[0] if recommended_concepts else None

        message = None
        if top_recommendation:
            message = (
                f"Best next step: {top_recommendation['name']} "
                f"({top_recommendation['action']})"
            )

        overall = {
            "total_subjects": Subject.objects.filter(user=user).count(),
            "total_documents": Document.objects.filter(user=user).count(),
            "total_concepts_studied": mastery_records.count(),
        }

        return Response({
            "summary": summary,
            "overall": overall,
            "subjects": subjects,
            "studied_concepts": studied_concepts,
            "recommended_concepts": recommended_concepts,
            "top_recommendation": top_recommendation,
            "message": message,
        })