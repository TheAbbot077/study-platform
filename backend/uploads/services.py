import json
import os
import re
from io import BytesIO

from pypdf import PdfReader
from openai import OpenAI

from knowledge.models import Concept, ConceptRelation, DocumentChunk
from uploads.models import DocumentSection

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
EMBEDDING_BATCH_SIZE = int(os.getenv("EMBEDDING_BATCH_SIZE", "32"))
CHUNK_BULK_INSERT_SIZE = int(os.getenv("CHUNK_BULK_INSERT_SIZE", "200"))
EXTRACTION_MAX_CHARS = int(os.getenv("EXTRACTION_MAX_CHARS", "24000"))

NOISE_SECTION_TITLES = {
    "acknowledgements",
    "acknowledgments",
    "foreword",
    "preface",
    "introduction to this book",
    "about the author",
    "about the authors",
    "author biography",
    "authors",
    "credits",
    "copyright",
    "dedication",
    "table of contents",
    "contents",
    "index",
    "glossary",
    "appendix",
    "appendices",
    "photo credits",
    "permissions",
    "references",
    "bibliography",
}

NOISE_CONCEPT_PATTERNS = [
    r"\backnowledg(e)?ments?\b",
    r"\bforeword\b",
    r"\bpreface\b",
    r"\btable of contents\b",
    r"\bcontents\b",
    r"\bindex\b",
    r"\bglossary\b",
    r"\bcopyright\b",
    r"\bdedication\b",
    r"\bphoto credits\b",
    r"\bpermissions\b",
    r"\breferences\b",
    r"\bbibliography\b",
    r"\babout the author(s)?\b",
]


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


def extract_text_from_pdf(file_source) -> str:
    if hasattr(file_source, "read"):
        data = file_source.read()
        if hasattr(file_source, "seek"):
            file_source.seek(0)
        reader = PdfReader(BytesIO(data))
    else:
        reader = PdfReader(file_source)
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


def get_embeddings(texts):
    cleaned_texts = [clean_text(text) for text in texts if clean_text(text).strip()]
    if not cleaned_texts:
        return []

    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=cleaned_texts,
    )
    return [item.embedding for item in response.data]


def truncate_for_extraction(text: str, max_chars: int = 12000) -> str:
    text = clean_text(text)
    return text[:max_chars]


def set_document_failure(document, message: str):
    document.status = "failed"
    document.processing_error = clean_text(message).strip()
    document.save(update_fields=["status", "processing_error"])


def set_document_ready(document):
    document.status = "ready"
    document.processing_error = ""
    document.save(update_fields=["status", "processing_error"])


def _is_heading_line(line: str) -> bool:
    cleaned = clean_text(line).strip()

    if len(cleaned) < 4 or len(cleaned) > 120:
        return False

    if cleaned.endswith("."):
        return False

    if re.match(r"^(chapter|section|topic|unit)\b", cleaned, flags=re.IGNORECASE):
        return True

    if re.match(r"^\d+(\.\d+)*[\)\.\-:]?\s+\S+", cleaned):
        return True

    words = cleaned.split()
    if not words:
        return False

    title_like_words = [
        word for word in words
        if word[:1].isupper() or word.isupper()
    ]
    uppercase_ratio = len(title_like_words) / len(words)

    return uppercase_ratio >= 0.8


def _normalize_title(text: str) -> str:
    return re.sub(r"[^a-z0-9\s]", "", clean_text(text).strip().lower())


