# TestGPT — AI-Augmented Acceptance Test Generator

A demo app that takes software requirements and generates Gherkin acceptance tests using AI.

## Project Structure

```
testgpt/
├── frontend/    # React app (Vite)
└── backend/     # FastAPI app
```

## Running the project

### Backend
```bash
cd backend
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Runs at: http://localhost:8000

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Runs at: http://localhost:5173

### Environment variables
Create a `.env` file inside the `backend/` folder:
```
GROQ_API_KEY=your_api_key_here
```
Get a free API key at https://console.groq.com

## What's been built

- Project setup and folder structure
- Requirements input UI
- FastAPI backend with CORS configured
- Groq AI integration using llama-3.3-70b-versatile
- Gherkin test generation from requirements
- Results displayed on the page

## What's next

Pick up from `frontend/src/App.jsx` and `backend/main.py`.

Features to build:
- Refinement chat — let users ask the AI to modify specific test cases
- Coverage summary — label and count happy path / edge case / negative scenarios
- Ambiguity detection — AI reviews requirements and flags vague or incomplete parts
- Traceability — link each test case back to a specific requirement
- Export — download results as a .feature file
- UI polish — make it look presentable enough to demo
- Demo prep — prepare a sample requirements scenario to show

## API endpoint

`POST /generate`
- Input: `{ "requirements": "string" }`
- Output: `{ "result": "Gherkin string" }`
