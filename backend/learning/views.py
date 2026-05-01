from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .services import (
    get_progress_summary,
    get_reinforcement_plan,
    get_next_reinforcement_target,
)


class ProgressSummaryAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        summary = get_progress_summary(request.user)
        return Response(summary)


class ReinforcementPlanAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        limit = request.query_params.get("limit", 5)

        try:
            limit = int(limit)
        except (TypeError, ValueError):
            limit = 5

        if limit < 1:
            limit = 1
        if limit > 10:
            limit = 10

        plan = get_reinforcement_plan(request.user, limit=limit)
        next_target = get_next_reinforcement_target(request.user)

        safe_items = []
        for item in plan["items"]:
            safe_item = {k: v for k, v in item.items() if k != "concept"}
            safe_items.append(safe_item)

        safe_next_target = None
        if next_target:
            safe_next_target = {k: v for k, v in next_target.items() if k != "concept"}

        return Response(
            {
                "next_target": safe_next_target,
                "plan": {
                    "count": len(safe_items),
                    "items": safe_items,
                },
            }
        )