def _strip_leading_label(text: str) -> str:
    cleaned = clean_text(text).strip()
    cleaned = re.sub(
        r"^(chapter|unit|section|part|topic)\s+[a-z0-9ivxlcdm\.\-]+\s*[:\-]?\s*",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    return cleaned.strip()


def _is_noise_title(title: str) -> bool:
    normalized = _normalize_title(_strip_leading_label(title))
    if not normalized:
        return False

    if normalized in NOISE_SECTION_TITLES:
        return True

    return any(re.search(pattern, normalized, flags=re.IGNORECASE) for pattern in NOISE_CONCEPT_PATTERNS)


def _is_major_section_heading(line: str) -> bool:
    cleaned = clean_text(line).strip()
    if not cleaned or _is_noise_title(cleaned):
        return False

    if re.match(r"^(chapter|unit)\s+[a-z0-9ivxlcdm]+\b", cleaned, flags=re.IGNORECASE):
        return True

    if re.match(r"^\d{1,2}\s+[A-Z][A-Za-z0-9 ,:\-\(\)]+$", cleaned):
        return True

    if re.match(r"^[IVXLCM]{1,6}\.\s+[A-Z][A-Za-z0-9 ,:\-\(\)]+$", cleaned):
        return True

    return False


def _build_section_ranges(text: str):
    lines = clean_text(text).splitlines()
    ranges = []
    offset = 0
    current_title = "Introduction"
    current_start = 0

    for line in lines:
        stripped = line.strip()
        line_start = offset
        line_end = offset + len(line)

        if stripped and _is_heading_line(stripped):
            ranges.append(
                {
                    "title": current_title,
                    "start": current_start,
                    "end": line_start,
                }
            )
            current_title = stripped
            current_start = line_start

        offset = line_end + 1

    ranges.append(
        {
            "title": current_title,
            "start": current_start,
            "end": len(text),
        }
    )

    return ranges


def _build_document_sections(text: str, fallback_title: str):
    cleaned_text = clean_text(text)
    lines = cleaned_text.splitlines()
    sections = []
    offset = 0
    current_title = clean_text(fallback_title).strip() or "Chapter 1"
    current_start = 0
    found_major_heading = False

    for line in lines:
        stripped = line.strip()
        line_start = offset
        line_end = offset + len(line)

        if stripped and _is_major_section_heading(stripped):
            if found_major_heading:
                sections.append(
                    {
                        "title": current_title,
                        "start": current_start,
                        "end": line_start,
                    }
                )
            current_title = stripped
            current_start = line_start
            found_major_heading = True

        offset = line_end + 1

    sections.append(
        {
            "title": current_title,
            "start": current_start,
            "end": len(cleaned_text),
        }
    )

    filtered_sections = []
    for section in sections:
        title = clean_text(section["title"]).strip()
        body = clean_text(cleaned_text[section["start"]:section["end"]]).strip()
        if _is_noise_title(title):
            continue
        if len(body) < 80:
            continue
        filtered_sections.append(
            {
                "title": title,
                "content": body,
            }
        )

    if filtered_sections:
        return filtered_sections

    fallback_sections = []
    for section in _trim_noise_sections(_build_section_ranges(cleaned_text)):
        title = clean_text(section["title"]).strip()
        body = clean_text(cleaned_text[section["start"]:section["end"]]).strip()
        if _is_noise_title(title):
            continue
        if len(body) < 80:
            continue
        fallback_sections.append(
            {
                "title": title,
                "content": body,
            }
        )

    return fallback_sections or [
        {
            "title": clean_text(fallback_title).strip() or "Main Material",
            "content": cleaned_text,
        }
    ]


def _trim_noise_sections(section_ranges):
    trimmed = list(section_ranges)

    while trimmed and _is_noise_title(trimmed[0]["title"]):
        trimmed.pop(0)

    while trimmed and _is_noise_title(trimmed[-1]["title"]):
        trimmed.pop()

    return trimmed


def _section_body(text: str, section: dict) -> str:
    return clean_text(text[section["start"]:section["end"]]).strip()


def _sample_document_for_extraction(text: str, max_chars: int = EXTRACTION_MAX_CHARS) -> str:
    cleaned_text = clean_text(text).strip()
    section_ranges = _trim_noise_sections(_build_section_ranges(cleaned_text))
    if not section_ranges:
        return truncate_for_extraction(cleaned_text, max_chars=max_chars)

    sections_with_body = []
    for section in section_ranges:
        body = _section_body(cleaned_text, section)
        if len(body) < 80:
            continue
        if _is_noise_title(section["title"]):
            continue
        sections_with_body.append(
            {
                "title": clean_text(section["title"]).strip(),
                "body": body,
            }
        )

    if not sections_with_body:
        return truncate_for_extraction(cleaned_text, max_chars=max_chars)

    full_text_without_noise = "\n\n".join(
        f"{section['title']}\n{section['body']}".strip()
        for section in sections_with_body
    ).strip()

    if len(full_text_without_noise) <= max_chars:
        return full_text_without_noise

    budget = max_chars
    samples = []
    sample_count = min(len(sections_with_body), 24)
    if sample_count == 1:
        chosen_indexes = [0]
    else:
        chosen_indexes = sorted(
            {
                round(index * (len(sections_with_body) - 1) / (sample_count - 1))
                for index in range(sample_count)
            }
        )

    per_section_limit = max(450, min(1200, budget // max(len(chosen_indexes), 1)))

    for index in chosen_indexes:
        section = sections_with_body[index]
        title = section["title"]
        body = section["body"]
        snippet = body[:per_section_limit].strip()
        sample = f"{title}\n{snippet}"

        if len(sample) > budget and not samples:
            return sample[:max_chars].strip()

        if len(sample) > budget:
            break

        samples.append(sample)
        budget -= len(sample) + 2

        if budget <= 0:
            break

    sampled_text = "\n\n".join(samples).strip()
    if sampled_text:
        return sampled_text[:max_chars]

    return truncate_for_extraction(cleaned_text, max_chars=max_chars)


def _is_noise_concept(name: str, description: str = "") -> bool:
    combined = clean_text(f"{name} {description}").strip().lower()
    if not combined:
        return True

    return any(re.search(pattern, combined, flags=re.IGNORECASE) for pattern in NOISE_CONCEPT_PATTERNS)


def _filter_extracted_data(extracted_data):
    valid_concepts = []
    allowed_names = set()

    for item in extracted_data.get("concepts", []):
        name = clean_text(str(item.get("name", "")).strip())
        description = clean_text(str(item.get("description", "")).strip())

        if not name or _is_noise_concept(name, description):
            continue

        valid_concepts.append(
            {
                "name": name,
                "description": description,
            }
        )
        allowed_names.add(name.lower())

    valid_relationships = []
    for rel in extracted_data.get("relationships", []):
        from_name = clean_text(str(rel.get("from", "")).strip())
        to_name = clean_text(str(rel.get("to", "")).strip())
        relation_type = clean_text(str(rel.get("type", "")).strip().upper())

        if not from_name or not to_name:
            continue
        if from_name.lower() not in allowed_names or to_name.lower() not in allowed_names:
            continue
        if relation_type not in {"PREREQ", "RELATED", "PART_OF"}:
            continue

        valid_relationships.append(
            {
                "from": from_name,
                "to": to_name,
                "type": relation_type,
            }
        )

    return {
        "concepts": valid_concepts,
        "relationships": valid_relationships,
    }


def _filter_chapter_extracted_data(extracted_data):
    chapter = extracted_data.get("chapter") or {}
    chapter_title = clean_text(str(chapter.get("title", "")).strip())
    chapter_summary = clean_text(str(chapter.get("summary", "")).strip())

    valid_concepts = []
    allowed_names = set()

    for concept in extracted_data.get("concepts", []):
        name = clean_text(str(concept.get("name", "")).strip())
        description = clean_text(str(concept.get("description", "")).strip())
        if not name or _is_noise_concept(name, description):
            continue

        subtopics = []
        for subtopic in concept.get("subtopics", []):
            subtopic_name = clean_text(str(subtopic.get("name", "")).strip())
            subtopic_description = clean_text(str(subtopic.get("description", "")).strip())
            if not subtopic_name or _is_noise_concept(subtopic_name, subtopic_description):
                continue
            subtopics.append(
                {
                    "name": subtopic_name,
                    "description": subtopic_description,
                }
            )
            allowed_names.add(subtopic_name.lower())

        valid_concepts.append(
            {
                "name": name,
                "description": description,
                "subtopics": subtopics,
            }
        )
        allowed_names.add(name.lower())

    valid_relationships = []
    for rel in extracted_data.get("relationships", []):
        from_name = clean_text(str(rel.get("from", "")).strip())
        to_name = clean_text(str(rel.get("to", "")).strip())
        relation_type = clean_text(str(rel.get("type", "")).strip().upper())

        if not from_name or not to_name:
            continue
        if relation_type not in {"PREREQ", "RELATED", "PART_OF"}:
            continue
        if from_name.lower() not in allowed_names or to_name.lower() not in allowed_names:
            continue

        valid_relationships.append(
            {
                "from": from_name,
                "to": to_name,
                "type": relation_type,
            }
        )

    return {
        "chapter": {
            "title": chapter_title,
            "summary": chapter_summary,
        },
        "concepts": valid_concepts,
        "relationships": valid_relationships,
    }


def _find_section_index(position: int, section_ranges):
    for index, section in enumerate(section_ranges):
        if section["start"] <= position <= section["end"]:
            return index
    return 0


def _creates_prereq_cycle(prereq_concept, target_concept):
    stack = [prereq.id for prereq in target_concept.prerequisites.all()]
    visited = set()

    while stack:
        concept_id = stack.pop()
        if concept_id in visited:
            continue

        if concept_id == prereq_concept.id:
            return True

        visited.add(concept_id)
        stack.extend(
            Concept.objects.get(id=concept_id).prerequisites.values_list("id", flat=True)
        )

    return False


def infer_prerequisites_from_document(document, concept_map, raw_text: str):
    subject = document.subject
    if not subject or not raw_text.strip():
        return

    section_ranges = _build_section_ranges(raw_text)
    concept_positions = []

    for concept in concept_map.values():
        match = re.search(re.escape(concept.name), raw_text, flags=re.IGNORECASE)
        if not match:
            continue

        position = match.start()
        concept_positions.append(
            {
                "concept": concept,
                "position": position,
                "section_index": _find_section_index(position, section_ranges),
            }
        )

    concept_positions.sort(
        key=lambda item: (
            item["section_index"],
            item["position"],
            item["concept"].name.lower(),
        )
    )

    for index, item in enumerate(concept_positions):
        concept = item["concept"]
        existing_prereqs = concept.prerequisites.filter(subject=subject)
        if existing_prereqs.exists():
            continue

        candidate = None
        for previous in reversed(concept_positions[:index]):
            if previous["concept"].id == concept.id:
                continue

            if previous["section_index"] < item["section_index"] - 1:
                break

            candidate = previous["concept"]
            break

        if candidate is None:
            continue

        if _creates_prereq_cycle(candidate, concept):
            continue

        ConceptRelation.objects.get_or_create(
            from_concept=candidate,
            to_concept=concept,
            relation_type="PREREQ",
        )
        concept.prerequisites.add(candidate)


def extract_concepts_and_relationships(text: str, chapter_title: str | None = None):
    sampled_text = _sample_document_for_extraction(text)
    chapter_label = clean_text(chapter_title or "").strip() or "Main Material"

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": (
                    "You extract a chapter-first study syllabus from academic material. "
                    "Return valid JSON only.\n\n"
                    "Schema:\n"
                    "{\n"
                    '  "chapter": {"title": "chapter title", "summary": "1-2 sentence overview"},\n'
                    '  "concepts": [\n'
                    '    {\n'
                    '      "name": "concept name",\n'
                    '      "description": "short description",\n'
                    '      "subtopics": [\n'
                    '        {"name": "subtopic name", "description": "short description"}\n'
                    "      ]\n"
                    "    }\n"
                    "  ],\n"
                    '  "relationships": [\n'
                    '    {"from": "concept or subtopic A", "to": "concept or subtopic B", "type": "PREREQ|RELATED|PART_OF"}\n'
                    "  ]\n"
                    "}\n\n"
                    "Rules:\n"
                    "- Stay strictly inside the actual subject matter taught in the chapter.\n"
                    "- Ignore acknowledgements, forewords, prefaces, contents pages, glossaries, indices, references, dedications, publishing notes, and any non-teaching material.\n"
                    "- Prefer chapter concepts that are genuinely taught in the material.\n"
                    "- For each concept, include the main subtopics that build toward understanding it.\n"
                    "- Do not invent concepts or subtopics that are not supported by the text.\n"
                    "- Keep the number of concepts focused and useful for study, not a noisy dump.\n"
                    "- Return no commentary, only JSON."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Chapter title: {chapter_label}\n\n"
                    f"Build a chapter-first syllabus from this material:\n\n{sampled_text}"
                ),
            },
        ],
    )

    raw = response.choices[0].message.content
    data = json.loads(raw)

    return _filter_chapter_extracted_data(
        {
            "chapter": data.get("chapter", {}),
            "concepts": data.get("concepts", []),
            "relationships": data.get("relationships", []),
        }
    )


