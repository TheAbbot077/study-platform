from openai import OpenAI
import os

from knowledge.services import semantic_search
from knowledge.models import Concept
from learning.models import LearnerConceptMastery
from .models import StudySession, StudyMessage

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def get_or_create_session(user):
    session, _ = StudySession.objects.get_or_create(user=user)
    return session


def get_recent_history(session, limit=6):
    messages = session.messages.order_by("-created_at")[:limit]
    return list(reversed(messages))


def build_messages(query, context, history):
    messages = [
        {"role": "system", "content": "You are a helpful tutor."}
    ]

    for msg in history:
        messages.append({
            "role": msg.role,
            "content": msg.content
        })

    messages.append({
        "role": "user",
        "content": f"""
Use the context below to answer clearly and simply.

Context:
{context}

Question:
{query}
"""
    })

    return messages


def detect_concept(query: str):
    """
    Simple first version:
    use the cleaned query itself as the concept name.
    Later we will upgrade this with AI extraction.
    """
    concept_name = query.lower().strip()

    concept, _ = Concept.objects.get_or_create(name=concept_name)
    return concept


def update_mastery(user, concept, correct=True):
    mastery, _ = LearnerConceptMastery.objects.get_or_create(
        user=user,
        concept=concept,
    )

    if correct:
        mastery.mastery_score = min(1.0, mastery.mastery_score + 0.1)
    else:
        mastery.mastery_score = max(0.0, mastery.mastery_score - 0.1)

    mastery.practice_count += 1
    mastery.save()

    return mastery


def answer_question(user, query: str):
    session = get_or_create_session(user)

    concept = detect_concept(query)

    chunks = semantic_search(query, limit=5)
    context = "\n\n".join([c.content for c in chunks])

    history = get_recent_history(session)
    messages = build_messages(query, context, history)

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
    )

    answer = response.choices[0].message.content

    update_mastery(user, concept, correct=True)

    StudyMessage.objects.create(
        session=session,
        role="user",
        content=query
    )

    StudyMessage.objects.create(
        session=session,
        role="assistant",
        content=answer
    )

    return answer