"""Contract for the release check that dashboard_mcp.py runs.

Copy to release_state.py and implement the four functions for your estate.
dashboard_mcp.py calls them in this order and reports every repository whose
drift() list is not empty. Read-only: only GET requests (for example `gh api`).
"""
from __future__ import annotations


def release_branch() -> str:
    """The branch that deploys, for example "release/2026-09"."""
    raise NotImplementedError


def matrix() -> list[dict]:
    """The repositories to check: [{"repo": "svc-a", "environments": ["staging", "production"]}, ...]."""
    raise NotImplementedError


def read_repo(entry: dict, branch: str, with_demo: bool) -> dict:
    """Facts for one repository. Must include "repo" and "envs" ({env: info}); the rest is yours."""
    raise NotImplementedError


def drift(row: dict) -> list[str]:
    """Reasons the repository is not released, empty when it is.

    The dashboard shortens these reasons, so keep to these phrasings where they apply:
      "release branch missing"
      "main is N commit(s), M file(s) ahead of the release branch"
      "<env> deploying" | "<env> last deploy failed" | "<env> runs `abc1234`, release head is `def5678`"
      "staging and production run different commits"
    """
    raise NotImplementedError
