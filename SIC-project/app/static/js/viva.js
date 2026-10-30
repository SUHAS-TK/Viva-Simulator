/* ═══════════════════════════════════════════════════════
   viva.js – Examination page logic
   Handles: question flow, text/voice answering, feedback display,
   voice assistant speech synthesis, adaptive difficulty, session sidebar
   ═══════════════════════════════════════════════════════ */
"use strict";

const SESSION_ID = window.SESSION_ID;

// ── Shared utilities ───────────────────────────────────────
function toast(msg, type = "info", duration = 4500) {
  const icons = { success: "✅", error: "❌", info: "ℹ️", warn: "⚠️" };
  const container = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || "ℹ️"}</span>
                  <span class="toast-msg">${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

function escapeHtml(str) {
  return String(str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function nl2br(str) {
  return escapeHtml(str).replace(/\n/g, "<br/>");
}

/**
 * Render a question string with structured formatting.
 *
 * Detects:
 *  - Multi-part questions labelled a) b) c) and renders each on its own block.
 *  - A stem sentence (text before the first a) label) shown as the intro.
 *  - Single-part questions rendered as plain text.
 *
 * @param {string} text - Raw question_text from the API.
 * @returns {string} - Safe HTML string for innerHTML injection.
 */
function renderQuestionHTML(text) {
  if (!text) return "";

  // Normalise line endings
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

  // Split into lines; detect sub-part lines like "a) ...", "b) ...", "c) ..."
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  const subPartPattern = /^([a-c])\)\s+(.+)$/i;

  const stemLines  = [];
  const subParts   = []; // [{label, text}]

  for (const line of lines) {
    const m = line.match(subPartPattern);
    if (m) {
      subParts.push({ label: m[1].toLowerCase(), text: m[2] });
    } else {
      if (subParts.length === 0) {
        stemLines.push(line);
      }
      // Lines after sub-parts started are appended to the last sub-part
      else {
        subParts[subParts.length - 1].text += " " + line;
      }
    }
  }

  // No sub-parts — plain text with soft line-breaks
  if (subParts.length === 0) {
    return `<span class="q-plain">${escapeHtml(raw).replace(/\n/g, "<br/>")}</span>`;
  }

  // Has sub-parts — build structured HTML
  const stemHtml = stemLines.length
    ? `<div class="q-stem">${escapeHtml(stemLines.join(" "))}</div>`
    : "";

  const partsHtml = subParts.map(p => `
    <div class="q-subpart">
      <span class="q-subpart-label">${p.label})</span>
      <span class="q-subpart-text">${escapeHtml(p.text)}</span>
    </div>`).join("");

  return `${stemHtml}<div class="q-subparts-list">${partsHtml}</div>`;
}

// ── State ──────────────────────────────────────────────────
let currentQuestion = null;
let voiceMode = true; // Enabled by default for active voice assistant
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let isSpeaking = false;
let speechMuted = false;
let sessionStats = { correct: 0, partial: 0, incorrect: 0, answered: 0, totalScore: 0 };
let questionHistory = [];

// ── DOM refs ───────────────────────────────────────────────
const questionText = document.getElementById("questionText");
const questionTopic = document.getElementById("questionTopic");
const progressLabel = document.getElementById("progressLabel");
const examProgressFill = document.getElementById("examProgressFill");
const difficultyBadge = document.getElementById("difficultyBadge");
const answerTextarea = document.getElementById("answerTextarea");
const charCount = document.getElementById("charCount");
const submitBtn = document.getElementById("submitBtn");
const skipBtn = document.getElementById("skipBtn");
const feedbackPanel = document.getElementById("feedbackPanel");
const answerSection = document.getElementById("answerSection");
const nextQuestionBtn = document.getElementById("nextQuestionBtn");
const finishExamBtn = document.getElementById("finishExamBtn");
const voiceUI = document.getElementById("voiceUI");
const micBtn = document.getElementById("micBtn");
const recordingStatus = document.getElementById("recordingStatus");
const transcriptionArea = document.getElementById("transcriptionArea");
const transcriptionText = document.getElementById("transcriptionText");
const speakQuestionBtn = document.getElementById("speakQuestionBtn");
const muteBtn = document.getElementById("muteBtn");
const autoVoiceToggle = document.getElementById("autoVoiceToggle");
const examinerStatusSub = document.getElementById("examinerStatusSub");
const examinerAvatar = document.getElementById("examinerAvatar");
const historyList = document.getElementById("historyList");
const scoreRing = document.getElementById("scoreRing");
const ringScore = document.getElementById("ringScore");
const sessionInfo = document.getElementById("sessionInfo");
const scoreDisplay = document.getElementById("scoreDisplay");

// ── Character count ────────────────────────────────────────
answerTextarea.addEventListener("input", () => {
  const len = answerTextarea.value.length;
  charCount.textContent = `${len} character${len !== 1 ? "s" : ""}`;
  submitBtn.disabled = len < 3;
});

// ── Load session & first question ─────────────────────────
async function initSession() {
  try {
    const res = await fetch(`/api/sessions/${SESSION_ID}`);
    if (!res.ok) throw new Error("Session not found.");
    const data = await res.json();
    const session = data.session;

    window.CURRENT_PROJECT_ID = session.project_id;
    voiceMode = session.voice_mode || true;

    sessionInfo.textContent = `${session.difficulty.charAt(0).toUpperCase() + session.difficulty.slice(1)} · ${session.total_questions} Q`;
    sessionInfo.className = `badge badge-${session.difficulty}`;

    await fetchNextQuestion();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function fetchNextQuestion() {
  // Reset UI
  questionText.innerHTML = '<div class="skeleton-text"></div><div class="skeleton-text short"></div>';
  questionTopic.textContent = "";
  feedbackPanel.style.display = "none";
  answerSection.style.display = "flex";
  answerTextarea.value = "";
  charCount.textContent = "0 characters";
  submitBtn.disabled = true;
  transcriptionArea.style.display = "none";
  transcriptionText.value = "";

  if (examinerStatusSub) examinerStatusSub.textContent = "Synthesizing next question…";

  try {
    const res = await fetch(`/api/sessions/${SESSION_ID}/question`);
    const data = await res.json();

    if (data.exam_complete) {
      showExamComplete();
      return;
    }

    currentQuestion = data.question;
    renderQuestion(currentQuestion);
  } catch (err) {
    toast("Failed to load question: " + err.message, "error");
    if (examinerStatusSub) examinerStatusSub.textContent = "Error loading question.";
  }
}

function renderQuestion(q) {
  questionText.innerHTML = renderQuestionHTML(q.question_text);
  questionTopic.textContent = q.topic || "";

  const diff = q.difficulty || "medium";
  difficultyBadge.textContent = diff.charAt(0).toUpperCase() + diff.slice(1);
  difficultyBadge.className = `badge badge-${diff}`;

  // Voice Assistant: automatically read question if Auto-Voice is active
  const isAutoVoice = autoVoiceToggle ? autoVoiceToggle.checked : true;
  if (isAutoVoice && !speechMuted) {
    speakText(q.question_text);
  } else if (examinerStatusSub) {
    examinerStatusSub.textContent = "Question ready. Click Speak or Mic to begin.";
  }

  updateProgressUI();
}

function updateProgressUI() {
  const total = parseInt(sessionInfo.textContent.match(/(\d+) Q/)?.[1] || "10");
  const answered = sessionStats.answered;
  const qNum = answered + 1;

  progressLabel.textContent = `Question ${qNum} / ${total}`;
  examProgressFill.style.width = `${(answered / total) * 100}%`;
}

// ── Submit answer ──────────────────────────────────────────
submitBtn.addEventListener("click", submitAnswer);
skipBtn.addEventListener("click", () => {
  answerTextarea.value = "(Skipped – no answer provided)";
  submitAnswer();
});

async function submitAnswer() {
  const answer = answerTextarea.value.trim();
  if (!answer || answer.length < 2) { toast("Please write or speak an answer first.", "warn"); return; }
  if (!currentQuestion) return;

  submitBtn.querySelector(".btn-text").style.display = "none";
  submitBtn.querySelector(".btn-spinner").style.display = "inline";
  submitBtn.disabled = true;
  skipBtn.disabled = true;

  if (examinerStatusSub) examinerStatusSub.textContent = "AI Examiner evaluating your answer against rubric…";

  try {
    const res = await fetch(`/api/sessions/${SESSION_ID}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question_id: currentQuestion.id, answer }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Submission failed.");

    // Update stats
    const fb = data.feedback;
    sessionStats.answered = data.questions_answered;
    sessionStats.totalScore = data.session_score;
    const correctness = fb.correctness || "";
    if (correctness === "correct") sessionStats.correct++;
    else if (correctness === "partial") sessionStats.partial++;
    else sessionStats.incorrect++;

    // Add to history
    questionHistory.push({
      index: data.question_index + 1,
      topic: currentQuestion.topic,
      score: data.score,
      correctness,
      text: currentQuestion.question_text,
    });

    renderFeedback(fb, data);
    updateSidebar(data);

    // Check if exam is complete after this answer
    const totalQ = parseInt(sessionInfo.textContent.match(/(\d+) Q/)?.[1] || "10");
    if (data.questions_answered >= totalQ) {
      nextQuestionBtn.style.display = "none";
      finishExamBtn.style.display = "inline-flex";
    }

    // Voice Assistant speaks feedback summary if Auto-Voice is active
    const isAutoVoice = autoVoiceToggle ? autoVoiceToggle.checked : true;
    if (isAutoVoice && !speechMuted) {
      let voiceSummary = "";
      if (correctness === "correct") {
        voiceSummary = `Excellent response! You scored ${fb.score || 100} out of 100. ` + (fb.understood_correctly?.[0] || "");
      } else if (correctness === "partial") {
        voiceSummary = `Partially correct. You scored ${fb.score || 50} out of 100. Key point: ` + (fb.correct_reasoning || "").slice(0, 180);
      } else {
        voiceSummary = `Incorrect. Let's understand why: ` + (fb.correct_reasoning || "").slice(0, 180);
      }
      speakText(voiceSummary);
    }

  } catch (err) {
    toast(err.message, "error");
    submitBtn.querySelector(".btn-text").style.display = "inline";
    submitBtn.querySelector(".btn-spinner").style.display = "none";
    submitBtn.disabled = false;
    skipBtn.disabled = false;
    if (examinerStatusSub) examinerStatusSub.textContent = "Evaluation error. Please retry.";
  }
}

// ── Render feedback ────────────────────────────────────────
function renderFeedback(fb, data) {
  answerSection.style.display = "none";
  feedbackPanel.style.display = "flex";

  const score = fb.score || 0;
  const badge = document.getElementById("feedbackScoreBadge");
  badge.textContent = `${score}/100`;
  badge.style.color = score >= 70 ? "var(--success)" : score >= 40 ? "var(--warn)" : "var(--error)";

  const correctnessBadge = document.getElementById("correctnessBadge");
  const c = fb.correctness || "incorrect";
  correctnessBadge.textContent = c.charAt(0).toUpperCase() + c.slice(1);
  correctnessBadge.className = `correctness-badge ${c}`;

  // Understood correctly
  const ul = document.getElementById("understoodList");
  ul.innerHTML = "";
  (fb.understood_correctly || []).forEach(item => {
    ul.innerHTML += `<li>${escapeHtml(item)}</li>`;
  });
  if (!ul.children.length) ul.innerHTML = "<li>No specific strengths recorded for this response.</li>";

  // Misconceptions
  const ml = document.getElementById("misconceptionsList");
  ml.innerHTML = "";
  (fb.misconceptions || []).forEach(item => {
    ml.innerHTML += `<li>${escapeHtml(item)}</li>`;
  });
  document.getElementById("misconceptionsSection").style.display = ml.children.length ? "flex" : "none";

  // Correct reasoning
  document.getElementById("correctReasoning").innerHTML = nl2br(fb.correct_reasoning || "No explanation provided.");

  // Detailed explanation
  const detSec = document.getElementById("detailedSection");
  if (fb.detailed_explanation) {
    detSec.style.display = "flex";
    document.getElementById("detailedExplanation").innerHTML = nl2br(fb.detailed_explanation);
  } else {
    detSec.style.display = "none";
  }

  // Example / Analogy
  document.getElementById("exampleAnalogy").textContent = fb.example_or_analogy || "No specific analogy provided.";

  // Strengths tab
  const sl = document.getElementById("strengthsList");
  sl.innerHTML = "";
  (fb.understood_correctly || []).forEach(item => {
    sl.innerHTML += `<li>${escapeHtml(item)}</li>`;
  });
  if (!sl.children.length) sl.innerHTML = "<li>Keep practicing to build your conceptual depth.</li>";

  // Model answer
  document.getElementById("modelAnswer").innerHTML = nl2br(fb.improved_answer || "No model answer provided.");

  // Follow-up question
  const fBox = document.getElementById("followUpBox");
  if (fb.follow_up_question) {
    fBox.style.display = "block";
    document.getElementById("followUpDiff").textContent = (fb.follow_up_difficulty || "medium").toUpperCase();
    document.getElementById("followUpQuestion").textContent = fb.follow_up_question;
  } else {
    fBox.style.display = "none";
  }

  // Evidence
  const el = document.getElementById("evidenceList");
  el.innerHTML = "";
  (fb.project_evidence || []).forEach(item => {
    el.innerHTML += `<li>${escapeHtml(item)}</li>`;
  });
  if (!el.children.length) el.innerHTML = "<li>General computer science evaluation.</li>";

  // Feedback tabs logic
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      const tab = document.getElementById(`tab-${btn.dataset.tab}`);
      if (tab) tab.classList.add("active");
    };
  });
}

