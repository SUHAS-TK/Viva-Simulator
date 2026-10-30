/* ═══════════════════════════════════════════════════════
   report.js – Final performance report page
   Handles: report loading, rendering, Save (PDF/HTML/Copy),
   Voice Email dictation, and Email delivery.
   ═══════════════════════════════════════════════════════ */
"use strict";

const SESSION_ID = window.SESSION_ID;
let currentReportData = null;
let isRecordingEmail = false;
let emailMediaRecorder = null;
let emailAudioChunks = [];

function toast(msg, type = "info", duration = 4500) {
  const icons = { success: "✅", error: "❌", info: "ℹ️", warn: "⚠️" };
  const container = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]||"ℹ️"}</span><span class="toast-msg">${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

function escapeHtml(str) {
  return String(str||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function makeList(container, items, emptyMsg) {
  if (!items || !items.length) {
    container.innerHTML = `<li style="color:var(--text-muted);font-size:0.9rem">${emptyMsg}</li>`;
    return;
  }
  container.innerHTML = items.map(i => `<li>${escapeHtml(i)}</li>`).join("");
}

async function loadReport() {
  try {
    const res = await fetch(`/api/sessions/${SESSION_ID}/report`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load report.");
    currentReportData = data;
    if (data.session && data.session.project_id) {
      window.CURRENT_PROJECT_ID = data.session.project_id;
    }
    renderReport(data);
  } catch (err) {
    toast(err.message, "error");
    document.getElementById("bigScore").textContent = "Error";
    document.getElementById("execSummary").textContent = err.message;
  }
}

function renderReport(data) {
  const report = data.report || {};
  const session = data.session || {};
  const questions = data.questions || [];

  // Hero
  const score = report.overall_score || session.overall_score || 0;
  document.getElementById("bigScore").textContent = `${Math.round(score)}`;
  document.getElementById("gradeBadge").textContent = report.grade || gradeFromScore(score);
  document.getElementById("reportTitle").textContent = `Performance Report`;
  document.getElementById("execSummary").textContent = report.executive_summary || "";

  // Stats
  const correct = questions.filter(q => q.correctness === "correct").length;
  const partial = questions.filter(q => q.correctness === "partial").length;
  const incorrect = questions.filter(q => q.correctness === "incorrect").length;
  document.getElementById("reportQuestions").textContent = questions.length;
  document.getElementById("reportCorrect").textContent = correct;
  document.getElementById("reportPartial").textContent = partial;
  document.getElementById("reportIncorrect").textContent = incorrect;

  // Topic performance
  const topicContainer = document.getElementById("topicPerformance");
  const topics = report.topic_performance || [];
  if (topics.length) {
    topicContainer.innerHTML = topics.map(t => {
      const sc = Math.round(t.score || 0);
      const cls = t.assessment === "strong" ? "strong" : t.assessment === "adequate" ? "adequate" : "weak";
      return `<div class="topic-row">
        <div class="topic-label">
          <span class="topic-name">${escapeHtml(t.topic)}</span>
          <span class="topic-score">${sc}/100</span>
        </div>
        <div class="topic-bar"><div class="topic-bar-fill ${cls}" style="width:${sc}%"></div></div>
      </div>`;
    }).join("");
  } else {
    // Build from questions if LLM didn't return topics
    const topicMap = {};
    questions.forEach(q => {
      if (!topicMap[q.topic]) topicMap[q.topic] = [];
      topicMap[q.topic].push(q.score || 0);
    });
    topicContainer.innerHTML = Object.entries(topicMap).map(([topic, scores]) => {
      const avg = scores.reduce((a,b)=>a+b,0)/scores.length;
      const cls = avg >= 70 ? "strong" : avg >= 40 ? "adequate" : "weak";
      return `<div class="topic-row">
        <div class="topic-label">
          <span class="topic-name">${escapeHtml(topic)}</span>
          <span class="topic-score">${Math.round(avg)}/100</span>
        </div>
        <div class="topic-bar"><div class="topic-bar-fill ${cls}" style="width:${Math.round(avg)}%"></div></div>
      </div>`;
    }).join("") || "<p style='color:var(--text-muted)'>No topic data available.</p>";
  }

  // Lists
  makeList(document.getElementById("strongAreas"), report.strong_areas, "No specific strengths identified.");
  makeList(document.getElementById("weakAreas"), report.weak_areas, "No specific weaknesses identified.");
  makeList(document.getElementById("misconceptions"), report.repeated_misconceptions, "No repeated misconceptions.");
  makeList(document.getElementById("revisionTopics"), report.revision_topics, "No specific revision topics.");

  // Practice questions
  const pq = document.getElementById("practiceQuestions");
  const practiceQs = report.practice_questions || [];
  if (practiceQs.length) {
    pq.innerHTML = practiceQs.map(q => `
      <div class="practice-q">
        <div class="practice-q-text">${escapeHtml(q.question || q)}</div>
        ${q.difficulty ? `<div class="practice-q-meta">Difficulty: ${escapeHtml(q.difficulty)} · ${escapeHtml(q.reason || "")}</div>` : ""}
      </div>`).join("");
  } else {
    pq.innerHTML = "<p style='color:var(--text-muted);font-size:0.9rem'>No practice questions available.</p>";
  }

  // Examiner comments
  document.getElementById("examinerComment").textContent = report.examiner_comments || "No examiner comments.";

  // Question review
  const reviewContainer = document.getElementById("questionReview");
  if (questions.length) {
    reviewContainer.innerHTML = questions.map((q, i) => {
      const sc = q.score || 0;
      const scoreColor = sc >= 70 ? "var(--success)" : sc >= 40 ? "var(--warn)" : "var(--error)";
      const fb = q.feedback || {};
      return `<div class="review-item">
        <div class="review-item-header">
          <span class="review-q-num">Q${i+1}</span>
          <span class="review-q-topic">${escapeHtml(q.topic || "")}</span>
          <span class="badge badge-${q.difficulty||'medium'}">${q.difficulty||'medium'}</span>
          <span class="review-q-score" style="color:${scoreColor}">${sc}/100</span>
        </div>
        <div class="review-q-text">${escapeHtml(q.question_text)}</div>
        ${q.student_answer ? `<div class="review-a-text"><strong>Your answer:</strong> ${escapeHtml(q.student_answer.slice(0,300))}${q.student_answer.length > 300 ? "…" : ""}</div>` : ""}
        ${fb.correct_reasoning ? `<div class="review-a-text" style="border-left:3px solid var(--accent)"><strong>Correct reasoning:</strong> ${escapeHtml(fb.correct_reasoning.slice(0,250))}…</div>` : ""}
      </div>`;
    }).join("");
  } else {
    reviewContainer.innerHTML = "<p style='color:var(--text-muted)'>No questions to review.</p>";
  }
}

function gradeFromScore(score) {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  if (score >= 50) return "D";
  return "F";
}

// ── Save Options: Print / PDF, HTML Export, Copy Summary ───
document.getElementById("printReportBtn").addEventListener("click", () => {
  window.print();
});

document.getElementById("downloadHtmlBtn").addEventListener("click", () => {
  if (!currentReportData) {
    toast("Report data not loaded yet.", "warn");
    return;
  }
  const report = currentReportData.report || {};
  const score = report.overall_score || 0;
  const grade = report.grade || gradeFromScore(score);

  const standaloneHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Viva Voce Performance Report - ${score}/100</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d0f14; color: #e8eaf0; padding: 2rem; }
    .card { background: #13161e; border: 1px solid #2a2e3d; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; max-width: 800px; margin-left: auto; margin-right: auto; }
    .score-badge { font-size: 3rem; font-weight: 800; color: #00e5ff; }
    .grade { display: inline-block; padding: 4px 12px; border-radius: 20px; background: rgba(56, 189, 248, 0.2); color: #38bdf8; font-weight: 700; }
    h2, h3 { color: #fff; margin-top: 0; }
    ul { padding-left: 1.5rem; line-height: 1.7; }
    .comment { font-style: italic; color: #8892a4; }
  </style>
</head>
<body>
  <div class="card">
    <h2>🎓 Viva Voce Official Performance Report</h2>
    <div style="display:flex;align-items:center;gap:1.5rem;margin:1rem 0;">
      <div class="score-badge">${score}/100</div>
      <div>
        <div class="grade">Grade: ${grade}</div>
        <p style="margin:0.5rem 0 0;color:#cbd5e1;">${report.executive_summary || ""}</p>
      </div>
    </div>
    <hr style="border:none;border-top:1px solid #2a2e3d;margin:1.5rem 0;" />
    <h3>💪 Strengths</h3>
    <ul>${(report.strong_areas || []).map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
    <h3>⚠️ Areas for Improvement</h3>
    <ul>${(report.weak_areas || []).map(w => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
    <h3>📖 Recommended Revision</h3>
    <ul>${(report.revision_topics || []).map(r => `<li>${escapeHtml(r)}</li>`).join("")}</ul>
    <h3>🎓 Examiner's Comments</h3>
    <p class="comment">"${escapeHtml(report.examiner_comments || "")}"</p>
  </div>
</body>
</html>`;

  const blob = new Blob([standaloneHtml], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `viva_report_session_${SESSION_ID}.html`;
  a.click();
  URL.revokeObjectURL(url);
  toast("HTML Report downloaded successfully!", "success");
});

document.getElementById("copySummaryBtn").addEventListener("click", () => {
  if (!currentReportData) return;
  const report = currentReportData.report || {};
  const score = report.overall_score || 0;
  const grade = report.grade || gradeFromScore(score);

  const textSummary = `AI Viva Voce Performance Report
Session ID: #${SESSION_ID}
Score: ${score}/100 (Grade: ${grade})

Executive Summary:
${report.executive_summary || "Completed"}

Examiner Remarks:
${report.examiner_comments || "None"}
`;

  navigator.clipboard.writeText(textSummary).then(() => {
    toast("Performance summary copied to clipboard!", "success");
  }).catch(() => {
    toast("Could not copy to clipboard.", "error");
  });
});

// ── Voice Dictation for Email ──────────────────────────────
const speakEmailBtn = document.getElementById("speakEmailBtn");
const reportEmailInput = document.getElementById("reportEmailInput");

speakEmailBtn.addEventListener("click", toggleEmailVoiceRecording);

async function toggleEmailVoiceRecording() {
  if (isRecordingEmail) {
    if (emailMediaRecorder && emailMediaRecorder.state !== "inactive") {
      emailMediaRecorder.stop();
    }
    isRecordingEmail = false;
    speakEmailBtn.classList.remove("listening");
    speakEmailBtn.innerHTML = "<span>⏳ Transcribing…</span>";
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    emailAudioChunks = [];
    emailMediaRecorder = new MediaRecorder(stream);

    emailMediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) emailAudioChunks.push(e.data);
    };

    emailMediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      transcribeEmailAudio();
    };

    emailMediaRecorder.start(250);
    isRecordingEmail = true;
    speakEmailBtn.classList.add("listening");
    speakEmailBtn.innerHTML = "<span>⏹ Say your email now…</span>";
    toast("Say your email aloud (e.g. 'john dot doe at gmail dot com')", "info", 5000);

  } catch (err) {
    toast("Microphone access denied: " + err.message, "error");
  }
}

async function transcribeEmailAudio() {
  if (!emailAudioChunks.length) {
    speakEmailBtn.innerHTML = "<span>🎙️ Speak Email</span>";
    return;
  }

  const blob = new Blob(emailAudioChunks, { type: "audio/webm" });
  const formData = new FormData();
  formData.append("audio", blob, "email_dictation.webm");

  try {
    const res = await fetch("/api/speech/transcribe", { method: "POST", body: formData });
    const data = await res.json();
    speakEmailBtn.innerHTML = "<span>🎙️ Speak Email</span>";

    if (data.transcript && data.transcript.trim()) {
      // Smart formatting for spoken email:
      // "alex dot smith at gmail dot com" -> "alex.smith@gmail.com"
      let raw = data.transcript.toLowerCase();
      raw = raw.replace(/\s+at\s+the\s+rate\s+/g, "@");
      raw = raw.replace(/\s+at\s+/g, "@");
      raw = raw.replace(/\s+dot\s+/g, ".");
      raw = raw.replace(/[^a-zA-Z0-9@._-]/g, ""); // clean spaces & punctuation

      if (raw.includes("@") && raw.includes(".")) {
        reportEmailInput.value = raw;
        toast(`Recognized email: ${raw}`, "success");
      } else {
        reportEmailInput.value = raw;
        toast(`Recognized speech: "${raw}". Please verify formatting.`, "info");
      }
      reportEmailInput.focus();
    } else {
      toast("No audible speech detected. Please type or try again.", "warn");
    }
  } catch (err) {
    speakEmailBtn.innerHTML = "<span>🎙️ Speak Email</span>";
    toast("Speech recognition failed: " + err.message, "error");
  }
}

// ── Send Report to Email ───────────────────────────────────
const sendEmailBtn = document.getElementById("sendEmailBtn");
const emailStatusBanner = document.getElementById("emailStatusBanner");
const emailActionsPreview = document.getElementById("emailActionsPreview");
const emailHelperBox = document.getElementById("emailHelperBox");
const viewEmailPreviewBtn = document.getElementById("viewEmailPreviewBtn");
const downloadEmailFileBtn = document.getElementById("downloadEmailFileBtn");
const emailPreviewModal = document.getElementById("emailPreviewModal");
const emailPreviewIframe = document.getElementById("emailPreviewIframe");
const closeEmailPreviewBtn = document.getElementById("closeEmailPreviewBtn");

sendEmailBtn.addEventListener("click", async () => {
  const rawEmailInput = reportEmailInput.value.trim().toLowerCase();
  if (!rawEmailInput) {
    toast("Please enter or dictate an email address first.", "warn");
    reportEmailInput.focus();
    return;
  }

  // Support single or multiple comma/semicolon-separated emails
  const emailList = rawEmailInput.split(/[,;]+/).map(e => e.trim()).filter(Boolean);
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const invalidEmails = emailList.filter(e => !emailRegex.test(e));

  if (!emailList.length || invalidEmails.length > 0) {
    const errorMsg = invalidEmails.length > 0
      ? `Invalid email format: "${invalidEmails[0]}". Please check for errors.`
      : "Please enter a valid email address.";
    toast(errorMsg, "error");
    reportEmailInput.focus();
    return;
  }

  const email = emailList.join(", ");

  document.getElementById("sendEmailBtnText").style.display = "none";
  document.getElementById("sendEmailSpinner").style.display = "inline";
  sendEmailBtn.disabled = true;

  emailStatusBanner.className = "email-status-banner";
  emailStatusBanner.style.display = "none";
  if (emailActionsPreview) emailActionsPreview.style.display = "none";
  if (emailHelperBox) emailHelperBox.style.display = "none";

  try {
    const res = await fetch(`/api/sessions/${SESSION_ID}/email-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Email dispatch failed.");

    emailStatusBanner.className = "email-status-banner success";
    emailStatusBanner.textContent = `✅ ${data.message}`;
    emailStatusBanner.style.display = "block";

    // Show preview and download options
    if (emailActionsPreview) {
      emailActionsPreview.style.display = "flex";
      if (downloadEmailFileBtn) {
        downloadEmailFileBtn.href = data.download_url || `/api/sessions/${SESSION_ID}/email-download`;
      }
    }

    // If preview mode, show the guidance box for Gmail configuration
    if (data.preview_mode && emailHelperBox) {
      emailHelperBox.style.display = "block";
    }

    toast(`Report generated for ${email}!`, "success");

  } catch (err) {
    emailStatusBanner.className = "email-status-banner error";
    emailStatusBanner.textContent = `❌ ${err.message}`;
    emailStatusBanner.style.display = "block";
    toast(err.message, "error");
  } finally {
    document.getElementById("sendEmailBtnText").style.display = "inline";
    document.getElementById("sendEmailSpinner").style.display = "none";
    sendEmailBtn.disabled = false;
  }
});

// View email preview modal
if (viewEmailPreviewBtn) {
  viewEmailPreviewBtn.addEventListener("click", () => {
    if (emailPreviewIframe) {
      emailPreviewIframe.src = `/api/sessions/${SESSION_ID}/email-preview`;
    }
    if (emailPreviewModal) {
      emailPreviewModal.classList.remove("hidden");
    }
  });
}

if (closeEmailPreviewBtn) {
  closeEmailPreviewBtn.addEventListener("click", () => {
    if (emailPreviewModal) {
      emailPreviewModal.classList.add("hidden");
    }
  });
}

// ── Init ───────────────────────────────────────────────────
loadReport();
