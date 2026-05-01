from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("tutoring", "0008_studymessage_is_checkpoint"),
    ]

    operations = [
        migrations.AddField(
            model_name="conceptcheck",
            name="answer_key",
            field=models.CharField(blank=True, default="", max_length=20),
        ),
    ]
