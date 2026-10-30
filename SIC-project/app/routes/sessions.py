"""
Viva session routes: create, question flow, answer submission, feedback, report, email.
"""
from __future__ import annotations

import html
import logging
import re
import smtplib
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from flask import Blueprint, jsonify, request

from app.llm.examiner import evaluate_answer, generate_final_report, generate_question
from app.models.database import Project, Question, SessionLocal, VivaSession
from app.rag.vector_store import ProjectVectorStore
from config import Config

logger = logging.getLogger(__name__)

sessions_bp = Blueprint("sessions", __name__, url_prefix="/api/sessions")


def _get_rubric_weights() -> dict:
    return {
        "technical_correctness": Config.WEIGHT_TECHNICAL_CORRECTNESS,
        "depth_of_reasoning": Config.WEIGHT_DEPTH_OF_REASONING,
        "project_specific": Config.WEIGHT_PROJECT_SPECIFIC,
        "completeness": Config.WEIGHT_COMPLETENESS,
    }


def _retrieve_context(project_id: int, query: str, top_k: int = 5) -> list[dict]:
    store = ProjectVectorStore(project_id)
    return store.retrieve(query, top_k=top_k)


def _build_report_email_html(project_title: str, report: dict, session_dict: dict, questions: list[dict]) -> str:
    """Construct an elegant, responsive HTML email for the viva report."""
    score = report.get("overall_score", session_dict.get("overall_score", 0))
    grade = report.get("grade", "B")
    exec_summary = report.get("executive_summary", "Viva Voce examination completed.")
    strong_areas = report.get("strong_areas", [])
    weak_areas = report.get("weak_areas", [])
    revision_topics = report.get("revision_topics", [])
    practice_qs = report.get("practice_questions", [])
    comments = report.get("examiner_comments", "Good effort throughout the session.")

    def render_list(items: list) -> str:
        if not items:
            return "<li style='color:#8892a4;'>None noted.</li>"
        return "".join(f"<li style='margin-bottom:6px;'>{html.escape(str(item))}</li>" for item in items)

    practice_html = ""
    for pq in practice_qs[:4]:
        if isinstance(pq, dict):
            q_text = html.escape(pq.get("question", ""))
            q_diff = html.escape(pq.get("difficulty", "medium"))
            practice_html += f"<div style='background:#1a1e2a;border-left:3px solid #00e5ff;padding:10px;margin-bottom:8px;border-radius:4px;'><strong>[{q_diff.upper()}]</strong> {q_text}</div>"
        else:
            practice_html += f"<div style='background:#1a1e2a;border-left:3px solid #00e5ff;padding:10px;margin-bottom:8px;border-radius:4px;'>{html.escape(str(pq))}</div>"

    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Viva Voce Performance Report</title>
