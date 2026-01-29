#!/Users/heng/Development/tele_bot/scripts/.venv/bin/python
"""Gmail CLI for personal assistant.

Usage:
    emails.py list [--unread] [--limit N]
    emails.py read <message_id>
    emails.py send <to> <subject> <body>
    emails.py search <query> [--limit N]
"""

import argparse
import json
import sys
from pathlib import Path

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from email.mime.text import MIMEText
import base64


TOKEN_PATH = Path.home() / ".config/gmail/token.json"


def get_service():
    """Get authenticated Gmail service."""
    if not TOKEN_PATH.exists():
        print("Error: Gmail not authenticated. Run OAuth setup first.", file=sys.stderr)
        sys.exit(1)

    token_data = json.loads(TOKEN_PATH.read_text())
    creds = Credentials(
        token=token_data.get("token"),
        refresh_token=token_data.get("refresh_token"),
        token_uri=token_data.get("token_uri"),
        client_id=token_data.get("client_id"),
        client_secret=token_data.get("client_secret"),
    )

    # Refresh if expired
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        token_data["token"] = creds.token
        TOKEN_PATH.write_text(json.dumps(token_data, indent=2))

    return build("gmail", "v1", credentials=creds)


def list_emails(unread_only: bool = False, limit: int = 10):
    """List recent emails."""
    service = get_service()
    query = "is:unread" if unread_only else ""

    results = service.users().messages().list(
        userId="me",
        q=query,
        maxResults=limit
    ).execute()

    messages = results.get("messages", [])
    if not messages:
        print("No emails found.")
        return

    print(f"{'='*60}")
    print(f"{'Unread ' if unread_only else ''}Emails (showing {len(messages)})")
    print(f"{'='*60}\n")

    for msg in messages:
        full = service.users().messages().get(
            userId="me",
            id=msg["id"],
            format="metadata",
            metadataHeaders=["From", "Subject", "Date"]
        ).execute()

        headers = {h["name"]: h["value"] for h in full["payload"]["headers"]}
        snippet = full.get("snippet", "")[:80]

        print(f"ID: {msg['id']}")
        print(f"From: {headers.get('From', 'N/A')}")
        print(f"Subject: {headers.get('Subject', 'N/A')}")
        print(f"Date: {headers.get('Date', 'N/A')}")
        print(f"Preview: {snippet}...")
        print("-" * 40)


def read_email(message_id: str):
    """Read a specific email."""
    service = get_service()

    msg = service.users().messages().get(
        userId="me",
        id=message_id,
        format="full"
    ).execute()

    headers = {h["name"]: h["value"] for h in msg["payload"]["headers"]}

    print(f"{'='*60}")
    print(f"From: {headers.get('From', 'N/A')}")
    print(f"To: {headers.get('To', 'N/A')}")
    print(f"Subject: {headers.get('Subject', 'N/A')}")
    print(f"Date: {headers.get('Date', 'N/A')}")
    print(f"{'='*60}\n")

    # Extract body
    body = ""
    payload = msg["payload"]

    if "body" in payload and payload["body"].get("data"):
        body = base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8")
    elif "parts" in payload:
        for part in payload["parts"]:
            if part["mimeType"] == "text/plain" and part["body"].get("data"):
                body = base64.urlsafe_b64decode(part["body"]["data"]).decode("utf-8")
                break

    print(body or msg.get("snippet", "No body content"))


def send_email(to: str, subject: str, body: str):
    """Send an email."""
    service = get_service()

    message = MIMEText(body)
    message["to"] = to
    message["subject"] = subject

    raw = base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8")

    result = service.users().messages().send(
        userId="me",
        body={"raw": raw}
    ).execute()

    print(f"Email sent successfully. Message ID: {result['id']}")


def search_emails(query: str, limit: int = 10):
    """Search emails with Gmail query syntax."""
    service = get_service()

    results = service.users().messages().list(
        userId="me",
        q=query,
        maxResults=limit
    ).execute()

    messages = results.get("messages", [])
    if not messages:
        print(f"No emails matching: {query}")
        return

    print(f"{'='*60}")
    print(f"Search: {query} ({len(messages)} results)")
    print(f"{'='*60}\n")

    for msg in messages:
        full = service.users().messages().get(
            userId="me",
            id=msg["id"],
            format="metadata",
            metadataHeaders=["From", "Subject", "Date"]
        ).execute()

        headers = {h["name"]: h["value"] for h in full["payload"]["headers"]}

        print(f"ID: {msg['id']}")
        print(f"From: {headers.get('From', 'N/A')}")
        print(f"Subject: {headers.get('Subject', 'N/A')}")
        print("-" * 40)


def main():
    parser = argparse.ArgumentParser(description="Gmail CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # list
    list_parser = subparsers.add_parser("list", help="List emails")
    list_parser.add_argument("--unread", action="store_true", help="Only unread")
    list_parser.add_argument("--limit", type=int, default=10, help="Max results")

    # read
    read_parser = subparsers.add_parser("read", help="Read an email")
    read_parser.add_argument("message_id", help="Message ID")

    # send
    send_parser = subparsers.add_parser("send", help="Send an email")
    send_parser.add_argument("to", help="Recipient email")
    send_parser.add_argument("subject", help="Email subject")
    send_parser.add_argument("body", help="Email body")

    # search
    search_parser = subparsers.add_parser("search", help="Search emails")
    search_parser.add_argument("query", help="Gmail search query")
    search_parser.add_argument("--limit", type=int, default=10, help="Max results")

    args = parser.parse_args()

    if args.command == "list":
        list_emails(unread_only=args.unread, limit=args.limit)
    elif args.command == "read":
        read_email(args.message_id)
    elif args.command == "send":
        send_email(args.to, args.subject, args.body)
    elif args.command == "search":
        search_emails(args.query, limit=args.limit)


if __name__ == "__main__":
    main()