// ── Next question / Complete ──────────────────────────────
nextQuestionBtn.addEventListener("click", () => {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  fetchNextQuestion();
});

finishExamBtn.addEventListener("click", () => {
  window.location.href = `/report/${SESSION_ID}`;
});

function showExamComplete() {
  questionText.innerHTML = "<h3>🎉 Viva Voce Complete!</h3><p>You have answered all questions. Click below to inspect your detailed performance report, topic scores, and examiner feedback.</p>";
  questionTopic.textContent = "Exam Finished";
  answerSection.style.display = "none";
  feedbackPanel.style.display = "none";
  nextQuestionBtn.style.display = "none";
  finishExamBtn.style.display = "inline-flex";

  if (examinerStatusSub) examinerStatusSub.textContent = "Examination completed. Ready for performance report.";
  if (!speechMuted) speakText("Congratulations! Your viva examination is complete. Preparing your final performance report.");
}

// ── Sidebar Updates ────────────────────────────────────────
function updateSidebar(data) {
  document.getElementById("statQuestions").textContent = `${sessionStats.answered}/${sessionInfo.textContent.match(/(\d+) Q/)?.[1] || "10"}`;
  document.getElementById("statCorrect").textContent = sessionStats.correct;
  document.getElementById("statPartial").textContent = sessionStats.partial;
  document.getElementById("statIncorrect").textContent = sessionStats.incorrect;

  const avg = data.session_score || 0;
  ringScore.textContent = Math.round(avg);
  scoreDisplay.textContent = `Score: ${Math.round(avg)}/100`;

  // Animate ring (stroke-dashoffset from 201 to 0)
  const offset = 201 - (201 * avg) / 100;
  scoreRing.style.strokeDashoffset = offset;
  scoreRing.style.stroke = avg >= 70 ? "var(--success)" : avg >= 40 ? "var(--warn)" : "var(--error)";

  // History list
  historyList.innerHTML = questionHistory.map(q => `
    <div class="history-item">
      <div class="history-item-top">
        <span class="history-q-num">Q${q.index}</span>
        <span class="history-topic">${escapeHtml(q.topic)}</span>
        <span class="history-score">${q.score}/100</span>
      </div>
      <div class="history-badge ${q.correctness}">${q.correctness}</div>
    </div>
  `).join("");
}

