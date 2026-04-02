from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from .services import answer_question


class TutorAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        query = request.data.get("query")

        if not query:
            return Response({"error": "Query is required"}, status=400)

        answer = answer_question(request.user, query)

        return Response({
            "query": query,
            "answer": answer
        })