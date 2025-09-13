#!/usr/bin/env python3
"""
Command-line interface for the AgilVB price matching engine.

This script allows you to match arbitrary product descriptions against a
vendor's catalogue stored in an Excel workbook.  It leverages the
``PriceMatcher`` class from the ``agilvb_matcher`` module to perform
keyword filtering and fuzzy string matching.

Usage example::

    python run_matcher.py Lista_de_Precios.xlsx "ESCRITORIO 2 CAJONES" \
        "CAJONERA OFICINA GABINETE CON LLAVE Y RUEDAS" --top 3

This will print the top three catalogue matches for each provided
description, along with similarity scores and computed net/total prices.
"""

import argparse
from agilvb_matcher import PriceMatcher


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Match one or more item descriptions against a price list. "
            "The price list must be an Excel file containing at least the "
            "columns 'PRODUCTO' and 'precio venta Neto'."
        )
    )
    parser.add_argument(
        "price_file",
        help="Path to the Excel file containing the catalogue (e.g. Lista_de_Precios.xlsx)",
    )
    parser.add_argument(
        "items",
        nargs="+",
        help="One or more item descriptions to match against the catalogue",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=5,
        help="Number of top matches to return for each item (default: 5)",
    )

    args = parser.parse_args()
    matcher = PriceMatcher(args.price_file)

    for description in args.items:
        result = matcher.match_item(description, top_n=args.top)
        print(f"\nMatches for: {result['item']}")
        for match in result["matches"]:
            product = match["product"]
            score = match["score"]
            net_price = match["net_price"]
            total_price = match["total_price"]
            print(
                f"  {product} | score: {score:.2f} | "
                f"net price: {net_price:.2f} | total price: {total_price:.2f}"
            )


if __name__ == "__main__":
    main()
