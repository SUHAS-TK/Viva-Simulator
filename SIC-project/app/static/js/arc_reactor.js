/* ═══════════════════════════════════════════════════════════════
   arc_reactor.js – Interactive Arc Reactor & AI Agent Assistant
   ═══════════════════════════════════════════════════════════════ */
"use strict";

(function () {
  // ── Inject Arc Reactor & Agent DOM ──────────────────────────
  function initArcReactorDOM() {
    if (document.getElementById("arcReactorWidget")) return;

    const widget = document.createElement("div");
    widget.id = "arcReactorWidget";
    widget.className = "arc-reactor-widget";
    widget.setAttribute("title", "ARC REACTOR // AI Agent Assistant (Click to open)");
    widget.innerHTML = `
      <div class="reactor-core-wrap">
        <div class="reactor-ring outer-ring"></div>
        <div class="reactor-ring segment-ring">
          <span class="seg seg-1"></span>
          <span class="seg seg-2"></span>
          <span class="seg seg-3"></span>
          <span class="seg seg-4"></span>
          <span class="seg seg-5"></span>
          <span class="seg seg-6"></span>
          <span class="seg seg-7"></span>
          <span class="seg seg-8"></span>
        </div>
        <div class="reactor-ring inner-ring"></div>
        <div class="reactor-center">
          <div class="reactor-triangle"></div>
        </div>
        <div class="reactor-energy-pulse"></div>
      </div>
      <div class="reactor-label">AI AGENT</div>
    `;

    const modal = document.createElement("div");
    modal.id = "arcAgentModal";
    modal.className = "arc-agent-modal hidden";
    modal.innerHTML = `
      <div class="arc-agent-backdrop" id="arcAgentBackdrop"></div>
      <div class="arc-agent-window">
        <!-- HUD Header -->
        <div class="arc-hud-header">
          <div class="arc-hud-brand">
            <div class="arc-mini-core"></div>
            <div>
              <div class="arc-hud-title">ARC REACTOR // AI AGENT</div>
              <div class="arc-hud-status"><span class="status-dot"></span> NEURAL LINK ACTIVE · ONLINE</div>
            </div>
          </div>
          <div class="arc-hud-controls">
            <button class="arc-tool-btn" id="arcVoiceOutToggle" title="Toggle AI voice response">
              <span id="arcVoiceOutIcon">🔊</span>
              <span class="arc-tool-label">Voice Output</span>
            </button>
            <button class="arc-close-btn" id="arcCloseBtn" title="Close Assistant">✕</button>
          </div>
        </div>

        <!-- Project Context Tag -->
        <div class="arc-context-bar" id="arcContextBar">
          <span class="arc-context-icon">⚡</span>
          <span id="arcContextText">Ready to assist with project doubts, architectural defense, and viva prep.</span>
        </div>

        <!-- Quick Prompt Chips -->
        <div class="arc-chips-scroll">
          <button class="arc-chip" data-prompt="Explain my project's architecture simply and clearly">🏗️ Explain architecture</button>
          <button class="arc-chip" data-prompt="What tricky questions might the examiner ask in my viva?">🎯 Predict tricky viva questions</button>
          <button class="arc-chip" data-prompt="How do I defend my choice of database and frameworks?">🛡️ Defend technology stack</button>
          <button class="arc-chip" data-prompt="What are the main edge cases or failure points in this project?">⚠️ Edge cases & failure points</button>
        </div>

        <!-- Chat History -->
        <div class="arc-chat-history" id="arcChatHistory">
          <div class="arc-msg arc-msg-agent">
            <div class="arc-msg-avatar">⚡</div>
            <div class="arc-msg-bubble">
              <p><strong>Greetings!</strong> I am your <strong>Arc Reactor AI Agent</strong>.</p>
              <p>Ask me anything about your project, tricky technical questions the examiner might ask, design trade-offs, or viva defense strategies. You can type or speak to me directly.</p>
            </div>
          </div>
        </div>

        <!-- Audio Wave Visualizer -->
        <div class="arc-wave-visualizer" id="arcWaveVisualizer" style="display:none;">
          <span class="wave-bar wb-1"></span>
          <span class="wave-bar wb-2"></span>
          <span class="wave-bar wb-3"></span>
          <span class="wave-bar wb-4"></span>
          <span class="wave-bar wb-5"></span>
          <span class="wave-status" id="arcWaveStatus">Listening…</span>
        </div>

        <!-- Input Area -->
        <div class="arc-input-area">
          <button class="arc-mic-btn" id="arcMicBtn" title="Speak to AI Agent">
            <span>🎤</span>
          </button>
          <textarea id="arcInput" class="arc-textarea" rows="1" placeholder="Ask the AI Agent a question... (e.g. Why did we choose this database?)"></textarea>
          <button class="arc-send-btn" id="arcSendBtn" title="Send query">
            <span>Send ➔</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(widget);
    document.body.appendChild(modal);

    setupArcReactorEvents();
  }

  // ── State ──────────────────────────────────────────────────
  let chatHistory = [];
  let voiceOutEnabled = true;
  let isAgentRecording = false;
  let agentMediaRecorder = null;
  let agentAudioChunks = [];

  function setupArcReactorEvents() {
    const widget = document.getElementById("arcReactorWidget");
    const modal = document.getElementById("arcAgentModal");
    const backdrop = document.getElementById("arcAgentBackdrop");
    const closeBtn = document.getElementById("arcCloseBtn");
    const sendBtn = document.getElementById("arcSendBtn");
    const input = document.getElementById("arcInput");
    const micBtn = document.getElementById("arcMicBtn");
    const voiceOutToggle = document.getElementById("arcVoiceOutToggle");
    const chips = document.querySelectorAll(".arc-chip");

    // Open/Close
    widget.addEventListener("click", () => toggleModal(true));
    backdrop.addEventListener("click", () => toggleModal(false));
    closeBtn.addEventListener("click", () => toggleModal(false));

    // Voice Out Toggle
    voiceOutToggle.addEventListener("click", () => {
      voiceOutEnabled = !voiceOutEnabled;
      document.getElementById("arcVoiceOutIcon").textContent = voiceOutEnabled ? "🔊" : "🔇";
      voiceOutToggle.classList.toggle("muted", !voiceOutEnabled);
      if (!voiceOutEnabled && window.speechSynthesis) window.speechSynthesis.cancel();
    });

    // Send query
    sendBtn.addEventListener("click", () => handleSend());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    // Auto-grow textarea
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 120) + "px";
    });

    // Chips
    chips.forEach((c) => {
      c.addEventListener("click", () => {
        const prompt = c.getAttribute("data-prompt");
        input.value = prompt;
        handleSend();
      });
    });

    // Voice recording
    micBtn.addEventListener("click", toggleVoiceRecording);

    // Context sync
    syncContext();
  }

  function toggleModal(open) {
    const modal = document.getElementById("arcAgentModal");
    const widget = document.getElementById("arcReactorWidget");
    if (open) {
      modal.classList.remove("hidden");
      widget.classList.add("reactor-active");
      document.getElementById("arcInput").focus();
      syncContext();
    } else {
      modal.classList.add("hidden");
      widget.classList.remove("reactor-active");
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    }
  }

  function syncContext() {
    const contextText = document.getElementById("arcContextText");
    let projId = window.CURRENT_PROJECT_ID;
    let sessId = window.SESSION_ID;

    if (sessId) {
      contextText.textContent = `Synchronized with active Viva Session #${sessId}. Asking questions will search your project context.`;
    } else if (projId) {
      contextText.textContent = `Synchronized with Project #${projId}. Ready to explain project architecture & algorithms.`;
    } else {
      contextText.textContent = "General Viva & CS intelligence active. Upload a project to unlock grounded RAG coaching.";
    }
  }

  async function handleSend() {
    const input = document.getElementById("arcInput");
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
    input.style.height = "auto";

    appendMessage("user", text);

    const historyContainer = document.getElementById("arcChatHistory");
    const loadingElem = document.createElement("div");
    loadingElem.className = "arc-msg arc-msg-agent loading-msg";
    loadingElem.innerHTML = `
      <div class="arc-msg-avatar">⚡</div>
      <div class="arc-msg-bubble"><span class="arc-dots"><span>.</span><span>.</span><span>.</span></span> Analysing project telemetry…</div>
    `;
    historyContainer.appendChild(loadingElem);
    historyContainer.scrollTop = historyContainer.scrollHeight;

    const payload = {
      message: text,
      project_id: window.CURRENT_PROJECT_ID || null,
      session_id: window.SESSION_ID || null,
      history: chatHistory.slice(-6),
    };

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      loadingElem.remove();

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to reach AI agent.");
      }

      const data = await res.json();
      const reply = data.response || "No response received.";
      appendMessage("agent", reply, data.sources);

      if (voiceOutEnabled) {
        speakAgentText(reply);
      }
    } catch (err) {
      loadingElem.remove();
      appendMessage("agent", `⚠️ **Communication error:** ${err.message}`);
    }
  }

  function appendMessage(role, text, sources = []) {
    const historyContainer = document.getElementById("arcChatHistory");
    const msg = document.createElement("div");
    msg.className = `arc-msg arc-msg-${role}`;

    const formatted = formatMarkdown(text);
    let sourcesHtml = "";
    if (sources && sources.length) {
      sourcesHtml = `<div class="arc-sources">📚 <strong>Sources:</strong> ${sources.map(s => `<span>${escapeHtml(s)}</span>`).join(", ")}</div>`;
    }

    if (role === "user") {
      msg.innerHTML = `
        <div class="arc-msg-bubble user-bubble">${escapeHtml(text)}</div>
        <div class="arc-msg-avatar user-avatar">👤</div>
      `;
    } else {
      msg.innerHTML = `
        <div class="arc-msg-avatar">⚡</div>
        <div class="arc-msg-bubble">
          ${formatted}
          ${sourcesHtml}
        </div>
      `;
    }

    historyContainer.appendChild(msg);
    historyContainer.scrollTop = historyContainer.scrollHeight;

    chatHistory.push({ role, content: text });
  }

  function escapeHtml(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function formatMarkdown(text) {
    if (!text) return "";
    let s = escapeHtml(text);
    // Bold
    s = s.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    // Italics
    s = s.replace(/\*(.*?)\*/g, "<em>$1</em>");
    // Code inline
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    // Bullet points
    s = s.replace(/^[•\-\*]\s+(.*)$/gm, "<li>$1</li>");
    s = s.replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>");
    // Line breaks
    s = s.replace(/\n\n/g, "<br/><br/>").replace(/\n/g, "<br/>");
    return s;
  }

  function speakAgentText(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();

    // Strip markdown formatting for speech
    const clean = text
      .replace(/[*#`_~]/g, "")
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!clean) return;

    const utterance = new SpeechSynthesisUtterance(clean.slice(0, 400));
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    const visualizer = document.getElementById("arcWaveVisualizer");
    const waveStatus = document.getElementById("arcWaveStatus");

    utterance.onstart = () => {
      visualizer.style.display = "flex";
      waveStatus.textContent = "AI Agent speaking…";
    };

    utterance.onend = utterance.onerror = () => {
      visualizer.style.display = "none";
    };

    window.speechSynthesis.speak(utterance);
  }

  // ── Voice Recording to Speech-to-Text ───────────────────────
  async function toggleVoiceRecording() {
    const micBtn = document.getElementById("arcMicBtn");
    const visualizer = document.getElementById("arcWaveVisualizer");
    const waveStatus = document.getElementById("arcWaveStatus");

    if (isAgentRecording) {
      // Stop recording
      if (agentMediaRecorder && agentMediaRecorder.state !== "inactive") {
        agentMediaRecorder.stop();
      }
      isAgentRecording = false;
      micBtn.classList.remove("recording");
      waveStatus.textContent = "Transcribing audio…";
      return;
    }

    // Start recording
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      agentAudioChunks = [];
      agentMediaRecorder = new MediaRecorder(stream);

      agentMediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) agentAudioChunks.push(e.data);
      };

      agentMediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(agentAudioChunks, { type: "audio/webm" });
        await transcribeAndSend(blob);
      };

      agentMediaRecorder.start();
      isAgentRecording = true;
      micBtn.classList.add("recording");
      visualizer.style.display = "flex";
      waveStatus.textContent = "Listening to your voice… Click mic again when done.";
    } catch (err) {
      alert("Microphone access denied or unavailable: " + err.message);
    }
  }

  async function transcribeAndSend(blob) {
    const waveStatus = document.getElementById("arcWaveStatus");
    const visualizer = document.getElementById("arcWaveVisualizer");
    const input = document.getElementById("arcInput");

    const formData = new FormData();
    formData.append("audio", blob, "agent_recording.webm");

    try {
      const res = await fetch("/api/speech/transcribe", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      visualizer.style.display = "none";

      if (data.transcript && data.transcript.trim()) {
        input.value = data.transcript.trim();
        handleSend();
      } else {
        waveStatus.textContent = "No audible speech recognized. Please try again.";
        visualizer.style.display = "flex";
        setTimeout(() => (visualizer.style.display = "none"), 3000);
      }
    } catch (err) {
      visualizer.style.display = "none";
      alert("Transcription error: " + err.message);
    }
  }

  // Initialize on load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initArcReactorDOM);
  } else {
    initArcReactorDOM();
  }
})();
