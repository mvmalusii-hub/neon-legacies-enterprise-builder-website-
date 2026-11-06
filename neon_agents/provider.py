"""One call path for DeepSeek and Qwen (both OpenAI-compatible).

Where this differs from the first draft of the design doc, and why:

* **No `python -c` heredocs in workflows.** There is a real CLI (`cli.py`), so
  quoting bugs and YAML/indentation traps disappear.
* **Tool call first, JSON content second.** `response_format={"type":
  "json_object"}` combined with a forced `tool_choice` is not portable – some
  OpenAI-compatible backends reject the pair or ignore `tool_choice`. We ask for
  the tool, fall back to parsing `message.content` (fences stripped), and only
  then fail.
* **`max_tokens` is per agent.** 800 truncates Legis (`finish_reason=length`).
* **Validation happens before a result is accepted.** A schema violation is fed
  back to the model once as a correction instead of a blind retry.
* **Every attempt logs one JSON line** – agent, provider, attempt, finish_reason,
  token usage, validation verdict. Never the API key.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Callable, Dict, List, Optional

from .validate import validate

log = logging.getLogger("neon_agents.provider")

PROVIDERS: Dict[str, Dict[str, Any]] = {
    "deepseek": {
        "base_url": "https://api.deepseek.com",
        "api_key_env": "DEEPSEEK_API_KEY",
        "model": os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
        "max_tokens": 1400,
    },
    "qwen": {
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "api_key_env": "QWEN_API_KEY",
        # DashScope speaks the OpenAI protocol; model ids are versioned
        # (qwen-plus / qwen-max / qwen-turbo). Set QWEN_MODEL to pin one.
        "model": os.getenv("QWEN_MODEL", "qwen-plus"),
        "max_tokens": 1400,
    },
}

AGENT_LIMITS = {"onboard": 320, "legis": 1400}


class AgentError(RuntimeError):
    pass


def _here(*parts: str) -> str:
    base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, *parts)


def load_prompt(agent: str) -> str:
    with open(_here("agents", f"{agent}_prompt.txt"), encoding="utf-8") as handle:
        return handle.read()


def load_schema(agent: str) -> Dict[str, Any]:
    with open(_here("agents", f"{agent}_schema.json"), encoding="utf-8") as handle:
        return json.load(handle)


def _strip_fences(text: str) -> str:
    text = text.strip()
    fenced = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.S)
    return fenced.group(1) if fenced else text


def _extract(message: Any) -> str:
    """Prefer the tool call, fall back to message.content."""
    calls = getattr(message, "tool_calls", None) or []
    if calls:
        arguments = calls[0].function.arguments
        if isinstance(arguments, (dict, list)):
            return json.dumps(arguments)
        return str(arguments)
    content = getattr(message, "content", None)
    if content:
        return _strip_fences(content)
    raise AgentError("provider returned neither a tool call nor content")


def call_agent(agent: str, user_message: str, provider: str = "deepseek",
               schema: Optional[Dict[str, Any]] = None,
               prompt: Optional[str] = None,
               client_factory: Optional[Callable[[], Any]] = None,
               max_retries: int = 3,
               validate_output: bool = True) -> Dict[str, Any]:
    """Run one agent. Returns {ok, data|error, attempts, usage, validation}."""
    if provider not in PROVIDERS:
        raise ValueError(f"unknown provider: {provider}")
    config = PROVIDERS[provider]
    schema = schema or load_schema(agent)
    prompt = prompt or load_prompt(agent)

    if client_factory is None:  # imported lazily so tests need no SDK
        from openai import OpenAI  # type: ignore

        api_key = os.getenv(config["api_key_env"])
        if not api_key:
            raise AgentError(f"{config['api_key_env']} is not set")

        def client_factory() -> Any:
            return OpenAI(api_key=api_key, base_url=config["base_url"])

    client = client_factory()
    messages: List[Dict[str, str]] = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": user_message},
    ]
    last_error = "not attempted"
    usage_dump: Dict[str, Any] = {}

    for attempt in range(1, max_retries + 1):
        started = time.time()
        try:
            response = client.chat.completions.create(
                model=config["model"],
                messages=messages,
                temperature=0.1,
                max_tokens=AGENT_LIMITS.get(agent, config["max_tokens"]),
                tools=[{
                    "type": "function",
                    "function": {
                        "name": schema["name"],
                        "description": schema.get("description", agent),
                        "parameters": schema["schema"],
                    },
                }],
                tool_choice={"type": "function",
                             "function": {"name": schema["name"]}},
            )
        except Exception as exc:  # network, 401, 429, 5xx
            last_error = f"{type(exc).__name__}: {exc}"
            log.warning(json.dumps({
                "event": "provider_error", "agent": agent, "provider": provider,
                "attempt": attempt, "error": last_error,
                "ms": int((time.time() - started) * 1000),
            }))
            if attempt == max_retries:
                break
            time.sleep(2 ** attempt)
            continue

        choice = response.choices[0]
        finish = getattr(choice, "finish_reason", None)
        usage = getattr(response, "usage", None)
        if hasattr(usage, "model_dump"):
            usage_dump = usage.model_dump()
        elif isinstance(usage, dict):
            usage_dump = usage

        try:
            data = json.loads(_extract(choice.message))
        except (AgentError, json.JSONDecodeError) as exc:
            last_error = f"unparseable output: {exc}"
            if finish == "length":
                last_error += " (finish_reason=length – raise max_tokens)"
            log.warning(json.dumps({
                "event": "parse_error", "agent": agent, "provider": provider,
                "attempt": attempt, "finish_reason": finish, "error": last_error,
                "usage": usage_dump,
            }))
            if attempt == max_retries:
                break
            messages.append({"role": "assistant",
                             "content": str(getattr(choice.message, "content", ""))})
            messages.append({"role": "user", "content":
                             "That was not valid JSON. Return ONLY the JSON object."})
            continue

        problems = validate(agent, data) if validate_output else []
        log.info(json.dumps({
            "event": "agent_call", "agent": agent, "provider": provider,
            "model": config["model"], "attempt": attempt, "finish_reason": finish,
            "usage": usage_dump, "valid": not problems, "problems": problems,
        }))

        if not problems:
            return {"ok": True, "data": data, "attempts": attempt,
                    "usage": usage_dump, "validation": []}

        last_error = "schema/table violation: " + "; ".join(problems)
        if attempt == max_retries:
            return {"ok": False, "agent": agent, "error": last_error,
                    "attempts": attempt, "usage": usage_dump,
                    "validation": problems, "data": data}

        # One corrective round-trip that quotes the validator back at the model.
        messages.append({"role": "assistant", "content": json.dumps(data)})
        messages.append({"role": "user", "content":
                         "That JSON breaks these rules:\n- " + "\n- ".join(problems) +
                         "\nReturn the corrected JSON object only."})

    return {"ok": False, "agent": agent, "error": last_error,
            "attempts": max_retries}