</head>
<body style="margin:0;padding:20px;background:#0d0f14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e8eaf0;">
  <div style="max-width:640px;margin:0 auto;background:#13161e;border-radius:12px;border:1px solid #2a2e3d;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.5);">
    
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#0a192f,#1e293b);padding:28px 24px;border-bottom:1px solid #2a2e3d;text-align:center;">
      <div style="display:inline-block;width:44px;height:44px;border-radius:50%;background:#00e5ff15;border:2px solid #00e5ff;line-height:44px;font-size:22px;margin-bottom:10px;">🎓</div>
      <h1 style="margin:0;font-size:22px;color:#ffffff;letter-spacing:-0.5px;">AI Viva Simulator</h1>
      <p style="margin:6px 0 0;font-size:14px;color:#8892a4;">Official Performance Assessment · {html.escape(project_title)}</p>
    </div>

    <!-- Score Block -->
    <div style="padding:24px;text-align:center;background:#1a1e2a;border-bottom:1px solid #2a2e3d;">
      <div style="display:inline-block;padding:16px 28px;background:#0f1117;border-radius:12px;border:1px solid #38bdf844;">
        <div style="font-size:42px;font-weight:800;color:#00e5ff;line-height:1;">{score}</div>
        <div style="font-size:12px;text-transform:uppercase;color:#8892a4;letter-spacing:1px;margin-top:4px;">Overall Score / 100</div>
      </div>
      <div style="margin-top:12px;">
        <span style="display:inline-block;padding:4px 14px;border-radius:20px;background:#38bdf820;color:#38bdf8;font-weight:700;font-size:14px;border:1px solid #38bdf855;">Grade: {html.escape(grade)}</span>
        <span style="display:inline-block;margin-left:10px;padding:4px 14px;border-radius:20px;background:#2a2e3d;color:#e8eaf0;font-size:13px;">{len(questions)} Questions Evaluated</span>
      </div>
      <p style="margin:16px 0 0;font-size:14px;color:#cbd5e1;line-height:1.6;text-align:left;background:#13161e;padding:14px;border-radius:8px;border:1px solid #2a2e3d;">{html.escape(exec_summary)}</p>
    </div>

    <!-- Strengths & Weaknesses -->
    <div style="padding:24px;border-bottom:1px solid #2a2e3d;">
      <h3 style="margin:0 0 10px;color:#3dd68c;font-size:16px;">💪 Key Strengths</h3>
      <ul style="margin:0 0 20px 20px;padding:0;color:#cbd5e1;font-size:14px;line-height:1.6;">
        {render_list(strong_areas)}
      </ul>

      <h3 style="margin:0 0 10px;color:#f59e0b;font-size:16px;">⚠️ Areas for Improvement</h3>
      <ul style="margin:0 0 0 20px;padding:0;color:#cbd5e1;font-size:14px;line-height:1.6;">
        {render_list(weak_areas)}
      </ul>
    </div>

    <!-- Recommended Revision -->
    <div style="padding:24px;border-bottom:1px solid #2a2e3d;">
      <h3 style="margin:0 0 10px;color:#38bdf8;font-size:16px;">📖 Recommended Revision Topics</h3>
      <ul style="margin:0 0 0 20px;padding:0;color:#cbd5e1;font-size:14px;line-height:1.6;">
        {render_list(revision_topics)}
      </ul>
    </div>

    <!-- Practice Questions -->
    {f'''<div style="padding:24px;border-bottom:1px solid #2a2e3d;">
      <h3 style="margin:0 0 12px;color:#a855f7;font-size:16px;">🧪 Practice Viva Questions</h3>
      {practice_html}
    </div>''' if practice_html else ''}

    <!-- Examiner Comments -->
    <div style="padding:24px;background:#0f1117;">
      <h3 style="margin:0 0 8px;color:#ffffff;font-size:15px;">🎓 Examiner's Final Remarks</h3>
      <p style="margin:0;font-size:13px;color:#8892a4;line-height:1.6;font-style:italic;">"{html.escape(comments)}"</p>
    </div>

    <!-- Footer -->
    <div style="padding:16px 24px;background:#0a0c12;text-align:center;font-size:12px;color:#555e70;border-top:1px solid #1a1e2a;">
      Generated by AI Viva Simulator with RAG & Groq Intelligence. Keep practicing to master your defense!
    </div>
  </div>
