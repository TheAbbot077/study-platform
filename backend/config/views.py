from django.db import connections
from django.db.utils import OperationalError
from django.http import JsonResponse


def healthcheck(request):
    database_ok = True

    try:
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except OperationalError:
        database_ok = False

    status_code = 200 if database_ok else 503
    return JsonResponse(
        {
            "status": "ok" if database_ok else "degraded",
            "database": "ok" if database_ok else "unavailable",
        },
        status=status_code,
    )
