import asyncio
import logging
import smtplib
from email.message import EmailMessage

from backend.config import settings

logger = logging.getLogger("chess_analyzer.email")


def _smtp_enabled() -> bool:
    return bool(settings.smtp_host and settings.smtp_username and settings.smtp_password)


def _send_email_sync(to_email: str, subject: str, body: str) -> None:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from_email or settings.smtp_username
    msg["To"] = to_email
    msg.set_content(body)

    if int(settings.smtp_port) == 465:
        with smtplib.SMTP_SSL(settings.smtp_host, int(settings.smtp_port), timeout=25) as server:
            server.login(settings.smtp_username, settings.smtp_password)
            server.send_message(msg)
    else:
        with smtplib.SMTP(settings.smtp_host, int(settings.smtp_port), timeout=25) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(settings.smtp_username, settings.smtp_password)
            server.send_message(msg)


async def send_email(to_email: str, subject: str, body: str) -> bool:
    if not to_email:
        return False
    if not _smtp_enabled():
        logger.warning("SMTP not configured; skipping email send to %s", to_email)
        return False
    try:
        await asyncio.to_thread(_send_email_sync, to_email, subject, body)
        return True
    except Exception:
        logger.exception("Failed to send email to %s", to_email)
        return False
