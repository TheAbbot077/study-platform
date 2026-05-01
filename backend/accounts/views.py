from django.contrib.auth import authenticate, login, logout, get_user_model
from django.db.models import Avg, Count
from django.middleware.csrf import get_token
from django.views.decorators.csrf import ensure_csrf_cookie
from django.utils.decorators import method_decorator
from django.utils import timezone

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework import status

from learning.models import LearnerConceptEvent, LearnerConceptMastery
from knowledge.models import Concept
from tutoring.models import ConceptCheck, ConceptCheckAttempt, StudyMessage, StudySession
from uploads.models import Document, DocumentSection, Subject
from uploads.tasks import process_document_task


User = get_user_model()


def _to_iso(value):
    return value.isoformat() if value else None


def _build_user_activity_rows(limit=8):
    users = list(
        User.objects.annotate(
            subject_count=Count("subjects", distinct=True),
            document_count=Count("documents", distinct=True),
            session_count=Count("studysession", distinct=True),
            event_count=Count("learnerconceptevent", distinct=True),
        )
        .order_by("-date_joined")[: max(limit * 3, 12)]
    )

    rows = []
    for user in users:
        document_time = (
            Document.objects.filter(user=user).order_by("-created_at").values_list("created_at", flat=True).first()
        )
        event_time = (
            LearnerConceptEvent.objects.filter(user=user)
            .order_by("-created_at")
            .values_list("created_at", flat=True)
            .first()
        )
        message_time = (
            StudyMessage.objects.filter(session__user=user)
            .order_by("-created_at")
            .values_list("created_at", flat=True)
            .first()
        )
        last_activity = max(
            [item for item in [document_time, event_time, message_time, user.last_login] if item],
            default=user.date_joined,
        )

        rows.append(
            {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "is_staff": user.is_staff,
                "is_superuser": user.is_superuser,
                "subject_count": user.subject_count,
                "document_count": user.document_count,
                "session_count": user.session_count,
                "event_count": user.event_count,
                "date_joined": _to_iso(user.date_joined),
                "last_login": _to_iso(user.last_login),
                "last_activity": _to_iso(last_activity),
            }
        )

    rows.sort(key=lambda item: item["last_activity"] or "", reverse=True)
    return rows[:limit]


