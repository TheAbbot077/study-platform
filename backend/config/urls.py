from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import path, include
from .views import healthcheck

urlpatterns = [
    path("health/", healthcheck, name="healthcheck"),
    path("admin/", admin.site.urls),
    path("api/uploads/", include("uploads.urls")),
    path("api/knowledge/", include("knowledge.urls")),
    path("", include("uploads.urls")),
    path("api/tutor/", include("tutoring.urls")),
    path("api/learning/", include("learning.urls")),
    path("api/accounts/", include("accounts.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
