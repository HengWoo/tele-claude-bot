#!/Users/heng/Development/tele_bot/scripts/.venv/bin/python
"""Google Calendar CLI for personal assistant.

Usage:
    calendar.py today
    calendar.py week
    calendar.py upcoming [--days N]
    calendar.py create <title> <start> <end> [--description DESC]
    calendar.py list-calendars
"""

import argparse
import json
import sys
from pathlib import Path
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build


TOKEN_PATH = Path.home() / ".config/gcal/token.json"
LOCAL_TZ = ZoneInfo("Asia/Singapore")  # Adjust to your timezone


def get_service():
    """Get authenticated Calendar service."""
    if not TOKEN_PATH.exists():
        print("Error: Calendar not authenticated. Run OAuth setup first.", file=sys.stderr)
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

    return build("calendar", "v3", credentials=creds)


def format_event(event):
    """Format an event for display."""
    start = event["start"].get("dateTime", event["start"].get("date"))
    end = event["end"].get("dateTime", event["end"].get("date"))

    # Parse and format times
    if "T" in start:  # Has time component
        start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(end.replace("Z", "+00:00"))
        start_str = start_dt.astimezone(LOCAL_TZ).strftime("%H:%M")
        end_str = end_dt.astimezone(LOCAL_TZ).strftime("%H:%M")
        time_str = f"{start_str} - {end_str}"
    else:  # All-day event
        time_str = "All day"

    summary = event.get("summary", "No title")
    location = event.get("location", "")

    return f"  {time_str}: {summary}" + (f" @ {location}" if location else "")


def get_events(time_min: datetime, time_max: datetime, calendar_id: str = "primary"):
    """Get events in a time range."""
    service = get_service()

    events_result = service.events().list(
        calendarId=calendar_id,
        timeMin=time_min.isoformat(),
        timeMax=time_max.isoformat(),
        singleEvents=True,
        orderBy="startTime"
    ).execute()

    return events_result.get("items", [])


def show_today():
    """Show today's events."""
    now = datetime.now(LOCAL_TZ)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)

    events = get_events(start, end)

    print(f"{'='*50}")
    print(f"Today: {now.strftime('%A, %B %d, %Y')}")
    print(f"{'='*50}")

    if not events:
        print("  No events today.")
    else:
        for event in events:
            print(format_event(event))


def show_week():
    """Show this week's events."""
    now = datetime.now(LOCAL_TZ)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=7)

    events = get_events(start, end)

    print(f"{'='*50}")
    print(f"This Week: {start.strftime('%b %d')} - {end.strftime('%b %d, %Y')}")
    print(f"{'='*50}")

    if not events:
        print("  No events this week.")
        return

    # Group by day
    current_day = None
    for event in events:
        event_start = event["start"].get("dateTime", event["start"].get("date"))
        if "T" in event_start:
            event_day = datetime.fromisoformat(event_start.replace("Z", "+00:00")).astimezone(LOCAL_TZ).date()
        else:
            event_day = datetime.fromisoformat(event_start).date()

        if event_day != current_day:
            current_day = event_day
            day_name = datetime.combine(current_day, datetime.min.time()).strftime("%A, %b %d")
            print(f"\n{day_name}:")

        print(format_event(event))


def show_upcoming(days: int = 7):
    """Show upcoming events."""
    now = datetime.now(LOCAL_TZ)
    end = now + timedelta(days=days)

    events = get_events(now, end)

    print(f"{'='*50}")
    print(f"Upcoming {days} days")
    print(f"{'='*50}")

    if not events:
        print(f"  No events in the next {days} days.")
    else:
        for event in events:
            print(format_event(event))


def create_event(title: str, start: str, end: str, description: str = ""):
    """Create a calendar event.

    Start/end format: YYYY-MM-DD HH:MM or YYYY-MM-DD (all-day)
    """
    service = get_service()

    # Parse start/end times
    try:
        if " " in start:  # Has time
            start_dt = datetime.strptime(start, "%Y-%m-%d %H:%M").replace(tzinfo=LOCAL_TZ)
            end_dt = datetime.strptime(end, "%Y-%m-%d %H:%M").replace(tzinfo=LOCAL_TZ)
            event = {
                "summary": title,
                "start": {"dateTime": start_dt.isoformat()},
                "end": {"dateTime": end_dt.isoformat()},
            }
        else:  # All-day
            event = {
                "summary": title,
                "start": {"date": start},
                "end": {"date": end},
            }
    except ValueError as e:
        print(f"Error parsing date: {e}", file=sys.stderr)
        print("Format: YYYY-MM-DD HH:MM or YYYY-MM-DD", file=sys.stderr)
        sys.exit(1)

    if description:
        event["description"] = description

    result = service.events().insert(calendarId="primary", body=event).execute()

    print(f"Event created: {result.get('htmlLink')}")


def list_calendars():
    """List available calendars."""
    service = get_service()

    calendars = service.calendarList().list().execute()

    print(f"{'='*50}")
    print("Available Calendars")
    print(f"{'='*50}")

    for cal in calendars.get("items", []):
        primary = " (primary)" if cal.get("primary") else ""
        print(f"  {cal['summary']}{primary}")
        print(f"    ID: {cal['id']}")


def main():
    parser = argparse.ArgumentParser(description="Google Calendar CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # today
    subparsers.add_parser("today", help="Show today's events")

    # week
    subparsers.add_parser("week", help="Show this week's events")

    # upcoming
    upcoming_parser = subparsers.add_parser("upcoming", help="Show upcoming events")
    upcoming_parser.add_argument("--days", type=int, default=7, help="Number of days")

    # create
    create_parser = subparsers.add_parser("create", help="Create an event")
    create_parser.add_argument("title", help="Event title")
    create_parser.add_argument("start", help="Start: YYYY-MM-DD HH:MM or YYYY-MM-DD")
    create_parser.add_argument("end", help="End: YYYY-MM-DD HH:MM or YYYY-MM-DD")
    create_parser.add_argument("--description", default="", help="Event description")

    # list-calendars
    subparsers.add_parser("list-calendars", help="List available calendars")

    args = parser.parse_args()

    if args.command == "today":
        show_today()
    elif args.command == "week":
        show_week()
    elif args.command == "upcoming":
        show_upcoming(args.days)
    elif args.command == "create":
        create_event(args.title, args.start, args.end, args.description)
    elif args.command == "list-calendars":
        list_calendars()


if __name__ == "__main__":
    main()
