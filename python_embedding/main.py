from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
import os

app = FastAPI(title="Qwen3 Local Embedding Service")

model_name = os.getenv("MODEL_NAME", "Qwen/Qwen3-Embedding-0.6B")
print(f"Loading embedding model: {model_name}...")
model = SentenceTransformer(model_name)
print("Model loaded successfully!")

class EmbedRequest(BaseModel):
    texts: list[str]

@app.post("/embed")
def get_embeddings(request: EmbedRequest):
    try:
        if not request.texts:
            return {"embeddings": []}
        embeddings = model.encode(request.texts, normalize_embeddings=True)
        return {"embeddings": embeddings.tolist()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
def health_check():
    return {"status": "healthy", "model": model_name}