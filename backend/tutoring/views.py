from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status
from django.shortcuts import get_object_or_404
from django.db.models import Q

from knowledge.models import Concept
from .models import StudyMessage
from uploads.models import Subject
from .services import answer_tutor_request, set_checkpoint, reset_to_checkpoint


def get_owned_subject(user, subject_id):
    if not subject_id:
        return None

    try:
        return Subject.objects.get(
            id=subject_id,
            user=user,
        )
    except Subject.DoesNotExist:
        return False


def get_subject_concept(user, concept_name, subject_id=None):
    if not concept_name:
        return None, None

    subject = get_owned_subject(user, subject_id)
    if subject is False:
        return False, None

    queryset = Concept.objects.filter(name=concept_name)
    if subject is not None:
        queryset = queryset.filter(subject=subject)
    else:
        queryset = queryset.filter(
            Q(subject__user=user) | Q(subject__isnull=True)
        )

    return subject, queryset.first()


class TutorAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        query = request.data.get("query", "")
        concept_name = request.data.get("concept_name")
        subject_id = request.data.get("subject_id")

        if (not str(query).strip()) and not concept_name:
            return Response(
                {"error": "Query or concept is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        subject = get_owned_subject(request.user, subject_id)
        if subject is False:
            return Response(
                {"error": "Selected subject was not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        result = answer_tutor_request(
            user=request.user,
            query=query or "",
            concept_name=concept_name,
            subject=subject,
        )

        if result is None:
            return Response(
                {"error": "Tutor returned no result."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(result, status=status.HTTP_200_OK)


class TutorHistoryAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        concept_name = request.query_params.get("concept_name")
        subject_id = request.query_params.get("subject_id")

        if not concept_name:
            return Response(
                {"error": "Concept name is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        subject, concept = get_subject_concept(
            request.user,
            concept_name,
            subject_id,
        )
        if subject is False:
            return Response(
                {"error": "Selected subject was not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if concept is None:
            return Response(
                {
                    "concept_name": concept_name,
                    "subject_id": subject.id if subject else None,
                    "messages": [],
                },
                status=status.HTTP_200_OK,
            )

        messages = (
            concept.study_messages.filter(session__user=request.user)
            .select_related("session")
            .order_by("created_at")
        )

        return Response(
            {
                "concept_name": concept.name,
                "subject_id": concept.subject_id,
                "messages": [
                    {
                        "id": message.id,
                        "role": message.role,
                        "content": message.content,
                        "is_checkpoint": message.is_checkpoint,
                        "created_at": message.created_at.isoformat(),
                    }
                    for message in messages
                ],
            },
            status=status.HTTP_200_OK,
        )


class TutorCheckpointAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        message_id = request.data.get("message_id")
        if not message_id:
            return Response(
                {"error": "Message id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        message = get_object_or_404(
            StudyMessage.objects.select_related("session", "concept"),
            id=message_id,
        )

        try:
            checkpoint = set_checkpoint(request.user, message)
        except ValueError as exc:
            return Response(
                {"error": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                "message_id": checkpoint.id,
                "concept_name": checkpoint.concept.name if checkpoint.concept else None,
                "subject_id": checkpoint.concept.subject_id if checkpoint.concept else None,
                "is_checkpoint": checkpoint.is_checkpoint,
            },
            status=status.HTTP_200_OK,
        )


class TutorResetAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        message_id = request.data.get("message_id")
        if not message_id:
            return Response(
                {"error": "Checkpoint message id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        message = get_object_or_404(
            StudyMessage.objects.select_related("session", "concept"),
            id=message_id,
        )

        try:
            checkpoint = reset_to_checkpoint(request.user, message)
        except ValueError as exc:
            return Response(
                {"error": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        messages = (
            checkpoint.concept.study_messages.filter(session__user=request.user)
            .select_related("session")
            .order_by("created_at")
        )

        return Response(
            {
                "message_id": checkpoint.id,
                "concept_name": checkpoint.concept.name,
                "subject_id": checkpoint.concept.subject_id,
                "messages": [
                    {
                        "id": history_message.id,
                        "role": history_message.role,
                        "content": history_message.content,
                        "is_checkpoint": history_message.is_checkpoint,
                        "created_at": history_message.created_at.isoformat(),
                    }
                    for history_message in messages
                ],
            },
            status=status.HTTP_200_OK,
        )