def save_extracted_concepts(
    document,
    extracted_data,
    raw_text="",
    rebuild_syllabus=True,
    section=None,
):
    """
    Creates/updates Concept and ConceptRelation rows for this document's subject.
    """
    subject = document.subject
    if not subject:
        return {
            "concept_count": 0,
            "relationship_count": 0,
        }

    concept_map = {}
    relationship_count = 0
    created_count = 0

    chapter_data = extracted_data.get("chapter") or {}
    chapter_title = clean_text(
        str(
            chapter_data.get("title")
            or (section.title if section else "")
            or document.title
        ).strip()
    )
    chapter_summary = clean_text(str(chapter_data.get("summary", "")).strip())

    chapter_concept, chapter_created = Concept.objects.get_or_create(
        subject=subject,
        name=chapter_title,
        defaults={
            "description": chapter_summary,
            "node_type": "CHAPTER",
            "source_document": document,
        },
    )
    chapter_updates = []
    if chapter_concept.node_type != "CHAPTER":
        chapter_concept.node_type = "CHAPTER"
        chapter_updates.append("node_type")
    if chapter_concept.parent_id is not None:
        chapter_concept.parent = None
        chapter_updates.append("parent")
    if not chapter_concept.description and chapter_summary:
        chapter_concept.description = chapter_summary
        chapter_updates.append("description")
    if chapter_concept.source_document_id is None:
        chapter_concept.source_document = document
        chapter_updates.append("source_document")
    if section is not None:
        chapter_concept.syllabus_order = section.order_index * 1000
        chapter_updates.append("syllabus_order")
    if chapter_updates:
        chapter_concept.save(update_fields=list(dict.fromkeys(chapter_updates)))
    concept_map[chapter_concept.name.lower()] = chapter_concept
    if chapter_created:
        created_count += 1

    local_order = 1
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
                "node_type": "CONCEPT",
                "parent": chapter_concept,
                "syllabus_order": chapter_concept.syllabus_order + local_order,
            },
        )

        updated_fields = []
        if concept.node_type != "CONCEPT":
            concept.node_type = "CONCEPT"
            updated_fields.append("node_type")
        if concept.parent_id != chapter_concept.id:
            concept.parent = chapter_concept
            updated_fields.append("parent")
        if not concept.description and description:
            concept.description = description
            updated_fields.append("description")
        if concept.source_document_id is None:
            concept.source_document = document
            updated_fields.append("source_document")
        if concept.syllabus_order == 0:
            concept.syllabus_order = chapter_concept.syllabus_order + local_order
            updated_fields.append("syllabus_order")
        if updated_fields:
            concept.save(update_fields=list(dict.fromkeys(updated_fields)))

        concept_map[name.lower()] = concept
        if created:
            created_count += 1

        local_order += 1
        for subtopic_item in item.get("subtopics", []):
            subtopic_name = clean_text(str(subtopic_item.get("name", "")).strip())
            subtopic_description = clean_text(
                str(subtopic_item.get("description", "")).strip()
            )
            if not subtopic_name:
                continue

            subtopic, subtopic_created = Concept.objects.get_or_create(
                subject=subject,
                name=subtopic_name,
                defaults={
                    "description": subtopic_description,
                    "source_document": document,
                    "node_type": "SUBTOPIC",
                    "parent": concept,
                    "syllabus_order": chapter_concept.syllabus_order + local_order,
                },
            )

            subtopic_updates = []
            if subtopic.node_type != "SUBTOPIC":
                subtopic.node_type = "SUBTOPIC"
                subtopic_updates.append("node_type")
            if subtopic.parent_id != concept.id:
                subtopic.parent = concept
                subtopic_updates.append("parent")
            if not subtopic.description and subtopic_description:
                subtopic.description = subtopic_description
                subtopic_updates.append("description")
            if subtopic.source_document_id is None:
                subtopic.source_document = document
                subtopic_updates.append("source_document")
            if subtopic.syllabus_order == 0:
                subtopic.syllabus_order = chapter_concept.syllabus_order + local_order
                subtopic_updates.append("syllabus_order")
            if subtopic_updates:
                subtopic.save(update_fields=list(dict.fromkeys(subtopic_updates)))

            ConceptRelation.objects.get_or_create(
                from_concept=subtopic,
                to_concept=concept,
                relation_type="PART_OF",
            )

            concept_map[subtopic_name.lower()] = subtopic
            if subtopic_created:
                created_count += 1
            local_order += 1

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
        relationship_count += 1

    infer_prerequisites_from_document(
        document=document,
        concept_map=concept_map,
        raw_text=raw_text,
    )

    if rebuild_syllabus:
        from knowledge.services import rebuild_subject_syllabus

        rebuild_subject_syllabus(subject)

    study_node_count = sum(
        1 + len(item.get("subtopics", []))
        for item in extracted_data.get("concepts", [])
    )

    return {
        "concept_count": study_node_count,
        "relationship_count": relationship_count,
        "chapter_name": chapter_concept.name,
    }


