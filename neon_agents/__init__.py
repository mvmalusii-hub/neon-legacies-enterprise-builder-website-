"""Neon Legacies raw-API agents (Onboard, Legis).

Import surface:
    from neon_agents import call_agent, validate, validate_onboard, validate_legis
"""
from .provider import AgentError, PROVIDERS, call_agent, load_prompt, load_schema
from .validate import (load_industries, validate, validate_legis,
                       validate_onboard)

__all__ = [
    "AgentError",
    "PROVIDERS",
    "call_agent",
    "load_prompt",
    "load_schema",
    "load_industries",
    "validate",
    "validate_onboard",
    "validate_legis",
]
__version__ = "1.0.0"
