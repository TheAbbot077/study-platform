import json
import os

from pypdf import PdfReader
from openai import OpenAI

from knowledge.models import Concept, ConceptRelation, DocumentChunk

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def clean_text(text: str) -> str:
    if not text:
        return ""

    text = text.replace("\x00", "")

    cleaned = []
    for ch in text:
        code = ord(ch)
        if ch in "\n\r\t" or code >= 32:
            cleaned.append(ch)

    return "".join(cleaned)


def extract_text_from_pdf(file_path: str) -> str:
    reader = PdfReader(file_path)
    text = ""

    for page in reader.pages:
        try:
            page_text = page.extract_text() or ""
            text += clean_text(page_text)
            text += "\n"
        except Exception:
            continue

    return clean_text(text).strip()


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50):
    text = clean_text(text)

    if not text.strip():
        return []

    chunks = []
    start = 0

    while start < len(text):
        end = start + chunk_size
        chunk = clean_text(text[start:end].strip())

        if chunk:
            chunks.append(chunk)

        if end >= len(text):
            break

        start += chunk_size - overlap

    return chunks


def get_embedding(text: str):
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=clean_text(text),
    )
    return response.data[0].embedding


def truncate_for_extraction(text: str, max_chars: int = 12000) -> str:
    text = clean_text(text)
    return text[:max_chars]


def extract_concepts_and_relationships(text: str):
    """
    Returns a dict like:
    {
      "concepts": [
        {"name": "...", "description": "..."},
        ...
      ],
      "relationships": [
        {"from": "...", "to": "...", "type": "PREREQ"},
        {"from": "...", "to": "...", "type": "RELATED"},
        {"from": "...", "to": "...", "type": "PART_OF"}
      ]
    }
    """
    text = truncate_for_extraction(text)

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": (
                    "You extract academic concepts and concept relationships from study material. "
                    "Return valid JSON only.\n\n"
                    "Schema:\n"
                    "{\n"
                    '  "concepts": [\n'
                    '    {"name": "concept name", "description": "short description"}\n'
                    "  ],\n"
                    '  "relationships": [\n'
                    '    {"from": "concept A", "to": "concept B", "type": "PREREQ|RELATED|PART_OF"}\n'
                    "  ]\n"
                    "}\n\n"
                    "Rules:\n"
                    "- Concepts must be atomic teachable concepts.\n"
                    "- Keep descriptions brief and clear.\n"
                    "- Only use relationship types: PREREQ, RELATED, PART_OF.\n"
                    "- Use concept names consistently across concepts and relationships.\n"
                    "- Do not invent concepts not reasonably supported by the text.\n"
                    "- Return no commentary, only JSON."
                ),
            },
            {
                "role": "user",
                "content": f"Extract concepts and relationships from this study material:\n\n{text}",
            },
        ],
    )

    raw = response.choices[0].message.content
    data = json.loads(raw)

    concepts = data.get("concepts", [])
    relationships = data.get("relationships", [])

    if not isinstance(concepts, list):
        concepts = []

    if not isinstance(relationships, list):
        relationships = []

    return {
        "concepts": concepts,
        "relationships": relationships,
    }


def save_extracted_concepts(document, extracted_data):
    """
    Creates/updates Concept and ConceptRelation rows for this document's subject.
    """
    subject = document.subject
    if not subject:
        return

    concept_map = {}

    for item in extracted_data.get("concepts", []):
        name = clean_text(str(item.get("name", "")).strip())
        description = clean_text(str(item.get("description", "")).strip())

        if not name:
            continue

        concept, created = Concept.objects.get_or_create(
            subject=subject,
            name=name,
            defaults={
                "description": description,
                "source_document": document,
            },
        )

        updated_fields = []

        if not concept.description and description:
            concept.description = description
            updated_fields.append("description")

        if concept.source_document_id is None:
            concept.source_document = document
            updated_fields.append("source_document")

        if updated_fields:
            concept.save(update_fields=updated_fields)

        concept_map[name.lower()] = concept

    for rel in extracted_data.get("relationships", []):
        from_name = clean_text(str(rel.get("from", "")).strip())
        to_name = clean_text(str(rel.get("to", "")).strip())
        relation_type = clean_text(str(rel.get("type", "")).strip().upper())

        if not from_name or not to_name:
            continue

        if relation_type not in {"PREREQ", "RELATED", "PART_OF"}:
            continue

        from_concept = concept_map.get(from_name.lower())
        to_concept = concept_map.get(to_name.lower())

        if not from_concept or not to_concept:
            continue

        ConceptRelation.objects.get_or_create(
            from_concept=from_concept,
            to_concept=to_concept,
            relation_type=relation_type,
        )

        if relation_type == "PREREQ":
            to_concept.prerequisites.add(from_concept)


def process_document(document):
    document.status = "processing"
    document.save(update_fields=["status"])

    try:
        DocumentChunk.objects.filter(document=document).delete()

        text = extract_text_from_pdf(document.file.path)

        if not text:
            document.status = "failed"
            document.save(update_fields=["status"])
            print(f"No text extracted from document {document.id}")
            return

        chunks = chunk_text(text)

        if not chunks:
            document.status = "failed"
            document.save(update_fields=["status"])
            print(f"No chunks created for document {document.id}")
            return

        for i, chunk in enumerate(chunks):
            chunk = clean_text(chunk)

            if not chunk.strip():
                continue

            embedding = None

            try:
                embedding = get_embedding(chunk)
            except Exception as e:
                print(f"Embedding failed for chunk {i} of document {document.id}: {e}")

            DocumentChunk.objects.create(
                document=document,
                content=chunk,
                chunk_index=i,
                embedding=embedding,
            )

        try:
            extracted_data = extract_concepts_and_relationships(text)
            save_extracted_concepts(document, extracted_data)
        except Exception as e:
            print(f"Concept extraction failed for document {document.id}: {e}")

        document.status = "ready"
        document.save(update_fields=["status"])

    except Exception as e:
        document.status = "failed"
        document.save(update_fields=["status"])
        print(f"Document processing failed for document {document.id}: {e}")
        raise