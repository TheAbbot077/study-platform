from celery import shared_task

from .models import Document, DocumentSection
from .services import process_document, process_document_section


@shared_task
def process_document_task(document_id):
    try:
        document = Document.objects.get(id=document_id)
    except Document.DoesNotExist:
        return

    process_document(document)


@shared_task
def process_document_section_task(section_id):
    try:
        section = DocumentSection.objects.get(id=section_id)
    except DocumentSection.DoesNotExist:
        return

    process_document_section(section, rebuild_syllabus=True)
