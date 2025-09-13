"""
agilvb_matcher.py
------------------

This module implements a prototype matching engine for the *AgilVB* project.  The
goal of AgilVB is to automate the process of matching product descriptions from
Compra Ágil requests to a vendor's internal catalogue.  Once a request is
matched to products in the catalogue, the system can calculate a proposed
quotation based on current prices and apply any business rules (like maximum
discounts) before generating a final offer.

The matching logic here is intentionally simple but extensible.  It reads the
vendor's catalogue from an Excel workbook (expected to contain at least two
columns: ``PRODUCTO`` and ``precio venta Neto``).  For each input item
description, it attempts to find the best matching product names in the
catalogue using a combination of keyword filtering and fuzzy string matching.

Usage example::

    from agilvb_matcher import PriceMatcher

    matcher = PriceMatcher('Lista_de_Precios.xlsx')
    items = [
        'ESCRITORIO 2 CAJONES COLOR NATURAL, MEDIDAS 120X59X75',
        'CAJONERA OFICINA GABINETE CON LLAVE Y RUEDAS',
    ]
    results = matcher.match_items(items)
    for r in results:
        print(r['item'])
        for m in r['matches']:
            print('  ', m['product'], m['score'], m['net_price'], m['total_price'])

This script is self-contained and does not rely on network access.  It is
designed to be run inside the AgilVB environment as part of a larger
automation pipeline.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import List, Dict, Any, Tuple

import pandas as pd


def _remove_accents(text: str) -> str:
    """Normalize a string by removing accents and other diacritics.

    Args:
        text: Original string.

    Returns:
        A new string with accents removed.
    """
    # Normalize to NFD to separate characters from their accents, then filter
    normalized = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")


def _normalize(text: str) -> str:
    """Basic normalization: strip accents, uppercase, remove punctuation.

    This helper is used to ensure that comparisons between catalogue entries and
    input descriptions are case-insensitive and unaffected by accents or
    punctuation differences.

    Args:
        text: String to normalize.

    Returns:
        Normalized string.
    """
    # Remove accents and convert to uppercase
    text_no_accents = _remove_accents(text).upper()
    # Replace non-alphanumeric characters with spaces
    return re.sub(r"[^A-Z0-9 ]", " ", text_no_accents)


def _extract_keywords(text: str) -> List[str]:
    """Extract significant keywords from a product description.

    We split on whitespace, remove purely numeric tokens, and ignore very
    short tokens.  The idea is to capture core product names like
    "ESCRITORIO", "CAJONERA", etc., which can be used to filter the catalogue
    before performing a more expensive fuzzy match.

    Args:
        text: Raw description.

    Returns:
        A list of keywords.
    """
    normalized = _normalize(text)
    tokens = normalized.split()
    keywords = []
    for token in tokens:
        # Skip numbers and very short words
        if token.isdigit() or len(token) < 3:
            continue
        keywords.append(token)
    return keywords


@dataclass
class MatchResult:
    """A container for an individual match result."""
    product: str
    score: float
    net_price: float
    total_price: float


class PriceMatcher:
    """A simple matching engine for AgilVB.

    This class loads a price list and exposes methods to match arbitrary item
    descriptions against the catalogue.  It can be extended to incorporate
    brand weighting, unit conversions, and other domain-specific heuristics.
    """

    def __init__(self, price_file: str, tax_rate: float = 0.19) -> None:
        """Initialize the matcher.

        Args:
            price_file: Path to the Excel file containing the catalogue.  Must
                have at least the columns ``PRODUCTO`` and ``precio venta Neto``.
            tax_rate: IVA or VAT rate to apply when computing total price.
        """
        self.tax_rate = tax_rate
        self.df = self._load_catalogue(price_file)
        # Precompute normalized product names for matching
        self.df['NORMALIZED'] = self.df['PRODUCTO'].astype(str).apply(_normalize)

    @staticmethod
    def _load_catalogue(file_path: str) -> pd.DataFrame:
        """Load the price list from an Excel file.

        Raises:
            ValueError: If required columns are missing.
        """
        df = pd.read_excel(file_path)
        # Ensure required columns exist
        required = {'PRODUCTO', 'precio venta Neto'}
        missing = required - set(df.columns)
        if missing:
            raise ValueError(f"Missing columns in price list: {missing}")
        # Drop rows where product name is missing
        df = df.dropna(subset=['PRODUCTO']).reset_index(drop=True)
        return df

    def _fuzzy_match(self, query: str, candidates: pd.DataFrame, top_n: int = 5) -> List[MatchResult]:
        """Find the top N fuzzy matches for a query string.

        Args:
            query: The normalized query string.
            candidates: Subset of the catalogue to match against.
            top_n: Number of matches to return.

        Returns:
            A list of MatchResult sorted by score descending.
        """
        # Use SequenceMatcher to compute a ratio between the query and each candidate
        ratios: List[Tuple[int, float]] = []
        for idx, row in candidates.iterrows():
            ratio = SequenceMatcher(None, query, row['NORMALIZED']).ratio()
            ratios.append((idx, ratio))
        # Sort by ratio descending and take top_n
        top_indices = sorted(ratios, key=lambda x: x[1], reverse=True)[:top_n]
        matches: List[MatchResult] = []
        for idx, score in top_indices:
            prod_row = candidates.loc[idx]
            net_price = float(prod_row['precio venta Neto'])
            total_price = net_price * (1 + self.tax_rate)
            matches.append(MatchResult(
                product=prod_row['PRODUCTO'],
                score=score,
                net_price=net_price,
                total_price=total_price,
            ))
        return matches

    def match_item(self, description: str, top_n: int = 5) -> Dict[str, Any]:
        """Match a single item description against the catalogue.

        Args:
            description: The raw item description from a Compra Ágil request.
            top_n: Number of matches to return.

        Returns:
            A dictionary with the original description and a list of match
            results.  Each result includes the product name, a similarity score
            (0–1), and the net/total price.
        """
        normalized_desc = _normalize(description)
        keywords = _extract_keywords(description)
        # Filter candidates: must contain at least one keyword
        candidates = self.df
        if keywords:
            pattern = r"|".join(map(re.escape, keywords))
            mask = self.df['NORMALIZED'].str.contains(pattern, regex=True)
            candidates = self.df[mask]
        # If no candidates after filtering, use all
        if candidates.empty:
            candidates = self.df
        matches = self._fuzzy_match(normalized_desc, candidates, top_n=top_n)
        return {
            'item': description,
            'matches': [
                {
                    'product': m.product,
                    'score': m.score,
                    'net_price': m.net_price,
                    'total_price': m.total_price,
                }
                for m in matches
            ],
        }

    def match_items(self, descriptions: List[str], top_n: int = 5) -> List[Dict[str, Any]]:
        """Match a list of item descriptions.

        Args:
            descriptions: List of item descriptions.
            top_n: Number of matches per item.

        Returns:
            A list of dictionaries, one per item.
        """
        return [self.match_item(desc, top_n=top_n) for desc in descriptions]