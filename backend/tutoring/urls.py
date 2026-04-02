from django.urls import path
from .views import TutorAPIView

urlpatterns = [
    path("ask/", TutorAPIView.as_view(), name="tutor-ask"),
]