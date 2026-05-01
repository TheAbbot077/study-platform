from django.urls import path

from .views import (
    AdminOverviewAPIView,
    AdminRetryDocumentAPIView,
    CSRFAPIView,
    SignupAPIView,
    LoginAPIView,
    LogoutAPIView,
    MeAPIView,
)

urlpatterns = [
    path("csrf/", CSRFAPIView.as_view(), name="accounts-csrf"),
    path("signup/", SignupAPIView.as_view(), name="accounts-signup"),
    path("login/", LoginAPIView.as_view(), name="accounts-login"),
    path("logout/", LogoutAPIView.as_view(), name="accounts-logout"),
    path("me/", MeAPIView.as_view(), name="accounts-me"),
    path("admin/overview/", AdminOverviewAPIView.as_view(), name="accounts-admin-overview"),
    path(
        "admin/documents/<int:document_id>/retry/",
        AdminRetryDocumentAPIView.as_view(),
        name="accounts-admin-retry-document",
    ),
]