def build_admin_overview():
    now = timezone.now()
    last_day = now - timezone.timedelta(hours=24)
    last_week = now - timezone.timedelta(days=7)

    total_users = User.objects.count()
    total_subjects = Subject.objects.count()
    total_documents = Document.objects.count()
    total_concepts = Concept.objects.count()

    users_last_day = User.objects.filter(last_login__gte=last_day).count()
    users_last_week = User.objects.filter(last_login__gte=last_week).count()

    document_status_counts = {
        item["status"]: item["count"]
        for item in Document.objects.values("status").annotate(count=Count("id"))
    }
    section_status_counts = {
        item["status"]: item["count"]
        for item in DocumentSection.objects.values("status").annotate(count=Count("id"))
    }
    concept_type_counts = {
        item["node_type"]: item["count"]
        for item in Concept.objects.values("node_type").annotate(count=Count("id"))
    }
    check_status_counts = {
        item["status"]: item["count"]
        for item in ConceptCheck.objects.values("status").annotate(count=Count("id"))
    }
    attempt_result_counts = {
        item["result"] or "ungraded": item["count"]
        for item in ConceptCheckAttempt.objects.values("result").annotate(count=Count("id"))
    }

    mastery_aggregate = LearnerConceptMastery.objects.aggregate(
        average_mastery=Avg("mastery_score"),
        average_practice=Avg("practice_count"),
    )

    recent_documents = list(
        Document.objects.select_related("user", "subject")
        .order_by("-created_at")[:10]
    )
    failed_documents = list(
        Document.objects.filter(status="failed")
        .select_related("user", "subject")
        .order_by("-created_at")[:8]
    )
    recent_users = list(User.objects.order_by("-date_joined")[:8])

    top_subjects = list(
        Subject.objects.select_related("user")
        .annotate(
            document_count=Count("documents", distinct=True),
            concept_count=Count("concepts", distinct=True),
        )
        .order_by("-document_count", "-concept_count", "name")[:8]
    )

    return {
        "generated_at": _to_iso(now),
        "overview": {
            "users": total_users,
            "subjects": total_subjects,
            "documents": total_documents,
            "concept_nodes": total_concepts,
            "study_sessions": StudySession.objects.count(),
            "study_messages": StudyMessage.objects.count(),
            "concept_checks": ConceptCheck.objects.count(),
            "concept_check_attempts": ConceptCheckAttempt.objects.count(),
            "learning_events": LearnerConceptEvent.objects.count(),
            "mastery_records": LearnerConceptMastery.objects.count(),
        },
        "activity_windows": {
            "users_last_24h": users_last_day,
            "users_last_7d": users_last_week,
            "documents_last_24h": Document.objects.filter(created_at__gte=last_day).count(),
            "documents_last_7d": Document.objects.filter(created_at__gte=last_week).count(),
            "sessions_last_24h": StudySession.objects.filter(created_at__gte=last_day).count(),
            "sessions_last_7d": StudySession.objects.filter(created_at__gte=last_week).count(),
            "events_last_24h": LearnerConceptEvent.objects.filter(created_at__gte=last_day).count(),
            "events_last_7d": LearnerConceptEvent.objects.filter(created_at__gte=last_week).count(),
        },
        "documents": {
            "status_counts": {
                "uploaded": document_status_counts.get("uploaded", 0),
                "processing": document_status_counts.get("processing", 0),
                "ready": document_status_counts.get("ready", 0),
                "failed": document_status_counts.get("failed", 0),
            },
            "section_status_counts": {
                "queued": section_status_counts.get("queued", 0),
                "processing": section_status_counts.get("processing", 0),
                "ready": section_status_counts.get("ready", 0),
                "failed": section_status_counts.get("failed", 0),
            },
            "recent": [
                {
                    "id": document.id,
                    "title": document.title,
                    "status": document.status,
                    "processing_error": document.processing_error,
                    "subject_name": document.subject.name if document.subject else None,
                    "username": document.user.username,
                    "created_at": _to_iso(document.created_at),
                }
                for document in recent_documents
            ],
            "failed_recent": [
                {
                    "id": document.id,
                    "title": document.title,
                    "status": document.status,
                    "processing_error": document.processing_error,
                    "subject_name": document.subject.name if document.subject else None,
                    "username": document.user.username,
                    "created_at": _to_iso(document.created_at),
                }
                for document in failed_documents
            ],
        },
        "concepts": {
            "node_type_counts": {
                "chapters": concept_type_counts.get("CHAPTER", 0),
                "concepts": concept_type_counts.get("CONCEPT", 0),
                "subtopics": concept_type_counts.get("SUBTOPIC", 0),
            },
        },
        "mastery": {
            "average_mastery": round(float(mastery_aggregate["average_mastery"] or 0.0), 3),
            "average_practice_count": round(float(mastery_aggregate["average_practice"] or 0.0), 2),
            "mastered_count": LearnerConceptMastery.objects.filter(mastery_score__gte=0.8).count(),
            "in_progress_count": LearnerConceptMastery.objects.filter(
                mastery_score__gte=0.4, mastery_score__lt=0.8
            ).count(),
            "struggling_count": LearnerConceptMastery.objects.filter(mastery_score__lt=0.4).count(),
        },
        "tutoring": {
            "session_type_counts": {
                item["session_type"]: item["count"]
                for item in StudySession.objects.values("session_type").annotate(count=Count("id"))
            },
            "check_status_counts": {
                "pending": check_status_counts.get("pending", 0),
                "answered": check_status_counts.get("answered", 0),
                "evaluated": check_status_counts.get("evaluated", 0),
                "cancelled": check_status_counts.get("cancelled", 0),
            },
            "attempt_result_counts": {
                "correct": attempt_result_counts.get("correct", 0),
                "partial": attempt_result_counts.get("partial", 0),
                "incorrect": attempt_result_counts.get("incorrect", 0),
                "ungraded": attempt_result_counts.get("ungraded", 0),
            },
        },
        "recent_users": [
            {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "is_staff": user.is_staff,
                "is_superuser": user.is_superuser,
                "date_joined": _to_iso(user.date_joined),
                "last_login": _to_iso(user.last_login),
            }
            for user in recent_users
        ],
        "active_users": _build_user_activity_rows(limit=8),
        "top_subjects": [
            {
                "id": subject.id,
                "name": subject.name,
                "username": subject.user.username,
                "document_count": subject.document_count,
                "concept_count": subject.concept_count,
                "created_at": _to_iso(subject.created_at),
            }
            for subject in top_subjects
        ],
        "billing": {
            "status": "not_enabled",
            "note": "Billing instrumentation has not been added yet. This admin console is ready for usage tracking now and billing metrics later.",
        },
    }


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CSRFAPIView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response(
            {
                "detail": "CSRF cookie set.",
                "csrfToken": get_token(request),
            },
            status=status.HTTP_200_OK,
        )


