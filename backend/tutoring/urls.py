from django.urls import path
from .views import (
    TutorAPIView,
    TutorHistoryAPIView,
    TutorCheckpointAPIView,
    TutorResetAPIView,
    TutorRestartAPIView,
)

urlpatterns = [
    path("ask/", TutorAPIView.as_view(), name="tutor-ask"),
    path("history/", TutorHistoryAPIView.as_view(), name="tutor-history"),
    path("checkpoint/", TutorCheckpointAPIView.as_view(), name="tutor-checkpoint"),
    path("reset/", TutorResetAPIView.as_view(), name="tutor-reset"),
    path("restart/", TutorRestartAPIView.as_view(), name="tutor-restart"),
]
