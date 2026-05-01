from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("learning", "0002_learnerconceptmastery_hint_level"),
    ]

    operations = [
        migrations.CreateModel(
            name="LearnerConceptEvent",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "event_type",
                    models.CharField(
                        choices=[
                            ("teach", "Teach"),
                            ("concept_check", "Concept Check"),
                            ("reinforcement", "Reinforcement"),
                            ("remediation", "Remediation"),
                            ("manual", "Manual"),
                        ],
                        max_length=30,
                    ),
                ),
                ("score_before", models.FloatField(default=0.0)),
                ("score_after", models.FloatField(default=0.0)),
                ("score_delta", models.FloatField(default=0.0)),
                ("practice_count_after", models.IntegerField(default=0)),
                ("source_session_type", models.CharField(blank=True, default="", max_length=20)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "concept",
                    models.ForeignKey(on_delete=models.deletion.CASCADE, to="knowledge.concept"),
                ),
                (
                    "user",
                    models.ForeignKey(on_delete=models.deletion.CASCADE, to="accounts.user"),
                ),
            ],
            options={
                "ordering": ["-created_at", "-id"],
            },
        ),
    ]
