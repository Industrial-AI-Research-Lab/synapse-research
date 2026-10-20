from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

import httpx


class HttpPublicSourceGateway:
    """Checks public links and discovers recent metadata without scraping full text."""

    _CROSSREF_URL = "https://api.crossref.org/works"
    _SEARCH_QUERIES = (
        "surfactant polymer flooding laboratory core flood",
        "alkali surfactant polymer core flooding laboratory",
        "surfactant adsorption reservoir rock laboratory",
        "surfactant interfacial tension crude oil reservoir",
        "ПАВ полимерное заводнение лабораторные керновые исследования",
    )
    _HEADERS = {
        "User-Agent": "Synapse-Research/1.0 (public-source-catalog)",
        "Accept": "application/json, text/html, application/pdf;q=0.9, */*;q=0.1",
    }

    def refresh_sources(self, sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
        with ThreadPoolExecutor(max_workers=min(6, len(sources) or 1)) as executor:
            return list(executor.map(self._check_source, sources))

    def discover_sources(self) -> list[dict[str, Any]]:
        with ThreadPoolExecutor(max_workers=len(self._SEARCH_QUERIES)) as executor:
            result_groups = list(executor.map(self._discover_query, self._SEARCH_QUERIES))
        return [item for group in result_groups for item in group]

    def _discover_query(self, query: str) -> list[dict[str, Any]]:
        try:
            with httpx.Client(timeout=5.0, headers=self._HEADERS) as client:
                response = client.get(
                    self._CROSSREF_URL,
                    params={
                        "query.bibliographic": query,
                        "rows": 5,
                        "sort": "published",
                        "order": "desc",
                        "select": "DOI,title,container-title,published,URL,type",
                    },
                )
                response.raise_for_status()
        except httpx.HTTPError:
            return []

        discovered = []
        for item in response.json().get("message", {}).get("items", []):
            title = " ".join(item.get("title", [])).strip()
            doi = str(item.get("DOI", "")).strip()
            if not title or not doi:
                continue
            title_key = title.lower()
            has_chemical_eor_topic = any(
                term in title_key
                for term in (
                    "surfact",
                    "полимер",
                    "поверхностно-актив",
                    "alkali",
                    "polymer",
                )
            )
            has_reservoir_or_lab_context = any(
                term in title_key
                for term in (
                    "enhanced oil recovery",
                    "oil recovery",
                    "chemical flooding",
                    "core flood",
                    "reservoir",
                    "crude oil",
                    "petroleum",
                    "заводнени",
                    "керн",
                    "нефтеотдач",
                )
            )
            if not has_chemical_eor_topic or not has_reservoir_or_lab_context:
                continue
            date_parts = item.get("published", {}).get("date-parts", [[]])
            published = "-".join(str(part) for part in date_parts[0]) if date_parts else ""
            discovered.append(
                {
                    "id": f"crossref-{doi.lower()}",
                    "title": title,
                    "publisher": ", ".join(item.get("container-title", [])) or "Crossref",
                    "source_type": str(item.get("type", "publication")),
                    "access_level": "metadata_only",
                    "url": f"https://doi.org/{doi}",
                    "relevance": "Автоматически найдена по тематике ПАВ и химических методов увеличения нефтеотдачи; требуется инженерная проверка условий опыта и полноты данных.",
                    "review_status": "needs_review",
                    "origin_type": "public_metadata",
                    "source_scope": (
                        "tatneft_case"
                        if "tatneft" in title_key
                        else "general_evidence"
                    ),
                    "evidence_role": "needs_classification",
                    "published": published,
                    "checked_at": datetime.now(timezone.utc).isoformat(),
                }
            )
        return discovered

    def _check_source(self, source: dict[str, Any]) -> dict[str, Any]:
        item = dict(source)
        try:
            with httpx.Client(timeout=5.0, follow_redirects=True, headers=self._HEADERS) as client:
                response = client.head(str(item["url"]))
                if response.status_code == 405:
                    response = client.get(str(item["url"]), headers={"Range": "bytes=0-2048"})
                response.raise_for_status()
            item["availability"] = "available"
        except httpx.HTTPError:
            item["availability"] = "unknown"
        item["checked_at"] = datetime.now(timezone.utc).isoformat()
        return item
