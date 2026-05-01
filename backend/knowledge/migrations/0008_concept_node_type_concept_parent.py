from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("knowledge", "0007_concept_syllabus_order_concept_difficulty_stage"),
    ]

    operations = [
        migrations.AddField(
            model_name="concept",
            name="node_type",
            field=models.CharField(
                choices=[
                    ("CHAPTER", "Chapter"),
                    ("CONCEPT", "Concept"),
                    ("SUBTOPIC", "Subtopic"),
                ],
                default="CONCEPT",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="concept",
            name="parent",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.deletion.CASCADE,
                related_name="children",
                to="knowledge.concept",
            ),
        ),
    ]
