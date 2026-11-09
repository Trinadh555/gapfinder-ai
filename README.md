# 🎓 GapFinder AI — AI-Powered Diagnostic Study & Revision Engine

> **Built for the igebra.ai AI Engineering Selection Hackathon**  
> *Author:* **Mummana Trinadh** ([GitHub: @Trinadh555](https://github.com/Trinadh555))  
> *Submission To:* **Sandhya Piradi** (`sandhya@igebra.ai`)

[![Live Demo](https://img.shields.io/badge/Demo-Live%20on%20Vercel-success?style=for-the-badge&logo=vercel)](https://gapfinder-ai-chi.vercel.app)
[![Next.js](https://img.shields.io/badge/Next.js-14%20App%20Router-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/Database-Supabase%20pgvector-3ECF8E?style=for-the-badge&logo=supabase)](https://supabase.com/)
[![Groq](https://img.shields.io/badge/Inference-Groq%20LPU%20Engine-F55036?style=for-the-badge&logo=fastapi)](https://groq.com/)

---

## 🌐 Live Application & Demo Credentials

* **Live URL:** [https://gapfinder-ai-chi.vercel.app](https://gapfinder-ai-chi.vercel.app)
* **Demo Email:** `demo@gapfinder.ai`
* **Demo Password:** `Demo@12345`

*(You can also sign up with your own email to test with fresh documents.)*

---

## 📌 Problem Overview

Students often waste dozens of hours passively rereading whole textbooks without knowing **where their actual knowledge gaps lie**. 
Existing generic AI study assistants hallucinate facts outside the curriculum and cannot pinpoint where in the student's *actual school materials* a concept was missed.

### 💡 The GapFinder AI Solution
GapFinder AI acts as an **intelligent study doctor**:
1. **Tests** the student on their exact course content with syllabus-grounded diagnostic questions.
2. **Diagnoses** weak vs. strong topics with clear diagnostic metrics (🔴 Weak, 🟡 Medium, 🔵 Strong).
3. **Prescribes** a high-yield, day-by-day revision schedule prioritized by weakness and past exam frequency.
4. **Tutors** on demand with strict page citations (`[1] Notes, p. 14`) and zero outside hallucination.

---

## 🚀 Key Features

* **Strict Grounded RAG with Page Citations:** Every single quiz question, answer explanation, and AI tutor response cites the exact document name and page number (`[1] notes.pdf, p. 18`).
* **Flexible Material Ingestion (1, 2, or 3 Documents):**
  * *Single Document:* Automatically detects and extracts chapters from the Table of Contents of a single textbook/notes PDF.
  * *Two Documents:* Notes + Syllabus or Notes + Past Papers.
  * *Three Documents:* Syllabus + Notes + Past Examination Paper.
* **Exam Frequency Weighting:** Maps past exam questions to syllabus topics to identify high-yield exam areas.
* **Mixed-Topic Diagnostic Quiz:** Randomly interleaves questions across all selected chapters (just like a real exam), with configurable question density (1, 2, 3, or 5 questions per chapter).
* **Automated Diagnostic Gap Report:** Visual progress dashboard showing score percentages and status categorization.
* **Adaptive Revision Planner:** Generates an actionable day-by-day study schedule based on user-configured study days and daily study hours.
* **Interactive AI Tutor with Clean Math Output:** Clarifies concepts using strictly retrieved passages, rendering clean readable formulas (no raw LaTeX brackets).
* **Document Management:** One-click deletion of uploaded materials with cascading database cleanup.

---

## 🏗️ Architecture & Workflow

```mermaid
flowchart TD
    A[Student Uploads PDF: Notes / Syllabus / Past Paper] --> B[Client-Side Text Extraction\nvia PDF.js CDN]
    B -->|Bypasses Vercel 4.5MB Body Limit| C[POST /api/upload]
    C --> D[(Supabase Database\nDocument Chunks)]
    
    D --> E[Topic Extraction Engine\nPOST /api/topics]
    E -->|Extracts Chapters & Correlates Exam Frequency| F[Topic Map Dashboard]
    
    F --> G[Diagnostic Quiz Generator\nPOST /api/quiz]
    G -->|Multi-Topic Shuffled Quiz| H[Student Takes Quiz]
    
    H --> I[Diagnostic Evaluation\nPOST /api/evaluate]
    I --> J[Knowledge Gap Report\n🔴 Weak | 🟡 Medium | 🔵 Strong]
    
    J --> K[Adaptive Revision Planner\nPOST /api/plan]
    K --> L[Day-by-Day Prioritized Study Schedule]
    
    D --> M[Strict RAG AI Tutor\nPOST /api/explain]
    M -->|Strict Passages Only| N[Tutor Answer with Page Citations\n[1] Notes, p. 14]
```

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

### 3. Elimination of Duplicate Keys and Fragmented Topic Extraction
* **Problem:** Traditional LLM extraction sometimes stripped numbers from "Unit 1: Mechanics" into duplicate names like "Unit", causing database unique constraint violations and React reconciliation warnings.
* **Solution:** Enhanced system prompts with strict deduplication guards and fallback naming strategies (`Unit {N}: {Title}`) combined with Set-based deduplication in `/api/topics`.

### 4. Human-Readable Mathematical Formatting
* **Problem:** Raw LaTeX formatting (`\[ \sigma(x) = \frac{1}{1 + e^{-x}} \]`) made explanations difficult to read in standard UI components.
* **Solution:** Engineered a client-side math formatter (`cleanMathText`) that converts raw LaTeX fractions, Greek letters, square roots, and subscripts into clean, legible Unicode symbols (`σ(x) = 1 / (1 + e^-x)`).

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | [Next.js 14](https://nextjs.org/) (App Router, Serverless Functions) |
| **Language** | [TypeScript](https://www.typescriptlang.org/) |
| **Styling** | [Tailwind CSS](https://tailwindcss.com/) |
| **Database & Vector** | [Supabase](https://supabase.com/) (PostgreSQL, `pgvector`, Row Level Security) |
| **AI & Inference** | [GroqCloud LPU](https://groq.com/) (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`) |
| **PDF Processing** | Client-side [PDF.js](https://mozilla.github.io/pdf.js/) + Server chunking |
| **Validation** | [Zod](https://zod.dev/) |
| **Deployment** | [Vercel](https://vercel.com/) |

---

## 📦 Local Development Setup

### 1. Clone the repository
```bash
git clone https://github.com/Trinadh555/gapfinder-ai.git
cd gapfinder-ai
```

### 2. Install dependencies
```bash
npm install
```

### 3. Environment Variables
Create a `.env.local` file in the project root with the following:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Groq Cloud API
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=openai/gpt-oss-120b
GROQ_MODEL_CHAT=openai/gpt-oss-120b
```

### 4. Run the development server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📄 License
This project was developed for the **igebra.ai AI Engineering Selection Process**. All rights reserved.