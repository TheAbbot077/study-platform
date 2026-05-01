from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from uploads.models import Document, Subject


User = get_user_model()


class AdminOverviewAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.staff_user = User.objects.create_user(
            username="adminuser",
            email="admin@example.com",
            password="password123",
            is_staff=True,
        )
        self.regular_user = User.objects.create_user(
            username="learner",
            email="learner@example.com",
            password="password123",
        )

    def test_admin_overview_requires_staff(self):
        self.client.force_authenticate(user=self.regular_user)
        response = self.client.get("/api/accounts/admin/overview/")
        self.assertEqual(response.status_code, 403)

    def test_admin_overview_returns_usage_snapshot_for_staff(self):
        self.client.force_authenticate(user=self.staff_user)
        response = self.client.get("/api/accounts/admin/overview/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("overview", response.data)
        self.assertIn("documents", response.data)
        self.assertIn("billing", response.data)


class AdminRetryDocumentAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.staff_user = User.objects.create_user(
            username="adminuser",
            email="admin@example.com",
            password="password123",
            is_staff=True,
        )
        self.regular_user = User.objects.create_user(
            username="learner",
            email="learner@example.com",
            password="password123",
        )
        self.subject = Subject.objects.create(user=self.regular_user, name="Biology")
        self.document = Document.objects.create(
            user=self.regular_user,
            subject=self.subject,
            title="Cells",
            status="failed",
            processing_error="Timed out",
            file=SimpleUploadedFile("cells.txt", b"cell notes"),
        )

    def test_retry_requires_staff(self):
        self.client.force_authenticate(user=self.regular_user)
        response = self.client.post(
            f"/api/accounts/admin/documents/{self.document.id}/retry/"
        )
        self.assertEqual(response.status_code, 403)

    @patch("accounts.views.process_document_task.delay")
    def test_staff_can_retry_failed_document(self, mocked_delay):
        self.client.force_authenticate(user=self.staff_user)
        response = self.client.post(
            f"/api/accounts/admin/documents/{self.document.id}/retry/"
        )
        self.assertEqual(response.status_code, 200)

        self.document.refresh_from_db()
        self.assertEqual(self.document.status, "uploaded")
        self.assertEqual(self.document.processing_error, "")
        mocked_delay.assert_called_once_with(self.document.id)
