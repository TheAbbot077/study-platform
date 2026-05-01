from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("tutoring", "0007_studymessage_concept"),
    ]

    operations = [
        migrations.AddField(
            model_name="studymessage",
            name="is_checkpoint",
            field=models.BooleanField(default=False),
        ),
    ]
