from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("knowledge", "0008_concept_node_type_concept_parent"),
    ]

    operations = [
        migrations.AlterField(
            model_name="concept",
            name="node_type",
            field=models.CharField(
                choices=[
                    ("CHAPTER", "Chapter"),
                    ("CONCEPT", "Concept"),
                    ("SUBTOPIC", "Subtopic"),
                ],
                db_default="CONCEPT",
                default="CONCEPT",
                max_length=20,
            ),
        ),
    ]
