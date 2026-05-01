from django.urls import path
from .views import ProgressSummaryAPIView, ReinforcementPlanAPIView

urlpatterns = [
    path("progress/", ProgressSummaryAPIView.as_view(), name="learning-progress"),
    path("reinforcement/", ReinforcementPlanAPIView.as_view(), name="learning-reinforcement"),
]