def clear_document_knowledge(document):
    Concept.objects.filter(source_document=document).delete()
    DocumentChunk.objects.filter(document=document).delete()
    DocumentSection.objects.filter(document=document).delete()


def _store_document_sections(document, text: str):
    sections = _build_document_sections(text, fallback_title=document.title)
    stored_sections = []

    for index, section in enumerate(sections):
        stored_sections.append(
            DocumentSection.objects.create(
                document=document,
                title=section["title"],
                order_index=index,
                content=section["content"],
            )
        )

    return stored_sections


def _append_document_chunks(document, text: str):
    existing_max_chunk = (
        DocumentChunk.objects.filter(document=document)
        .order_by("-chunk_index")
        .values_list("chunk_index", flat=True)
        .first()
    )
    starting_index = 0 if existing_max_chunk is None else existing_max_chunk + 1

    chunks = chunk_text(text)
    prepared_chunks = []
    for offset, chunk in enumerate(chunks):
        cleaned_chunk = clean_text(chunk)
        if not cleaned_chunk.strip():
            continue
        prepared_chunks.append(
            {
                "chunk_index": starting_index + offset,
                "content": cleaned_chunk,
                "embedding": None,
            }
        )

    for start in range(0, len(prepared_chunks), EMBEDDING_BATCH_SIZE):
        batch = prepared_chunks[start:start + EMBEDDING_BATCH_SIZE]
        batch_texts = [item["content"] for item in batch]
        try:
            embeddings = get_embeddings(batch_texts)
            for item, embedding in zip(batch, embeddings):
                item["embedding"] = embedding
        except Exception as exc:
            first_index = batch[0]["chunk_index"]
            last_index = batch[-1]["chunk_index"]
            print(
                f"Embedding failed for chunks {first_index}-{last_index} "
                f"of document {document.id}: {exc}"
            )

    if prepared_chunks:
        DocumentChunk.objects.bulk_create(
            [
                DocumentChunk(
                    document=document,
                    content=item["content"],
                    chunk_index=item["chunk_index"],
                    embedding=item["embedding"],
                )
                for item in prepared_chunks
            ],
            batch_size=CHUNK_BULK_INSERT_SIZE,
        )


