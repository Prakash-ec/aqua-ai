"""
Centralized critical water-quality thresholds.
Single source of truth for alert evaluation.
"""

# pH critical thresholds
PH_CRITICAL_LOW = 5.5
PH_CRITICAL_HIGH = 9.0

# Turbidity critical (NTU)
TURBIDITY_CRITICAL_HIGH = 10.0

# TDS critical (mg/L)
TDS_CRITICAL_HIGH = 1500.0

# Temperature critical (°C)
TEMPERATURE_CRITICAL_HIGH = 40.0

# Cooldown in seconds (5 minutes)
ALERT_COOLDOWN_SECONDS = 300

THRESHOLDS = {
    "ph": {"low": PH_CRITICAL_LOW, "high": PH_CRITICAL_HIGH},
    "turbidity": {"high": TURBIDITY_CRITICAL_HIGH},
    "tds": {"high": TDS_CRITICAL_HIGH},
    "temperature": {"high": TEMPERATURE_CRITICAL_HIGH},
}
