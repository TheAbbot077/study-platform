from django.urls import path
from .views import DocumentUploadView, upload_document_page

urlpatterns = [
    path("upload/", DocumentUploadView.as_view(), name="document-upload-api"),
    path("upload-test/", upload_document_page, name="document-upload-test"),
]