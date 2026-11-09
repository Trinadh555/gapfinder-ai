# 🎓 GapFinder AI — AI-Powered Diagnostic Study & Revision Engine

> **Built for the igebra.ai AI Intern Selection Hackathon**  
> **Author:** Mummana Trinadh ([GitHub: @Trinadh555](https://github.com/Trinadh555))  
> **Submission To:** Sandhya Piradi (sandhya@igebra.ai)

---

## 🌐 Live Application & Demo Login

* **Live Web App:** [https://gapfinder-ai-chi.vercel.app](https://gapfinder-ai-chi.vercel.app)
* **GitHub Repository:** [https://github.com/Trinadh555/gapfinder-ai](https://github.com/Trinadh555/gapfinder-ai)

### 🔑 Demo Test Credentials
You can test the application immediately using the pre-loaded demo account:
* **Email:** `demo@gapfinder.ai`
* **Password:** `Demo@12345`

*(You can also sign up with any test email to upload your own custom PDFs.)*

---

## 📌 Problem Statement

Students frequently spend hours passively rereading whole textbooks without knowing **where their actual knowledge gaps lie**. 
Generic AI chatbots often hallucinate facts outside the syllabus and cannot cite where in the student's *actual study material* a concept was covered.

### 💡 The GapFinder AI Solution
GapFinder AI acts as an **intelligent study doctor**:
1. **Tests** the student on their uploaded curriculum using diagnostic multi-topic questions.
2. **Diagnoses** weak vs. strong topics with a clear gap report (🔴 Weak, 🟡 Medium, 🔵 Strong).
3. **Prescribes** an adaptive, day-by-day revision schedule prioritized by weakness and past exam frequency.
4. **Tutors** with strict page citations (`[1] Notes, p. 14`) and zero outside hallucination.

---

## 🏗️ System Architecture & Workflow

+-------------------------------------------------------------+ | 1. INGESTION & PROCESSING | | Student Uploads PDFs (Notes, Syllabus, Past Papers) | | --> Client-Side Text Extraction (PDF.js CDN) | | (Bypasses Vercel Serverless 4.5MB Body Limit) | | --> Text Chunking & Stored in Supabase Database | +------------------------------+------------------------------+ | v +-------------------------------------------------------------+ | 2. TOPIC & EXAM MAPPING | | Groq LPU Engine extracts chapters and subtopics | | Correlates past exam questions to identify weightage | +------------------------------+------------------------------+ | v +-------------------------------------------------------------+ | 3. DIAGNOSTIC TESTING | | Generates multi-topic shuffled diagnostic quiz | | Student answers questions with custom question count | +------------------------------+------------------------------+ | v +-------------------------------------------------------------+ | 4. DIAGNOSIS & REVISION | | Knowledge Gap Report (🔴 Weak | 🟡 Medium | 🔵 Strong) | | Day-by-Day Adaptive Revision Plan tailored to hours/days | | Interactive AI Study Tutor with exact page citations | +-------------------------------------------------------------+



---

## 🚀 Key Features

* **Strict Grounded RAG with Page Citations:** Every single quiz question, answer explanation, and AI tutor response cites the exact document name and page number (`[1] notes.pdf, p. 18`).
* **Flexible Material Ingestion (1, 2, or 3 Documents):**
  * *Single Document:* Automatically detects and extracts chapters from the Table of Contents of a single textbook/notes PDF.
  * *Two Documents:* Notes + Syllabus or Notes + Past Papers.
  * *Three Documents:* Syllabus + Notes + Past Examination Paper.
* **Exam Frequency Weighting:** Maps past exam questions to syllabus topics to highlight high-priority exam chapters.
* **Mixed-Topic Diagnostic Quiz:** Randomly interleaves questions across all selected chapters (just like a real exam), with configurable question density (1, 2, 3, or 5 questions per chapter).
* **Automated Diagnostic Gap Report:** Visual progress dashboard showing score percentages and status categorization.
* **Adaptive Revision Planner:** Generates an actionable day-by-day study schedule based on user-configured study days and daily study hours.
* **Interactive AI Tutor with Clean Math Output:** Clarifies concepts using strictly retrieved passages, rendering clean readable formulas (no raw LaTeX brackets).
* **Document Management:** One-click deletion of uploaded materials with cascading database cleanup.

---

## ⚡ Technical Highlights & Engineering Challenges Solved

### 1. Bypassing Vercel Serverless 4.5MB Payload Limits
* **Problem:** Large student textbooks (15MB–50MB) resulted in `HTTP 413 Payload Too Large` when uploaded directly to Vercel serverless functions.
* **Solution:** Implemented client-side text and page extraction using a CDN-hosted PDF.js worker. The browser extracts text page-by-page and streams a lightweight JSON array to `/api/upload`, enabling instant uploads of large textbooks without server body limits.

### 2. High-Throughput Groq LPU Inference with Multi-Model Fallback
* **Problem:** Free-tier rate limits (tokens per day) could cause requests to stall or fail.
* **Solution:** Architected a resilient LLM client in `lib/llm.ts` with:
  * Primary model: `openai/gpt-oss-120b` (low reasoning effort for sub-second JSON parsing).
  * Fallback model: `openai/gpt-oss-20b`.
  * Instant failover on HTTP 429/404 with capped backoff, preventing 504 Gateway Timeouts on Vercel.

### 3. Elimination of Duplicate Keys & Clean Extraction
* **Problem:** Traditional LLM extraction sometimes stripped numbers from "Unit 1: Mechanics" into duplicate names like "Unit", causing database unique constraint violations and React reconciliation warnings.
* **Solution:** Enhanced system prompts with strict deduplication guards and fallback naming strategies (`Unit {N}: {Title}`) combined with Set-based deduplication in `/api/topics`.

### 4. Human-Readable Mathematical Formatting
* **Problem:** Raw LaTeX formatting made explanations difficult to read in standard UI components.
* **Solution:** Engineered a client-side math formatter (`cleanMathText`) that converts raw LaTeX fractions, Greek letters, square roots, and subscripts into clean, legible Unicode symbols (`σ(x) = 1 / (1 + e^-x)`).

---

## 🛠️ Tech Stack

| Component | Technology Used |
|---|---|
| **Frontend Framework** | Next.js 14 (App Router, Client Components) |
| **Language** | TypeScript |
| **Styling** | Tailwind CSS |
| **Database & Vector** | Supabase (PostgreSQL, Chunks, Row Level Security) |
| **AI Inference** | GroqCloud LPU (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`) |
| **PDF Processing** | Client-side PDF.js worker |
| **Validation** | Zod |
| **Hosting & Deployment** | Vercel Serverless |

---

## 📦 Local Development Setup

### 1. Clone the repository
```bash
git clone https://github.com/Trinadh555/gapfinder-ai.git
cd gapfinder-ai

npm install

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Groq Cloud API
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=openai/gpt-oss-120b
GROQ_MODEL_CHAT=openai/gpt-oss-120b

npm run dev