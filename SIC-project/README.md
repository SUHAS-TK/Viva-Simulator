# AI Viva Simulator

An interactive, AI-powered viva voce examination simulator. Upload your project documentation and face a rigorous AI examiner that asks adaptive, medium-to-hard questions, provides detailed feedback, and features a glowing Arc Reactor AI Agent.

---

## Features

- **Arc Reactor AI Agent** — Floating animated Arc Reactor widget that opens an interactive AI coach for project questions, tricky viva questions, and tech defense.
- **Dual Themes (Light / Dark Mode)** — One-click theme toggle switch in the navbar that remembers your preference across all pages.
- **End Exam Early Option** — Finish the viva whenever you want; calculate your performance report based on completed answers so you don't have to wait through all questions.
- **Active Voice Assistant** — Real-time speech synthesis for asking questions automatically during viva, with animated voice wave indicators and Groq Whisper STT for spoken answers.
- **Save & Email Performance Report** — One-click saving as PDF, standalone HTML download, clipboard summary, in-browser email preview, plus automated report email delivery (with voice email dictation!).
- **RAG-powered questions** grounded in your uploaded project documents (PDF, DOCX, TXT, Markdown).
- **Adaptive examination** — difficulty automatically increases/decreases based on your performance.
- **Deep correction engine** — step-by-step explanations, analogies, and model answers for wrong or incomplete answers.
- **Structured, Spacious UI** — De-congested, comfortable cards with ample whitespace and accessible typography.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11+, Flask 3.x |
| LLM | Groq API (`llama-3.3-70b-versatile`) |
| STT | Groq Whisper (`whisper-large-v3-turbo`) |
| TTS | Browser SpeechSynthesis API + Auto-voice examiner |
| RAG | sentence-transformers + FAISS (with built-in pure Python fallback) |
| Document parsing | PyMuPDF (PDF), python-docx (DOCX), stdlib (TXT/MD) |
| Database | SQLite via SQLAlchemy 2.x |
| Config | python-dotenv |
| Frontend | Vanilla HTML5 / CSS3 / JavaScript (with Arc Reactor HUD) |

---

## Quick Setup

### 1. Virtual Environment & Dependencies

```cmd
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure `.env`

Edit `.env` to add your Groq API key:

```env
GROQ_API_KEY=gsk_your_groq_api_key_here
FLASK_SECRET_KEY=dev-secret-key
```

#### Setting Up Real Gmail Email Delivery:
If you want the report sent directly to your real Gmail inbox (e.g. `hulk44678@gmail.com`):
1. In your Google Account, enable **2-Step Verification**.
2. Go to [Google App Passwords](https://myaccount.google.com/apppasswords) and generate a 16-character App Password.
3. Add these lines to `.env`:
   ```env
   SMTP_SERVER=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=hulk44678@gmail.com
   SMTP_PASSWORD=xxxx-xxxx-xxxx-xxxx
   SMTP_FROM_EMAIL=hulk44678@gmail.com
   ```
*(If SMTP is not configured, the app runs in Preview Mode and lets you inspect the full sent email directly in your browser with one click!)*

---

### 3. Run the Application

```cmd
python run.py
```

Open your browser at: **http://localhost:5000**

---

## Running Tests

```cmd
pytest tests/ -v
```

37 automated tests covering document parsing, tech detection, isolated vector indices, Arc Reactor chat, email delivery & preview, early session completion, speech services, and frontend routes.

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/projects` | Upload document |
| GET | `/api/projects` | List all projects |
| GET | `/api/projects/<id>` | Get project details |
| GET | `/api/projects/<id>/status` | Poll processing status |
| DELETE | `/api/projects/<id>` | Delete project |
| POST | `/api/sessions` | Start viva session |
| GET | `/api/sessions/<id>` | Get session info |
| GET | `/api/sessions/<id>/question` | Get current/next question |
| POST | `/api/sessions/<id>/answer` | Submit answer |
| GET | `/api/sessions/<id>/history` | Full Q&A history |
| GET | `/api/sessions/<id>/report` | Final performance report |
| POST | `/api/sessions/<id>/email-report` | Send performance report to specified email |
| GET | `/api/sessions/<id>/email-preview` | View HTML email report directly in browser |
| GET | `/api/sessions/<id>/email-download` | Download HTML email report file |
| POST | `/api/agent/chat` | Chat with Arc Reactor AI Agent |
| POST | `/api/speech/transcribe` | Transcribe audio via Whisper (multipart) |
| DELETE | `/api/sessions/<id>` | Delete session |
