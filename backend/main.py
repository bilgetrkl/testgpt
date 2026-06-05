from typing import Any

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from groq import Groq
from dotenv import load_dotenv
import os

from database import (
    authenticate_user,
    create_token,
    create_user,
    get_current_user,
    init_db,
    load_sessions,
    replace_sessions,
    revoke_token,
)

load_dotenv()

app = FastAPI(title="TestGPT API")
auth_scheme = HTTPBearer(auto_error=False)
init_db()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

class RequirementsInput(BaseModel):
    requirements: str


class RegisterInput(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)
    email: str = Field(..., min_length=5, max_length=254)
    password: str = Field(..., min_length=8, max_length=128)


class LoginInput(BaseModel):
    email: str
    password: str


class SessionsInput(BaseModel):
    sessions: list[dict[str, Any]] = Field(default_factory=list)

@app.get("/")
def read_root():
    return {"status": "TestGPT backend running", "database": "sqlite"}


@app.post("/auth/register", status_code=201)
def register(data: RegisterInput):
    if "@" not in data.email or "." not in data.email.rsplit("@", 1)[-1]:
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    try:
        user = create_user(data.name, data.email, data.password)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"token": create_token(user["id"]), "user": user}


@app.post("/auth/login")
def login(data: LoginInput):
    user = authenticate_user(data.email, data.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return {"token": create_token(user["id"]), "user": user}


@app.get("/auth/me")
def auth_me(user: dict[str, Any] = Depends(get_current_user)):
    return {"user": user}


@app.post("/auth/logout", status_code=204)
def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(auth_scheme),
    user: dict[str, Any] = Depends(get_current_user),
):
    del user
    if credentials:
        revoke_token(credentials.credentials)


@app.get("/sessions")
def get_sessions(user: dict[str, Any] = Depends(get_current_user)):
    return {"sessions": load_sessions(user["id"])}


@app.put("/sessions")
def sync_sessions(data: SessionsInput, user: dict[str, Any] = Depends(get_current_user)):
    replace_sessions(user["id"], data.sessions)
    return {"saved": len(data.sessions)}

@app.post("/generate")
def generate_tests(
    data: RequirementsInput,
    user: dict[str, Any] = Depends(get_current_user),
):
    del user
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
def refine_tests(
    data: RefinementInput,
    user: dict[str, Any] = Depends(get_current_user),
):
    del user
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
