from pypdf import PdfReader
from openai import OpenAI
from knowledge.models import DocumentChunk
import os

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def extract_text_from_pdf(file_path: str) -> str:
    reader = PdfReader(file_path)
    text = ""

    for page in reader.pages:
        try:
            text += page.extract_text() or ""
            text += "\n"
        except Exception:
            continue

    return text.strip()


def chunk_text(text: str, chunk_size=500, overlap=50):
    chunks = []
    start = 0

    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end].strip()

        if chunk:
            chunks.append(chunk)

        start += chunk_size - overlap

    return chunks


def get_embedding(text: str):
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=text
    )
    return response.data[0].embedding


def process_document(document):
    document.status = "processing"
    document.save()

    try:
        text = extract_text_from_pdf(document.file.path)

        if not text:
            document.status = "failed"
            document.save()
            print(f"No text extracted from document {document.id}")
            return

        chunks = chunk_text(text)

        if not chunks:
            document.status = "failed"
            document.save()
            print(f"No chunks created for document {document.id}")
            return

        for i, chunk in enumerate(chunks):
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

        document.status = "ready"
        document.save()

    except Exception as e:
        document.status = "failed"
        document.save()
        print(f"Document processing failed for document {document.id}: {e}")
        raise