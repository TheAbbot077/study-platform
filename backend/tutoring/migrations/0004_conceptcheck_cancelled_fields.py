from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tutoring", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="conceptcheck",
            name="cancel_reason",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="conceptcheck",
            name="cancelled_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="conceptcheck",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("answered", "Answered"),
                    ("evaluated", "Evaluated"),
                    ("cancelled", "Cancelled"),
                ],
                default="pending",
                max_length=20,
            ),
        ),
    ]