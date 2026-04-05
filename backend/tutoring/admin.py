from django.contrib import admin

from .models import (
    StudySession,
    StudyMessage,
    ConceptCheck,
    ConceptCheckAttempt,
)

admin.site.register(StudySession)
admin.site.register(StudyMessage)
admin.site.register(ConceptCheck)
admin.site.register(ConceptCheckAttempt)