from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status

from uploads.models import Subject
from .services import answer_question


class TutorAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        query = request.data.get("query")
        concept_name = request.data.get("concept_name")
        subject_id = request.data.get("subject_id")

        if not query:
            return Response({"error": "Query is required"}, status=400)

        subject = None
        if subject_id:
            try:
                subject = Subject.objects.get(id=subject_id)
            except Subject.DoesNotExist:
                return Response(
                    {"error": "Selected subject was not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

        result = answer_question(
            user=request.user,
            query=query,
            concept_name=concept_name,
            subject=subject,
        )

        if result is None:
            return Response(
                {"error": "Tutor returned no result."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(result, status=status.HTTP_200_OK)