// ── Microphone Recording for Answers ───────────────────────
if (micBtn) {
  micBtn.addEventListener("click", () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });
}

async function startRecording() {
  audioChunks = [];
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      uploadAudio();
    };

    mediaRecorder.start(250);
    isRecording = true;
    micBtn.classList.add("recording");
    micBtn.querySelector(".mic-icon").textContent = "⏹";
    recordingStatus.textContent = "Listening… Click microphone again when done speaking.";
    if (examinerStatusSub) examinerStatusSub.textContent = "Transcribing student speech via Whisper…";

  } catch (err) {
    const msg = err.name === "NotAllowedError"
      ? "Microphone access denied. Please grant permission in browser settings."
      : `Could not access microphone: ${err.message}`;
    toast(msg, "error");
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  isRecording = false;
  micBtn.classList.remove("recording");
  micBtn.querySelector(".mic-icon").textContent = "🎤";
  recordingStatus.textContent = "Processing speech with Groq Whisper…";
}

async function uploadAudio() {
  if (!audioChunks.length) {
    recordingStatus.textContent = "Click microphone to speak your answer";
    toast("No audio recorded.", "warn");
    return;
  }

  const mimeType = mediaRecorder.mimeType || "audio/webm";
  const ext = mimeType.includes("ogg") ? "ogg" : "webm";
  const blob = new Blob(audioChunks, { type: mimeType });
  const formData = new FormData();
  formData.append("audio", blob, `viva_answer.${ext}`);

  try {
    const res = await fetch("/api/speech/transcribe", { method: "POST", body: formData });
    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error || "Transcription failed.");
    }

    const transcript = data.transcript || "";
    if (!transcript.trim()) {
      toast("No audible words detected. Please try speaking again.", "warn");
      recordingStatus.textContent = "Click microphone to speak your answer";
      return;
    }

    // Show transcription area
    transcriptionArea.style.display = "flex";
    transcriptionText.value = transcript;

    // Fill main answer box and trigger character count/submit enable
    answerTextarea.value = transcript;
    answerTextarea.dispatchEvent(new Event("input"));
    recordingStatus.textContent = "✓ Speech transcribed! Review and edit if needed.";
    if (examinerStatusSub) examinerStatusSub.textContent = "Answer transcribed. Ready for submission.";

  } catch (err) {
    toast("Speech recognition error: " + err.message, "error");
    recordingStatus.textContent = "Click microphone to speak your answer";
  }
}

