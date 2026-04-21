from rest_framework import serializers
from .models import Document, Subject


class SubjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Subject
        fields = ["id", "name", "created_at"]


class DocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Document
        fields = ["id", "title", "file", "status", "created_at", "subject"]
        read_only_fields = ["id", "status", "created_at"]