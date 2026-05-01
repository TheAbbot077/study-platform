from celery import shared_task

from accounts.models import User

from .services import get_reinforcement_plan


@shared_task
def scan_reinforcement_queue():
    summary = {
        "users_scanned": 0,
        "due_now": 0,
        "due_soon": 0,
        "scheduled": 0,
    }

    for user in User.objects.all().iterator():
        plan = get_reinforcement_plan(user, limit=50)
        if not plan["items"]:
            continue

        summary["users_scanned"] += 1
        for item in plan["items"]:
            status = item.get("due_status")
            if status in summary:
                summary[status] += 1

    return summary
