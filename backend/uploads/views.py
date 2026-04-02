from django.shortcuts import render, redirect
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated

from .models import Document
from .serializers import DocumentSerializer
from .services import process_document


class DocumentUploadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = DocumentSerializer(data=request.data)

        if serializer.is_valid():
            document = serializer.save(user=request.user)

            # Process immediately for now
            process_document(document)

            return Response(DocumentSerializer(document).data, status=status.HTTP_201_CREATED)

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


def upload_document_page(request):
    if not request.user.is_authenticated:
        return redirect("/admin/login/?next=/upload-test/")

    if request.method == "POST":
        title = request.POST.get("title")
        file = request.FILES.get("file")

        if title and file:
            document = Document.objects.create(
                user=request.user,
                title=title,
                file=file,
                status="uploaded",
            )

            # Process immediately for now
            process_document(document)

            return render(request, "uploads/upload_success.html", {"title": title})

    return render(request, "uploads/upload_form.html")