from django.contrib import admin
from .models import Concept, ConceptRelation, DocumentChunk

admin.site.register(Concept)
admin.site.register(ConceptRelation)
admin.site.register(DocumentChunk)