import os

def is_sms_configured() -> bool:
    return bool(os.getenv("TWILIO_ACCOUNT_SID", "").strip() and os.getenv("TWILIO_AUTH_TOKEN", "").strip() and os.getenv("TWILIO_PHONE_NUMBER", "").strip())

def get_sms_config_status():
    return {
        "configured": is_sms_configured(),
        "account_sid_set": bool(os.getenv("TWILIO_ACCOUNT_SID", "").strip()),
        "phone_set": bool(os.getenv("TWILIO_PHONE_NUMBER", "").strip()),
    }

def send_sms(to_number: str, body: str) -> dict:
    sid = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
    token = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
    from_num = os.getenv("TWILIO_PHONE_NUMBER", "").strip()
    if not sid or not token or not from_num:
        return {"success": False, "status": "not_configured", "error": "SMS provider not configured"}
    try:
        from twilio.rest import Client
        client = Client(sid, token)
        msg = client.messages.create(body=body, from_=from_num, to=to_number)
        return {"success": True, "status": "sent", "sid": getattr(msg, "sid", None)}
    except Exception as e:
        return {"success": False, "status": "failed", "error": str(e)[:300]}

def build_critical_sms(device_name: str, param: str, current, threshold, readings: dict) -> str:
    return (
        f"Aqua AI ALERT\n"
        f"Device: {device_name}\n"
        f"Critical {param}: {current}\n"
        f"Threshold: {threshold}\n\n"
        f"Turbidity: {readings.get('turbidity','--')} NTU\n"
        f"TDS: {readings.get('tds','--')} mg/L\n"
        f"Temp: {readings.get('temperature','--')} C\n\n"
        f"Critical threshold exceeded."
    )

def build_status_sms(device_name: str, readings: dict) -> str:
    return (
        f"Aqua AI Status\n"
        f"Device: {device_name}\n"
        f"pH: {readings.get('ph','--')}\n"
        f"Turb: {readings.get('turbidity','--')} NTU\n"
        f"TDS: {readings.get('tds','--')} mg/L\n"
        f"Temp: {readings.get('temperature','--')} C"
    )
