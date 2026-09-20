import os
from pathlib import Path
from dotenv import load_dotenv
from typing import Optional

# Ensure .env is loaded even if this module is imported before main (e.g., tests)
load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=True)

def is_email_configured() -> bool:
    return bool(os.getenv("RESEND_API_KEY", "").strip() and os.getenv("ALERT_FROM_EMAIL", "").strip())

def get_email_config_status():
    return {
        "configured": is_email_configured(),
        "from_email_set": bool(os.getenv("ALERT_FROM_EMAIL", "").strip()),
        "api_key_set": bool(os.getenv("RESEND_API_KEY", "").strip()),
    }

def send_email(to_email: str, subject: str, html: str, text: str = None) -> dict:
    api_key = os.getenv("RESEND_API_KEY", "").strip()
    from_email = os.getenv("ALERT_FROM_EMAIL", "").strip()
    if not api_key or not from_email:
        return {"success": False, "status": "not_configured", "error": "Email provider not configured"}
    try:
        import resend
        resend.api_key = api_key
        params = {
            "from": from_email,
            "to": [to_email],
            "subject": subject,
            "html": html,
        }
        if text:
            params["text"] = text
        result = resend.Emails.send(params)
        if result and isinstance(result, dict) and result.get("id"):
            return {"success": True, "status": "sent", "id": result.get("id")}
        return {"success": True, "status": "sent"}
    except Exception as e:
        return {"success": False, "status": "failed", "error": str(e)[:300]}

def send_combined_critical_alert(device_name: str, reading, critical_parameters: list, recipient_email: str) -> dict:
    """
    Reusable helper for combined critical alert.
    critical_parameters: list of dicts {parameter, current_value, threshold, direction}
    """
    subject, html, text = build_combined_critical_email(reading, device_name, critical_parameters)
    return send_email(recipient_email, subject, html, text)

def build_combined_critical_email(reading, device_name: str, critical_parameters: list) -> tuple:
    ts = getattr(reading, 'recorded_at', None)
    # format timestamp
    try:
        ts_str = ts.strftime("%Y-%m-%d %H:%M:%S UTC") if ts else "N/A"
    except:
        ts_str = str(ts) if ts else "N/A"
    # Build table rows
    rows_html = ""
    rows_text = ""
    for p in critical_parameters:
        param = p.get("parameter", "")
        # pretty name
        pretty = {"ph":"pH", "turbidity":"Turbidity", "tds":"TDS", "temperature":"Temperature"}.get(param, param)
        cur = p.get("current_value")
        thr = p.get("threshold")
        direction = p.get("direction", "above")
        # format values with units
        if param == "ph":
            cur_str = f"{cur}"
            thr_str = f"&lt; {thr}" if direction=="below" else f"&gt; {thr}"
            cond = "Below threshold" if direction=="below" else "Above threshold"
        elif param == "turbidity":
            cur_str = f"{cur} NTU"
            thr_str = f"&gt; {thr} NTU"
            cond = "Above threshold"
        elif param == "tds":
            cur_str = f"{cur} mg/L"
            thr_str = f"&gt; {thr} mg/L"
            cond = "Above threshold"
        elif param == "temperature":
            cur_str = f"{cur} °C"
            thr_str = f"&gt; {thr} °C"
            cond = "Above threshold"
        else:
            cur_str = str(cur)
            thr_str = str(thr)
            cond = direction
        rows_html += f"<tr><td style='padding:8px;border:1px solid #e2e8f0'>{pretty}</td><td style='padding:8px;border:1px solid #e2e8f0'>{cur_str}</td><td style='padding:8px;border:1px solid #e2e8f0'>{thr_str}</td><td style='padding:8px;border:1px solid #e2e8f0'>{cond}</td></tr>"
        rows_text += f"{pretty} | {cur_str} | {thr_str} | {cond}\n"
    count = len(critical_parameters)
    subject = "Aqua AI \u2014 Critical Water Quality Alert"
    html = f"""
    <div style="font-family:Inter,Arial,sans-serif;max-width:640px;margin:0 auto;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
      <div style="background:#0e7c95;padding:16px 20px;color:#fff">
        <div style="font-size:12px;letter-spacing:0.8px;opacity:0.9">AQUA AI</div>
        <div style="font-size:18px;font-weight:700;margin-top:4px">Critical threshold exceeded</div>
      </div>
      <div style="padding:20px">
        <p style="margin:0;color:#334155">Aqua AI detected one or more critical water-quality parameters.</p>
        <p style="margin:12px 0 4px"><strong>Device:</strong> {device_name}<br><strong>Time:</strong> {ts_str}</p>
        <h3 style="margin:16px 0 8px;color:#0f172a;font-size:14px">Critical Parameters</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#f8fafc"><th style="padding:8px;border:1px solid #e2e8f0;text-align:left">Parameter</th><th style="padding:8px;border:1px solid #e2e8f0;text-align:left">Current Value</th><th style="padding:8px;border:1px solid #e2e8f0;text-align:left">Critical Threshold</th><th style="padding:8px;border:1px solid #e2e8f0;text-align:left">Condition</th></tr></thead>
          <tbody>{rows_html}</tbody>
        </table>
        <p style="margin:12px 0 4px;font-size:13px"><strong>Detected conditions:</strong> {count} critical parameter{'s' if count!=1 else ''}</p>
        <p style="color:#475569;font-size:13px">Please review the current sensor readings and investigate the water source.</p>
        <p style="color:#64748b;font-size:12px">This notification is based on configured critical sensor thresholds.</p>
      </div>
      <div style="background:#f8fafc;padding:10px 20px;font-size:11px;color:#94a3b8;text-align:center">Aqua AI \u2014 threshold-based sensor alert</div>
    </div>
    """
    text = f"Aqua AI - Critical Water Quality Alert\nCritical threshold exceeded\nDevice: {device_name}\nTime: {ts_str}\n\nCritical Parameters:\n{rows_text}\nDetected conditions: {count} critical parameter(s)\nPlease review the current sensor readings and investigate the water source.\n"
    return subject, html, text

def build_critical_email(reading, device_name: str, param: str, current, threshold, all_readings: dict) -> tuple:
    # legacy single-param wrapper kept for compatibility, now delegates to combined with one entry
    direction = "below" if param=="ph" and isinstance(current,(int,float)) and isinstance(threshold, str) and "below" in threshold else "above"
    # try to infer threshold value
    try:
        thr_val = float(str(threshold).replace("<","").replace(">","").replace("below","").replace("above","").strip().split()[0])
    except:
        thr_val = threshold
    return build_combined_critical_email(reading, device_name, [{"parameter": param, "current_value": current, "threshold": thr_val if isinstance(thr_val,(int,float)) else threshold, "direction": direction}])

def build_status_email(reading, device_name: str, all_readings: dict) -> tuple:
    subject = "Aqua AI Current Water Status"
    html = f"""
    <div style="font-family:Inter,Arial,sans-serif;max-width:600px">
    <h2 style="color:#0e7c95">Aqua AI Current Water Status</h2>
    <p><strong>Device:</strong> {device_name}</p>
    <ul>
      <li>Temperature: {all_readings.get('temperature', '--')} °C</li>
      <li>pH: {all_readings.get('ph', '--')}</li>
      <li>Turbidity: {all_readings.get('turbidity', '--')} NTU</li>
      <li>TDS: {all_readings.get('tds', '--')} mg/L</li>
    </ul>
    </div>
    """
    text = f"Aqua AI Current Water Status\nDevice: {device_name}\n"
    return subject, html, text
