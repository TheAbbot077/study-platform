from django.urls import path

from .views import SubjectConceptListAPIView


urlpatterns = [
    path("concepts/", SubjectConceptListAPIView.as_view(), name="knowledge-concepts"),
]
