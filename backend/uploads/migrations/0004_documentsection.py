from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("uploads", "0003_document_processing_error"),
    ]

    operations = [
        migrations.CreateModel(
            name="DocumentSection",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(max_length=255)),
                ("order_index", models.PositiveIntegerField(default=0)),
                ("content", models.TextField(blank=True, default="")),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("queued", "Queued"),
                            ("processing", "Processing"),
                            ("ready", "Ready"),
                            ("failed", "Failed"),
                        ],
                        default="queued",
                        max_length=20,
                    ),
                ),
                ("processing_error", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "document",
                    models.ForeignKey(
                        on_delete=models.deletion.CASCADE,
                        related_name="sections",
                        to="uploads.document",
                    ),
                ),
            ],
            options={
                "ordering": ["order_index", "id"],
            },
        ),
    ]
