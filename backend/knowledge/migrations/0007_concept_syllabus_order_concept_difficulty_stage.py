from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("knowledge", "0006_alter_documentchunk_options_concept_description_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="concept",
            name="difficulty_stage",
            field=models.CharField(
                choices=[
                    ("FOUNDATION", "Foundation"),
                    ("CORE", "Core"),
                    ("ADVANCED", "Advanced"),
                ],
                default="FOUNDATION",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="concept",
            name="syllabus_order",
            field=models.PositiveIntegerField(default=0),
        ),
    ]
