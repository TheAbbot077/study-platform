from django.shortcuts import render, redirect
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated

from .models import Document, Subject
from .serializers import DocumentSerializer, SubjectSerializer
from .tasks import process_document_task


class SubjectListCreateAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        subjects = Subject.objects.filter(user=request.user).order_by("name")
        serializer = SubjectSerializer(subjects, many=True)
        return Response(serializer.data)

    def post(self, request):
        name = (request.data.get("name") or "").strip()

        if not name:
            return Response(
                {"error": "Subject name is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if Subject.objects.filter(user=request.user, name__iexact=name).exists():
            return Response(
                {"error": "You already have a subject with that name."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        subject = Subject.objects.create(
            user=request.user,
            name=name,
        )

        return Response(
            SubjectSerializer(subject).data,
            status=status.HTTP_201_CREATED,
        )


class DocumentListAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        documents = (
            Document.objects.filter(user=request.user)
            .select_related("subject")
            .order_by("-created_at")
        )

        subject_id = request.query_params.get("subject")
        if subject_id:
            documents = documents.filter(subject_id=subject_id)

        data = []
        for document in documents:
            data.append({
                "id": document.id,
                "title": document.title,
                "file": document.file.url if document.file else "",
                "status": document.status,
                "created_at": document.created_at,
                "subject": (
                    {
                        "id": document.subject.id,
                        "name": document.subject.name,
                    }
                    if document.subject
                    else None
                ),
            })

        return Response(data, status=status.HTTP_200_OK)


class DocumentUploadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = DocumentSerializer(data=request.data)

        if serializer.is_valid():
            subject = serializer.validated_data.get("subject")

            if subject and subject.user != request.user:
                return Response(
                    {"error": "You cannot upload into another user's subject."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            document = serializer.save(
                user=request.user,
                status="uploaded",
            )

            process_document_task.delay(document.id)

            return Response(
                DocumentSerializer(document).data,
                status=status.HTTP_201_CREATED,
            )

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


def upload_document_page(request):
    if not request.user.is_authenticated:
        return redirect("/admin/login/?next=/upload-test/")

    if request.method == "POST":
        title = request.POST.get("title")
        file = request.FILES.get("file")
        subject_id = request.POST.get("subject")

        subject = None
        if subject_id:
            subject = Subject.objects.filter(
                id=subject_id,
                user=request.user,
            ).first()

        if title and file:
            document = Document.objects.create(
                user=request.user,
                subject=subject,
                title=title,
                file=file,
                status="uploaded",
            )

            process_document_task.delay(document.id)

            return render(request, "uploads/upload_success.html", {"title": title})

    subjects = Subject.objects.filter(user=request.user).order_by("name")
    return render(request, "uploads/upload_form.html", {"subjects": subjects})