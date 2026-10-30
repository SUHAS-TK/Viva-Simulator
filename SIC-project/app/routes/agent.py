"""
Arc Reactor AI Agent routes: interactive assistant for student doubts and viva coaching.
"""
from __future__ import annotations

import logging
from flask import Blueprint, jsonify, request

from app.llm.examiner import agent_chat
from app.models.database import Project, SessionLocal, VivaSession
from app.rag.vector_store import ProjectVectorStore
from config import Config

logger = logging.getLogger(__name__)

agent_bp = Blueprint("agent", __name__, url_prefix="/api/agent")


@agent_bp.route("/chat", methods=["POST"])
def chat_with_agent():
    """
    Chat endpoint for the Arc Reactor AI Agent.
    Accepts: { "message": "...", "project_id": 1, "session_id": 2, "history": [...] }
    """
    data = request.get_json(force=True, silent=True) or {}
    message = (data.get("message") or "").strip()
    project_id = data.get("project_id")
    session_id = data.get("session_id")
    history = data.get("history") or []

    if not message:
        return jsonify({"error": "Message is required."}), 400

    db = SessionLocal()
    project_title = ""
    evidence_chunks = []

    try:
        if not project_id and session_id:
            session = db.get(VivaSession, session_id)
            if session:
                project_id = session.project_id

        if project_id:
            project = db.get(Project, project_id)
            if project:
                project_title = project.title
                try:
                    store = ProjectVectorStore(project_id)
                    evidence_chunks = store.retrieve(message, top_k=4)
                except Exception as exc:
                    logger.warning("Could not retrieve RAG chunks for project %d: %s", project_id, exc)
    finally:
        db.close()

    result = agent_chat(
        user_message=message,
        project_title=project_title,
        evidence_chunks=evidence_chunks,
        chat_history=history,
    )

    return jsonify({
        "response": result["response"],
        "sources": result["sources"],
        "agent_name": Config.AGENT_NAME,
        "project_title": project_title,
    })
