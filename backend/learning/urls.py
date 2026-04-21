from django.urls import path
from .views import LearningProgressAPIView

urlpatterns = [
    path("progress/", LearningProgressAPIView.as_view(), name="learning-progress"),
]