def _refresh_document_status_from_sections(document):
    statuses = list(document.sections.values_list("status", flat=True))
    if not statuses:
        return

    if any(status == "ready" for status in statuses):
        set_document_ready(document)
        return

    if all(status == "failed" for status in statuses):
        set_document_failure(
            document,
            "No chapters could be processed successfully from this document.",
        )
        return

    document.status = "processing"
    document.save(update_fields=["status"])


def process_document_section(section, rebuild_syllabus=True):
    section.status = "processing"
    section.processing_error = ""
    section.save(update_fields=["status", "processing_error"])

    try:
        _append_document_chunks(section.document, section.content)
        extracted_data = extract_concepts_and_relationships(
            section.content,
            chapter_title=section.title,
        )
        result = save_extracted_concepts(
            section.document,
            extracted_data,
            raw_text=section.content,
            rebuild_syllabus=rebuild_syllabus,
            section=section,
        )

        if result["concept_count"] == 0:
            section.status = "failed"
            section.processing_error = (
                "No study concepts could be extracted from this chapter."
            )
            section.save(update_fields=["status", "processing_error"])
            _refresh_document_status_from_sections(section.document)
            return result

        section.status = "ready"
        section.processing_error = ""
        section.save(update_fields=["status", "processing_error"])
        _refresh_document_status_from_sections(section.document)
        return result
    except Exception as exc:
        section.status = "failed"
        section.processing_error = clean_text(str(exc))
        section.save(update_fields=["status", "processing_error"])
        _refresh_document_status_from_sections(section.document)
        raise


