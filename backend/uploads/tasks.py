from celery import shared_task

from .models import Document
from .services import process_document


@shared_task
def process_document_task(document_id):
    try:
        document = Document.objects.get(id=document_id)
    except Document.DoesNotExist:
        return

    process_document(document)