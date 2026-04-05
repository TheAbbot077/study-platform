from django.contrib import admin
from .models import LearnerConceptMastery


@admin.register(LearnerConceptMastery)
class LearnerConceptMasteryAdmin(admin.ModelAdmin):
    list_display = (
        "user",
        "concept",
        "mastery_score",
        "practice_count",
        "stability",
        "difficulty",
        "hint_level",
        "last_practiced",
    )
    search_fields = ("user__username", "concept__name")
    list_filter = ("concept",)