def rebuild_subject_from_documents(subject):
    documents = list(subject.documents.order_by("created_at"))

    processed_documents = 0
    failed_documents = []
    skipped_documents = []
    rebuilt_concept_count = 0

    for document in documents:
        if not document.file:
            skipped_documents.append(
                {
                    "document_id": document.id,
                    "title": document.title,
                    "reason": "Document file is missing.",
                }
            )
            continue

        try:
            clear_document_knowledge(document)
            document.file.open("rb")
            try:
                text = extract_text_from_pdf(document.file)
            finally:
                document.file.close()
            if not text:
                message = (
                    "No readable text could be extracted from this file during syllabus rebuild."
                )
                set_document_failure(document, message)
                failed_documents.append(
                    {
                        "document_id": document.id,
                        "title": document.title,
                        "reason": message,
                    }
                )
                continue

            sections = _store_document_sections(document, text)
            if not sections:
                message = "No chapter-like sections could be identified during syllabus rebuild."
                set_document_failure(document, message)
                failed_documents.append(
                    {
                        "document_id": document.id,
                        "title": document.title,
                        "reason": message,
                    }
                )
                continue

            document_concept_count = 0
            for index, section in enumerate(sections):
                result = process_document_section(
                    section,
                    rebuild_syllabus=False,
                )
                document_concept_count += result["concept_count"]

            if document_concept_count == 0:
                message = (
                    "No study topics could be extracted from this file during syllabus rebuild."
                )
                set_document_failure(document, message)
                failed_documents.append(
                    {
                        "document_id": document.id,
                        "title": document.title,
                        "reason": message,
                    }
                )
                continue

            processed_documents += 1
            rebuilt_concept_count += document_concept_count
            set_document_ready(document)
        except Exception as exc:
            message = f"Syllabus rebuild failed for this document: {exc}"
            set_document_failure(document, message)
            failed_documents.append(
                {
                    "document_id": document.id,
                    "title": document.title,
                    "reason": clean_text(message),
                }
            )

    from knowledge.services import rebuild_subject_syllabus

    rebuild_subject_syllabus(subject)

    return {
        "subject_id": subject.id,
        "subject_name": subject.name,
        "documents_seen": len(documents),
        "documents_processed": processed_documents,
        "documents_failed": len(failed_documents),
        "documents_skipped": len(skipped_documents),
        "rebuilt_concept_count": rebuilt_concept_count,
        "concept_count": Concept.objects.filter(subject=subject).count(),
        "failed_documents": failed_documents,
        "skipped_documents": skipped_documents,
    }