</body>
</html>"""


@sessions_bp.route("", methods=["POST"])
def create_session():
    """Start a new viva session for a project."""
    data = request.get_json(force=True, silent=True) or {}
    project_id = data.get("project_id")
    difficulty = data.get("difficulty", "medium")
    total_questions = min(max(int(data.get("total_questions", 10)), 1), 50)
    voice_mode = bool(data.get("voice_mode", False))

    if not project_id:
        return jsonify({"error": "project_id is required."}), 400

    if difficulty not in ("easy", "medium", "hard"):
        difficulty = "medium"

    db = SessionLocal()
    try:
        project = db.get(Project, project_id)
        if not project:
            return jsonify({"error": "Project not found."}), 404
        if project.processing_status != "ready":
            return jsonify({
                "error": f"Project is not ready (status: {project.processing_status}). "
                         "Please wait for processing to complete."
            }), 400

        session = VivaSession(
            project_id=project_id,
            difficulty=difficulty,
            total_questions=total_questions,
            voice_mode=voice_mode,
            status="active",
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        return jsonify({"session": session.to_dict()}), 201
    finally:
        db.close()


@sessions_bp.route("/<int:session_id>", methods=["GET"])
def get_session(session_id: int):
    db = SessionLocal()
    try:
        session = db.get(VivaSession, session_id)
        if not session:
            return jsonify({"error": "Session not found."}), 404
        return jsonify({"session": session.to_dict()})
    finally:
        db.close()


@sessions_bp.route("/<int:session_id>/question", methods=["GET"])
def get_current_question(session_id: int):
    """
    Get the current question. If none exists yet (or the last was answered),
    generate a new one and persist it.
    """
    db = SessionLocal()
    try:
        session = db.get(VivaSession, session_id)
        if not session:
            return jsonify({"error": "Session not found."}), 404

        if session.status != "active":
            return jsonify({"error": "Session is not active.", "status": session.status}), 400

        # Check if exam is complete
        answered_count = sum(1 for q in session.questions if q.student_answer)
        if answered_count >= session.total_questions:
            session.status = "completed"
            session.completed_at = datetime.now(timezone.utc)
            db.commit()
            return jsonify({
                "exam_complete": True,
                "session_id": session_id,
                "message": "All questions answered. Retrieve the final report.",
            })

        # Return existing unanswered question
        unanswered = [q for q in session.questions if not q.student_answer]
        if unanswered:
            return jsonify({"question": unanswered[0].to_dict(), "exam_complete": False})

        # Generate new question
        project = db.get(Project, session.project_id)
        if not project:
            return jsonify({"error": "Project not found."}), 404

        history = [q.to_dict() for q in session.questions]
        topics_covered = session.topics_covered_list
        misconceptions = session.misconceptions_list

        # Determine adaptive difficulty
        recent_scores = [q.score for q in session.questions[-3:] if q.score is not None]
        current_difficulty = session.difficulty
        if recent_scores:
            avg_recent = sum(recent_scores) / len(recent_scores)
            if avg_recent >= 80 and current_difficulty != "hard":
                current_difficulty = "hard"
            elif avg_recent <= 40 and current_difficulty != "easy":
                current_difficulty = "easy"

        # Retrieve context for question generation
        context_query = f"Project overview: {project.title} architecture technologies implementation"
        evidence = _retrieve_context(project.id, context_query, top_k=6)

        try:
            q_data = generate_question(
                project_title=project.title,
                evidence_chunks=evidence,
                session_history=history,
                difficulty=current_difficulty,
                topics_covered=topics_covered,
                misconceptions=misconceptions,
                rubric_weights=_get_rubric_weights(),
            )
        except Exception as exc:
            logger.error("Question generation failed: %s", exc)
            error_msg = str(exc)
            if "api_key" in error_msg.lower() or "authentication" in error_msg.lower():
                return jsonify({"error": "AI service unavailable – check GROQ_API_KEY."}), 503
            return jsonify({"error": f"Failed to generate question: {exc}"}), 503

        # Persist question
        question = Question(
            session_id=session_id,
            question_index=len(session.questions),
            question_text=q_data.get("question_text", ""),
            topic=q_data.get("topic", "General"),
            difficulty=q_data.get("difficulty", current_difficulty),
            expected_concepts=str(q_data.get("expected_concepts", [])),
        )
        question.feedback = {"evidence_refs": q_data.get("evidence_refs", [])}
        db.add(question)

        # Track topic
        new_topics = topics_covered + [q_data.get("topic", "")]
        session.topics_covered_list = new_topics
        db.commit()
        db.refresh(question)

        return jsonify({"question": question.to_dict(), "exam_complete": False})
    finally:
        db.close()


@sessions_bp.route("/<int:session_id>/answer", methods=["POST"])
def submit_answer(session_id: int):
    """Submit a text answer for the current question."""
    data = request.get_json(force=True, silent=True) or {}
    question_id = data.get("question_id")
    student_answer = (data.get("answer") or "").strip()

    if not question_id:
        return jsonify({"error": "question_id is required."}), 400

    db = SessionLocal()
    try:
        session = db.get(VivaSession, session_id)
        if not session or session.status != "active":
            return jsonify({"error": "Session not found or not active."}), 400

        question = db.get(Question, question_id)
        if not question or question.session_id != session_id:
            return jsonify({"error": "Question not found in this session."}), 404

        if question.student_answer:
            return jsonify({"error": "Question already answered."}), 400

        project = db.get(Project, session.project_id)
        if not project:
            return jsonify({"error": "Project not found."}), 404

        # Retrieve relevant context for evaluation
        evidence = _retrieve_context(
            project.id,
            query=f"{question.question_text} {student_answer}",
            top_k=5,
        )

        import ast
        try:
            expected = ast.literal_eval(question.expected_concepts) if question.expected_concepts else []
        except Exception:
            expected = []

        try:
            feedback = evaluate_answer(
                question_text=question.question_text,
                student_answer=student_answer,
                expected_concepts=expected,
                evidence_chunks=evidence,
                project_title=project.title,
                difficulty=question.difficulty,
                rubric_weights=_get_rubric_weights(),
            )
        except Exception as exc:
            logger.error("Answer evaluation failed: %s", exc)
            error_msg = str(exc)
            if "api_key" in error_msg.lower() or "authentication" in error_msg.lower():
                return jsonify({"error": "AI service unavailable – check GROQ_API_KEY."}), 503
            return jsonify({"error": f"Evaluation failed: {exc}"}), 503

        # Update question record
        question.student_answer = student_answer
        question.score = feedback.get("score", 0)
        question.correctness = feedback.get("correctness", "")
        question.feedback = feedback
        question.answered_at = datetime.now(timezone.utc)

        # Track misconceptions
        if feedback.get("misconceptions"):
            existing = session.misconceptions_list
            for m in feedback["misconceptions"]:
                if m and len(m) > 5:
                    existing.append({"topic": question.topic, "misconception": m})
            session.misconceptions_list = existing[-20:]  # keep last 20

        # Recalculate overall score
        answered = [q for q in session.questions if q.score is not None]
        if answered:
            session.overall_score = sum(q.score for q in answered) / len(answered)

        db.commit()

        return jsonify({
            "feedback": feedback,
            "question_index": question.question_index,
            "score": question.score,
            "session_score": round(session.overall_score, 1),
            "questions_answered": len(answered),
            "total_questions": session.total_questions,
        })
    finally:
        db.close()


@sessions_bp.route("/<int:session_id>/history", methods=["GET"])
def get_history(session_id: int):
    """Get all question/answer history for a session."""
    db = SessionLocal()
    try:
        session = db.get(VivaSession, session_id)
        if not session:
            return jsonify({"error": "Session not found."}), 404
        questions = [q.to_dict() for q in session.questions]
        return jsonify({
            "session": session.to_dict(),
            "questions": questions,
        })
    finally:
        db.close()


@sessions_bp.route("/<int:session_id>/report", methods=["GET"])
def get_report(session_id: int):
    """Generate and return the final performance report."""
    db = SessionLocal()
    try:
        session = db.get(VivaSession, session_id)
        if not session:
            return jsonify({"error": "Session not found."}), 404

        project = db.get(Project, session.project_id)
        if not project:
            return jsonify({"error": "Project not found."}), 404

        answered_questions = [q.to_dict() for q in session.questions if q.student_answer]

        if not answered_questions:
            return jsonify({"error": "No questions have been answered yet."}), 400

        # Mark session complete if not already
        if session.status == "active":
            session.status = "completed"
            session.completed_at = datetime.now(timezone.utc)
            db.commit()

        try:
            report = generate_final_report(
                project_title=project.title,
                session_data=session.to_dict(),
                questions=answered_questions,
            )
        except Exception as exc:
            logger.error("Report generation failed: %s", exc)
            report = {
                "overall_score": round(session.overall_score, 1),
                "error": f"Full report generation failed: {exc}",
            }

        return jsonify({
            "report": report,
            "session": session.to_dict(),
            "questions": answered_questions,
        })
    finally:
        db.close()


_LAST_SENT_EMAILS: dict[int, dict] = {}


@sessions_bp.route("/<int:session_id>/email-report", methods=["POST"])
def email_report(session_id: int):
    """
    Email the complete viva performance report to any user-specified email address(es).
    Supports single or multiple recipients (comma-separated), and real SMTP or preview delivery.
    """
    data = request.get_json(force=True, silent=True) or {}
    raw_email = (data.get("email") or "").strip().lower()

    if not raw_email:
        return jsonify({"error": "Email address is required."}), 400

    # Parse comma or semicolon separated recipients
    raw_list = [e.strip() for e in re.split(r"[,;]+", raw_email) if e.strip()]
    if not raw_list:
        return jsonify({"error": "No valid email addresses provided."}), 400

    email_regex = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
    for e in raw_list:
        if not re.match(email_regex, e):
            return jsonify({"error": f"Invalid email format: '{e}'. Please check spelling."}), 400

    recipients_str = ", ".join(raw_list)

    db = SessionLocal()
    try:
        session = db.get(VivaSession, session_id)
        if not session:
            return jsonify({"error": "Session not found."}), 404

        project = db.get(Project, session.project_id)
        if not project:
            return jsonify({"error": "Project not found."}), 404

        answered_questions = [q.to_dict() for q in session.questions if q.student_answer]
        if not answered_questions:
            return jsonify({"error": "Cannot send report: no questions have been answered yet."}), 400

        try:
            report = generate_final_report(
                project_title=project.title,
                session_data=session.to_dict(),
                questions=answered_questions,
            )
        except Exception:
            report = {
                "overall_score": round(session.overall_score, 1),
                "grade": "B" if session.overall_score >= 70 else "C",
                "executive_summary": f"Viva examination completed for project '{project.title}'.",
                "strong_areas": [],
                "weak_areas": [],
                "revision_topics": [],
                "practice_questions": [],
                "examiner_comments": "Performance report generated.",
            }

        html_body = _build_report_email_html(project.title, report, session.to_dict(), answered_questions)
        text_body = (
            f"AI Viva Voce Performance Report\n"
            f"Project: {project.title}\n"
            f"Overall Score: {report.get('overall_score', 0)}/100 (Grade: {report.get('grade', 'B')})\n\n"
            f"Summary:\n{report.get('executive_summary', '')}\n\n"
            f"Examiner Comments:\n{report.get('examiner_comments', '')}\n"
        )

        # Store in cache so user can view/preview anytime
        _LAST_SENT_EMAILS[session_id] = {
            "email": recipients_str,
            "project_title": project.title,
            "html": html_body,
            "text": text_body,
            "score": report.get("overall_score"),
            "grade": report.get("grade"),
            "sent_at": datetime.now(timezone.utc).isoformat(),
        }

        dispatched = False
        status_note = ""

        if Config.SMTP_SERVER and Config.SMTP_USER:
            try:
                msg = MIMEMultipart("alternative")
                msg["Subject"] = f"Viva Voce Report: {project.title} (Score: {report.get('overall_score', 0)}/100)"
                msg["From"] = Config.SMTP_FROM_EMAIL
                msg["To"] = recipients_str
                msg.attach(MIMEText(text_body, "plain"))
                msg.attach(MIMEText(html_body, "html"))

                if Config.SMTP_PORT == 465:
                    with smtplib.SMTP_SSL(Config.SMTP_SERVER, Config.SMTP_PORT, timeout=12) as server:
                        if Config.SMTP_PASSWORD:
                            server.login(Config.SMTP_USER, Config.SMTP_PASSWORD)
                        server.sendmail(Config.SMTP_FROM_EMAIL, raw_list, msg.as_string())
                else:
                    with smtplib.SMTP(Config.SMTP_SERVER, Config.SMTP_PORT, timeout=12) as server:
                        server.starttls()
                        if Config.SMTP_PASSWORD:
                            server.login(Config.SMTP_USER, Config.SMTP_PASSWORD)
                        server.sendmail(Config.SMTP_FROM_EMAIL, raw_list, msg.as_string())

                dispatched = True
                status_note = "Email delivered directly via SMTP."
            except Exception as mail_err:
                logger.warning("SMTP email dispatch failed: %s", mail_err)
                status_note = f"Report prepared in Preview Mode (SMTP relay error: {mail_err})."
        else:
            status_note = "Report generated in Preview Mode (configure SMTP in .env for external inbox delivery)."

        return jsonify({
            "success": True,
            "message": f"Viva report generated for {recipients_str}! {status_note}",
            "email": recipients_str,
            "recipients": raw_list,
            "score": report.get("overall_score"),
            "grade": report.get("grade"),
            "dispatched": dispatched,
            "preview_mode": not dispatched,
            "preview_url": f"/api/sessions/{session_id}/email-preview",
            "download_url": f"/api/sessions/{session_id}/email-download",
        })
    finally:
        db.close()


@sessions_bp.route("/<int:session_id>/email-preview", methods=["GET"])
def preview_email(session_id: int):
    """View the HTML email that was generated and dispatched."""
    record = _LAST_SENT_EMAILS.get(session_id)
    if not record:
        # Generate on the fly if not cached
        db = SessionLocal()
        try:
            session = db.get(VivaSession, session_id)
            if not session:
                return "Session not found.", 404
            project = db.get(Project, session.project_id)
            if not project:
                return "Project not found.", 404
            answered = [q.to_dict() for q in session.questions if q.student_answer]
            report = generate_final_report(project.title, session.to_dict(), answered)
            html_body = _build_report_email_html(project.title, report, session.to_dict(), answered)
            return html_body, 200, {"Content-Type": "text/html; charset=utf-8"}
        finally:
            db.close()
    return record["html"], 200, {"Content-Type": "text/html; charset=utf-8"}


@sessions_bp.route("/<int:session_id>/email-download", methods=["GET"])
def download_email(session_id: int):
    """Download the HTML email report as an .html file."""
    record = _LAST_SENT_EMAILS.get(session_id)
    content = record["html"] if record else "<h3>No email record found.</h3>"
    from flask import Response
    return Response(
        content,
        mimetype="text/html",
        headers={"Content-Disposition": f"attachment; filename=viva_report_email_{session_id}.html"},
    )


@sessions_bp.route("/<int:session_id>", methods=["DELETE"])
def delete_session(session_id: int):
    db = SessionLocal()
    try:
        session = db.get(VivaSession, session_id)
        if not session:
            return jsonify({"error": "Session not found."}), 404
        db.delete(session)
        db.commit()
        return jsonify({"message": "Session deleted."})
    finally:
        db.close()
