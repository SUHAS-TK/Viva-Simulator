"""
RAG vector store management using FAISS + sentence-transformers (with robust fallback).
Each project gets its own isolated index directory to prevent cross-contamination.
"""
from __future__ import annotations

import json
import logging
import math
import os
import pickle
import re
from pathlib import Path
from typing import Optional

import numpy as np

from app.rag.document_parser import ParsedChunk
from config import Config

logger = logging.getLogger(__name__)

# Check if FAISS is available in this Python environment
try:
    import faiss
    HAS_FAISS = True
except ImportError:
    faiss = None  # type: ignore[assignment]
    HAS_FAISS = False
    logger.info("FAISS not installed; using built-in vector similarity engine.")

# Lazy-loaded singleton embedding model
_embed_model = None


def get_embed_model():
    """Return the (cached) sentence-transformer model if available."""
    global _embed_model
    if _embed_model is None:
        try:
            from sentence_transformers import SentenceTransformer
            logger.info("Loading embedding model: %s", Config.EMBEDDING_MODEL)
            _embed_model = SentenceTransformer(Config.EMBEDDING_MODEL)
        except ImportError:
            _embed_model = False
    return _embed_model if _embed_model is not False else None


def _tokenize(text: str) -> list[str]:
    """Simple tokeniser extracting lowercased alphanumeric words."""
    return re.findall(r"\b[a-zA-Z0-9_-]{2,}\b", text.lower())


def _embed(texts: list[str]) -> np.ndarray:
    """Embed a list of strings, returning float32 numpy array."""
    model = get_embed_model()
    if model is not None:
        embeddings = model.encode(texts, show_progress_bar=False, convert_to_numpy=True)
        return embeddings.astype(np.float32)

    # Lightweight TF-IDF fallback embedding
    vocab: dict[str, int] = {}
    docs_tokens = [_tokenize(t) for t in texts]
    for tokens in docs_tokens:
        for w in tokens:
            if w not in vocab:
                vocab[w] = len(vocab)

    num_docs = max(1, len(texts))
    dim = max(1, len(vocab))
    matrix = np.zeros((num_docs, dim), dtype=np.float32)

    for i, tokens in enumerate(docs_tokens):
        if not tokens:
            continue
        counts: dict[str, int] = {}
        for w in tokens:
            counts[w] = counts.get(w, 0) + 1
        for w, c in counts.items():
            col = vocab.get(w)
            if col is not None:
                matrix[i, col] = float(c) / len(tokens)

    # L2 normalize
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return matrix / norms


class ProjectVectorStore:
    """
    Isolated vector index for a single project.
    Stores embeddings alongside chunk metadata so retrieval returns full context.
    """

    def __init__(self, project_id: int):
        self.project_id = project_id
        self.index_dir = Path(Config.FAISS_INDEX_DIR) / f"project_{project_id}"
        self.index_dir.mkdir(parents=True, exist_ok=True)
        self.index_path = self.index_dir / "index.faiss"
        self.vectors_path = self.index_dir / "vectors.npy"
        self.meta_path = self.index_dir / "chunks.pkl"
        self._index: Optional[object] = None
        self._vectors: Optional[np.ndarray] = None
        self._chunks: list[dict] = []  # serialisable chunk dicts

    @property
    def index_base_path(self) -> str:
        return str(self.index_dir)

    def build(self, chunks: list[ParsedChunk]) -> None:
        """Embed chunks and build/overwrite the index."""
        if not chunks:
            raise ValueError("No chunks provided to build index.")

        texts = [c.text for c in chunks]
        logger.info("Embedding %d chunks for project %d …", len(texts), self.project_id)
        embeddings = _embed(texts)
        dim = embeddings.shape[1]

        self._chunks = [c.to_dict() for c in chunks]

        if HAS_FAISS and faiss is not None:
            self._index = faiss.IndexFlatL2(dim)
            self._index.add(embeddings)
            faiss.write_index(self._index, str(self.index_path))
        else:
            self._vectors = embeddings
            np.save(str(self.vectors_path), embeddings)

        with open(self.meta_path, "wb") as f:
            pickle.dump(self._chunks, f)

        logger.info("Index built for project %d: %d chunks, dim=%d", self.project_id, len(self._chunks), dim)

    def load(self) -> bool:
        """Load an existing index from disk. Returns True on success."""
        if not self.meta_path.exists():
            return False

        try:
            with open(self.meta_path, "rb") as f:
                self._chunks = pickle.load(f)

            if HAS_FAISS and faiss is not None and self.index_path.exists():
                self._index = faiss.read_index(str(self.index_path))
                return True
            elif self.vectors_path.exists():
                self._vectors = np.load(str(self.vectors_path))
                return True
            return len(self._chunks) > 0
        except Exception as exc:
            logger.error("Failed to load index for project %d: %s", self.project_id, exc)
            return False

    def retrieve(self, query: str, top_k: int = 5) -> list[dict]:
        """
        Retrieve the top-k most relevant chunks for a query.
        """
        if not self._chunks:
            if not self.load():
                return []

        if not self._chunks:
            return []

        if HAS_FAISS and faiss is not None and self._index is not None:
            query_vec = _embed([query])
            distances, indices = self._index.search(query_vec, min(top_k, self._index.ntotal))
            results = []
            for dist, idx in zip(distances[0], indices[0]):
                if idx < 0:
                    continue
                chunk = dict(self._chunks[idx])
                chunk["relevance_score"] = float(1 / (1 + dist))
                results.append(chunk)
            return results

        # Built-in similarity retrieval
        q_tokens = set(_tokenize(query))
        scored_chunks = []

        for idx, chunk in enumerate(self._chunks):
            text = chunk.get("text", "")
            c_tokens = _tokenize(text)
            if not c_tokens:
                continue

            # Token overlap & density score
            overlap = sum(1 for t in c_tokens if t in q_tokens)
            score = (overlap / (math.sqrt(len(c_tokens)) + 1e-5)) if overlap else 0.0

            # Boost if query words appear in section title
            if chunk.get("section"):
                sec_tokens = set(_tokenize(chunk["section"]))
                if sec_tokens & q_tokens:
                    score += 0.5

            scored_chunks.append((score, idx))

        scored_chunks.sort(key=lambda x: x[0], reverse=True)
        results = []
        for score, idx in scored_chunks[:top_k]:
            c = dict(self._chunks[idx])
            c["relevance_score"] = float(score)
            results.append(c)

        # If zero matches found by token overlap, return the first chunks as baseline context
        if not results and self._chunks:
            return [dict(c) for c in self._chunks[:top_k]]

        return results

    def delete(self) -> None:
        """Remove all index files for this project."""
        import shutil
        if self.index_dir.exists():
            shutil.rmtree(self.index_dir)
            logger.info("Deleted index dir for project %d", self.project_id)

    @property
    def vector_count(self) -> int:
        if self._chunks:
            return len(self._chunks)
        if self.meta_path.exists():
            self.load()
            return len(self._chunks)
        return 0
