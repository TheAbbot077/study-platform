from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("uploads", "0002_subject_document_subject"),
    ]

    operations = [
        migrations.AddField(
            model_name="document",
            name="processing_error",
            field=models.TextField(blank=True, default=""),
        ),
    ]
