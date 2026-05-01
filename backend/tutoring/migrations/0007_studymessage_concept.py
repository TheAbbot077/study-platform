from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("knowledge", "0002_initial"),
        ("tutoring", "0006_alter_conceptcheck_status"),
    ]

    operations = [
        migrations.AddField(
            model_name="studymessage",
            name="concept",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="study_messages",
                to="knowledge.concept",
            ),
        ),
    ]