class SignupAPIView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        username = (request.data.get("username") or "").strip()
        email = (request.data.get("email") or "").strip()
        password = request.data.get("password") or ""
        confirm_password = request.data.get("confirm_password") or ""

        if not username:
            return Response(
                {"error": "Username is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not email:
            return Response(
                {"error": "Email is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not password:
            return Response(
                {"error": "Password is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if password != confirm_password:
            return Response(
                {"error": "Passwords do not match."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if User.objects.filter(username__iexact=username).exists():
            return Response(
                {"error": "That username is already taken."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if User.objects.filter(email__iexact=email).exists():
            return Response(
                {"error": "That email is already registered."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = User.objects.create_user(
            username=username,
            email=email,
            password=password,
        )

        login(request, user)

        return Response(
            {
                "message": "Account created successfully.",
                "user": {
                    "id": user.id,
                    "username": user.username,
                    "email": user.email,
                },
            },
            status=status.HTTP_201_CREATED,
        )


class LoginAPIView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        username = (request.data.get("username") or "").strip()
        password = request.data.get("password") or ""

        if not username or not password:
            return Response(
                {"error": "Username and password are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = authenticate(request, username=username, password=password)

        if user is None:
            return Response(
                {"error": "Invalid username or password."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        login(request, user)

        return Response(
            {
                "message": "Logged in successfully.",
                "user": {
                    "id": user.id,
                    "username": user.username,
                    "email": user.email,
                },
            },
            status=status.HTTP_200_OK,
        )


class LogoutAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        logout(request)
        return Response(
            {"message": "Logged out successfully."},
            status=status.HTTP_200_OK,
        )


class MeAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        return Response(
            {
                "user": {
                    "id": user.id,
                    "username": user.username,
                    "email": user.email,
                    "is_staff": user.is_staff,
                    "is_superuser": user.is_superuser,
                }
            },
            status=status.HTTP_200_OK,
        )


class AdminOverviewAPIView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        return Response(build_admin_overview(), status=status.HTTP_200_OK)


class AdminRetryDocumentAPIView(APIView):
    permission_classes = [IsAdminUser]

    def post(self, request, document_id):
        try:
            document = Document.objects.select_related("subject", "user").get(id=document_id)
        except Document.DoesNotExist:
            return Response(
                {"error": "Document not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        document.status = "uploaded"
        document.processing_error = ""
        document.save(update_fields=["status", "processing_error"])

        process_document_task.delay(document.id)

        return Response(
            {
                "message": "Document requeued for processing.",
                "document": {
                    "id": document.id,
                    "title": document.title,
                    "status": document.status,
                    "subject_name": document.subject.name if document.subject else None,
                    "username": document.user.username,
                },
            },
            status=status.HTTP_200_OK,
        )
