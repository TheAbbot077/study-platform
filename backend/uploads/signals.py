from django.db.models.signals import post_save
from django.dispatch import receiver
from .models import Document
from .services import process_document


@receiver(post_save, sender=Document)
def process_document_on_create(sender, instance, created, **kwargs):
    if created and instance.status == "uploaded":
        process_document(instance)