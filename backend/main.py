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
                
                CRITICAL Requirement Traceability Rule:
                Identify which specific requirement or line number from the input text (e.g. 1, 2, or REQ-1) each scenario is based on.
                You MUST prefix each Gherkin scenario with a tag mapping back to that requirement (e.g. `@REQ-1` or `@REQ-2` or `@REQ-3`).
                Example:
                @REQ-1 @happy-path
                Scenario: Successful login
                
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

class RefinementInput(BaseModel):
    messages: list[dict]

@app.post("/refine")
def refine_tests(data: RefinementInput):
    system_message = {
        "role": "system",
        "content": """You are an expert software tester. Given software requirements and a history of modifications, 
        generate or update comprehensive acceptance test scenarios in Gherkin format (Given/When/Then).
        
        CRITICAL Requirement Traceability Rule:
        Identify which specific requirement or line number from the input text (e.g. 1, 2, or REQ-1) each scenario is based on.
        You MUST prefix each Gherkin scenario with a tag mapping back to that requirement (e.g. `@REQ-1` or `@REQ-2` or `@REQ-3`).
        
        Scenario Numbering Mapping:
        The user may refer to scenarios by their sequence number, prefixed with '@' or '#' or using words (e.g. "@1", "#1", "scenario 1", "scenario #1").
        These numbers correspond to the 1-based index of the scenarios in the Gherkin feature file.
        For example:
        - @1 (or scenario 1) refers to the 1st Scenario/Scenario Outline in the text.
        - @2 (or scenario 2) refers to the 2nd Scenario/Scenario Outline in the text.
        Make sure to identify and modify/refine the correct scenario based on these references while keeping the others unchanged.

        Format your output as valid Gherkin feature files only. No extra explanation, no conversational filler.
        Do NOT wrap the output in markdown code blocks or backticks (e.g., do not start with ``` or ```gherkin). Just return raw Gherkin text.
        Your response must contain the complete Gherkin feature content with all scenarios updated or added as requested by the user, preserving existing unmodified scenarios unless asked to change them."""
    }
    
    # Filter and construct the final messages list
    final_messages = [system_message]
    for msg in data.messages:
        role = msg.get("role", "user")
        if role not in ["system", "user", "assistant"]:
            role = "user"
        final_messages.append({
            "role": role,
            "content": msg.get("content", "")
        })

    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=final_messages
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