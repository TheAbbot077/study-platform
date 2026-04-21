from django.urls import path
from .views import (
    DocumentUploadView,
    DocumentListAPIView,
    SubjectListCreateAPIView,
    upload_document_page,
)

urlpatterns = [
    path("upload/", DocumentUploadView.as_view(), name="document-upload-api"),
    path("documents/", DocumentListAPIView.as_view(), name="document-list-api"),
    path("subjects/", SubjectListCreateAPIView.as_view(), name="subject-list-create-api"),
    path("upload-test/", upload_document_page, name="document-upload-test"),
]