import re

with open('frontend/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

helper_code = """
function parseApiTimestamp(timestampStr) {
    if (!timestampStr) return NaN;
    if (typeof timestampStr === 'number') return timestampStr;
    let str = String(timestampStr).trim();
    if (/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?$/.test(str)) {
        str += "Z";
    } else if (/^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}(\\.\\d+)?$/.test(str)) {
        str = str.replace(" ", "T") + "Z";
    }
    return new Date(str).getTime();
}
"""

# Insert helper code right before formatTrendTime
content = content.replace("function formatTrendTime(value) {", helper_code + "\nfunction formatTrendTime(value) {")

# 1. formatTrendTime internal conversion
content = content.replace(
    "const date = new Date(value);",
    "const date = new Date(parseApiTimestamp(value));"
)

# 2. sortReadingsChronologically
# time: reading.recorded_at ? new Date(reading.recorded_at).getTime() : NaN
content = content.replace(
    "time: reading.recorded_at ? new Date(reading.recorded_at).getTime() : NaN",
    "time: parseApiTimestamp(reading.recorded_at)"
)

# 3. drawTrendChart
# reading.recorded_at ? new Date(reading.recorded_at).getTime() : NaN
content = content.replace(
    "reading.recorded_at ? new Date(reading.recorded_at).getTime() : NaN",
    "parseApiTimestamp(reading.recorded_at)"
)

# 4. filterTrendsByRange
# const timestamp = new Date(reading.recorded_at).getTime();
content = content.replace(
    "const timestamp = new Date(reading.recorded_at).getTime();",
    "const timestamp = parseApiTimestamp(reading.recorded_at);"
)

# 5. renderTrendChart
content = content.replace(
    """const time = reading?.recorded_at
            ? new Date(reading.recorded_at).getTime()
            : NaN;""",
    """const time = parseApiTimestamp(reading?.recorded_at);"""
)

# 6. renderTrendsPage
content = content.replace(
    "reading.recorded_at ? new Date(reading.recorded_at).getTime() : NaN",
    "parseApiTimestamp(reading.recorded_at)"
)

# Also check for reading?.recorded_at ? new Date(reading.recorded_at).getTime() : NaN
content = content.replace(
    "reading?.recorded_at ? new Date(reading.recorded_at).getTime() : NaN",
    "parseApiTimestamp(reading?.recorded_at)"
)

# Wait, check if there's any other "new Date(reading.recorded_at)" in the Trends file area
lines = content.split('\\n')
for i, line in enumerate(lines):
    if 'recorded_at' in line and 'new Date' in line and (1600 < i < 2800):
        print(f"Warning: missed a line at {i}: {line}")

with open('frontend/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