// Sync transcription edits to main answer box
transcriptionText.addEventListener("input", () => {
  answerTextarea.value = transcriptionText.value;
  answerTextarea.dispatchEvent(new Event("input"));
});

// ── Speech Synthesis (TTS) ─────────────────────────────────
function speakText(text) {
  if (speechMuted || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();

  // Strip markdown and code blocks for clean pronunciation
  const clean = text
    .replace(/[*#`_~]/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return;

  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  utterance.onstart = () => {
    isSpeaking = true;
    if (examinerAvatar) examinerAvatar.classList.add("speaking");
    if (examinerStatusSub) examinerStatusSub.textContent = "AI Voice Examiner speaking aloud…";
  };

  utterance.onend = utterance.onerror = () => {
    isSpeaking = false;
    if (examinerAvatar) examinerAvatar.classList.remove("speaking");
    if (examinerStatusSub) examinerStatusSub.textContent = "Voice Examiner ready.";
  };

  window.speechSynthesis.speak(utterance);
}

if (speakQuestionBtn) {
  speakQuestionBtn.addEventListener("click", () => {
    if (currentQuestion) speakText(currentQuestion.question_text);
  });
}

if (muteBtn) {
  muteBtn.addEventListener("click", () => {
    speechMuted = !speechMuted;
    muteBtn.textContent = speechMuted ? "🔕" : "🔇";
    muteBtn.title = speechMuted ? "Unmute Voice" : "Mute Voice";
    if (speechMuted) {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      if (examinerStatusSub) examinerStatusSub.textContent = "Voice assistant muted.";
    } else {
      if (examinerStatusSub) examinerStatusSub.textContent = "Voice assistant unmuted.";
    }
  });
}

// ── Early Examination Finish ──────────────────────────────
const earlyExitModal = document.getElementById("earlyExitModal");
const earlyExitModalText = document.getElementById("earlyExitModalText");
const cancelEarlyExitBtn = document.getElementById("cancelEarlyExitBtn");
const confirmEarlyExitBtn = document.getElementById("confirmEarlyExitBtn");
const endExamEarlyBtn = document.getElementById("endExamEarlyBtn");
const navEndExamBtn = document.getElementById("navEndExamBtn");

function promptEarlyExit() {
  const answered = sessionStats.answered;
  if (answered === 0) {
    toast("Please answer at least one question before ending early so a meaningful report can be generated.", "warn");
    return;
  }
  const totalQ = parseInt(sessionInfo.textContent.match(/(\d+) Q/)?.[1] || "10");
  const avg = Math.round(sessionStats.totalScore || 0);

  if (earlyExitModalText) {
    earlyExitModalText.innerHTML = `You have completed <strong>${answered} of ${totalQ}</strong> questions so far with an average score of <strong>${avg}/100</strong>.<br/><br/>Ending now will mark the examination complete and generate your official Performance Report based on your completed answers.`;
  }
  if (earlyExitModal) earlyExitModal.classList.remove("hidden");
}

if (endExamEarlyBtn) endExamEarlyBtn.addEventListener("click", promptEarlyExit);
if (navEndExamBtn) navEndExamBtn.addEventListener("click", promptEarlyExit);

if (cancelEarlyExitBtn) {
  cancelEarlyExitBtn.addEventListener("click", () => {
    if (earlyExitModal) earlyExitModal.classList.add("hidden");
  });
}

if (confirmEarlyExitBtn) {
  confirmEarlyExitBtn.addEventListener("click", () => {
    confirmEarlyExitBtn.disabled = true;
    confirmEarlyExitBtn.textContent = "Generating Report…";
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    window.location.href = `/report/${SESSION_ID}`;
  });
}

// ── Init ───────────────────────────────────────────────────
initSession();
