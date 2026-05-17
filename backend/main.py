from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from groq import Groq
from dotenv import load_dotenv
import os

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

class RequirementsInput(BaseModel):
    requirements: str

@app.get("/")
def read_root():
    return {"status": "TestGPT backend running"}

@app.post("/generate")
def generate_tests(data: RequirementsInput):
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {
                "role": "system",
                "content": """You are an expert software tester. Given software requirements, 
                generate comprehensive acceptance test scenarios in Gherkin format (Given/When/Then).
                For each requirement, generate:
                - At least one happy path scenario
                - At least one edge case scenario
                - At least one negative scenario
                Format your output as valid Gherkin feature files only. No extra explanation, no conversational filler.
                Do NOT wrap the output in markdown code blocks or backticks (e.g., do not start with ``` or ```gherkin). Just return raw Gherkin text."""
            },
            {
                "role": "user",
                "content": f"Generate Gherkin acceptance tests for these requirements:\n\n{data.requirements}"
            }
        ]
    )
    result = response.choices[0].message.content
    
    if result:
        lines = result.split("\n")
        cleaned_lines = []
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("```"):
                continue
            cleaned_lines.append(line)
        result = "\n".join(cleaned_lines).strip()
        
    return {"result": result}