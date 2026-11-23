# TabGrave

TabGrave is a calm reading archive and link triage desk that turns pasted dumps of unread browser tabs or exported HTML bookmark files into a structured reading ledger.

## How It Works
1. Paste any messy list of URLs or drag-and-drop an exported browser `.html` bookmarks file (or load the built-in sample set).
2. Gemini classifies each link by reading intent, writes a two-sentence summary, and recommends whether to read it today, file it away, or close it permanently.
3. Highlights one priority link at the top of the desk so you clear tab clutter one article at a time.

## Google AI Tools Used
- **Google AI Studio**: Prototyped, structured, and refined the full web application and prompt workflow.
- **Gemini API**: Analyzed pasted URLs and bookmark titles to infer topics, generate concise summaries, and assign reading verdicts.
- **Gemini Structured Outputs**: Enforced a strict JSON schema so raw pasted links render reliably into archive rows.

## Local Setup
1. Clone the repository: `git clone https://github.com/<your-username>/tabgrave.git`
2. Install dependencies: `npm install`
3. Add `GEMINI_API_KEY` to `.env.local`
4. Start the development server: `npm run dev`