def process_document(document):
    document.status = "processing"
    document.processing_error = ""
    document.save(update_fields=["status", "processing_error"])

    try:
        clear_document_knowledge(document)

        document.file.open("rb")
        try:
            text = extract_text_from_pdf(document.file)
        finally:
            document.file.close()
        if not text:
            message = (
                "No readable text could be extracted from this file. "
                "Try a text-based PDF or upload a clearer source document."
            )
            set_document_failure(document, message)
            print(f"No text extracted from document {document.id}")
            return

        sections = _store_document_sections(document, text)
        if not sections:
            set_document_failure(
                document,
                "No chapter-like sections could be identified in this document. Try a clearer text-based PDF with recognizable chapter headings.",
            )
            return

        total_concept_count = 0
        failed_sections = []

        for section in sections:
            result = process_document_section(section, rebuild_syllabus=False)
            total_concept_count += result["concept_count"]

            section.refresh_from_db()
            if section.status == "failed":
                failed_sections.append(section.title)

        if total_concept_count == 0:
            set_document_failure(
                document,
                "No study topics could be extracted from this file. Try a clearer, text-based PDF with recognizable chapter headings.",
            )
            print(f"No concepts extracted for document {document.id}")
            return

        from knowledge.services import rebuild_subject_syllabus

        rebuild_subject_syllabus(document.subject)

        if failed_sections:
            document.status = "ready"
            document.processing_error = (
                "Some sections could not be processed: "
                + ", ".join(failed_sections[:5])
            )
            document.save(update_fields=["status", "processing_error"])
        else:
            set_document_ready(document)
    except Exception as exc:
        set_document_failure(
            document,
            f"Document processing failed: {exc}",
        )
        print(f"Document processing failed for document {document.id}: {exc}")
        raise
