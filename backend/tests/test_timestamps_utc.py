"""UTC timestamp contract: stored naive-UTC datetimes must serialize with an
explicit offset so browsers render the true local time.

Regression test for the "4 pm shown instead of 10 pm" bug: the database
holds 16:35 UTC (10:05 pm IST) and the API must emit "16:35:xx+00:00",
never a bare naive ISO string that browsers misread as local time.
"""
import os
import sys
import tempfile
from datetime import datetime, timezone

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/timestamps_utc_tests.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.database import utc_iso
from backend.routes.chat import format_ts
from backend.schemas import WaterReadingResponse


def test_utc_iso_naive_gets_offset():
    assert utc_iso(datetime(2026, 9, 23, 16, 35, 13)) == "2026-09-23T16:35:13+00:00"


def test_utc_iso_none_and_str_passthrough():
    assert utc_iso(None) is None
    assert utc_iso("2026-09-23T16:35:13+00:00") == "2026-09-23T16:35:13+00:00"


def test_utc_iso_aware_kept():
    aware = datetime(2026, 9, 23, 16, 35, 13, tzinfo=timezone.utc)
    assert utc_iso(aware) == "2026-09-23T16:35:13+00:00"


def test_reading_response_carries_offset():
    payload = WaterReadingResponse(
        id=1, device_id=1, temperature=25.4, ph=7.11,
        turbidity=0.83, tds=0.0,
        recorded_at=datetime(2026, 9, 23, 16, 35, 13),
    ).model_dump(mode="json")
    assert payload["recorded_at"] == "2026-09-23T16:35:13+00:00"
    assert "+00:00" in payload["recorded_at"]


def test_format_ts_converts_to_user_local():
    # 16:35 UTC with IST offset (-330) must read as local night time.
    text = format_ts(datetime(2026, 9, 23, 16, 35, 13), tz_offset_minutes=-330)
    assert "10:05" in text
    assert "pm" in text.lower()


def test_format_ts_without_offset_labels_utc():
    text = format_ts(datetime(2026, 9, 23, 16, 35, 13))
    assert "04:35" in text
    assert "UTC" in text
