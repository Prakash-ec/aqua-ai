"""
Splice the rewritten Analysis implementation into frontend/app.js.

Replaces lines 2934-3893 (the old, broken Analysis block plus the stray
closing brace that accidentally nested it inside renderCameraResult) with
the reviewed implementation in _act_new_analysis.js.

CRLF line endings are preserved.
"""
import shutil
import sys

APP = "frontend/app.js"
BLOCK = "_act_new_analysis.js"
BACKUP = "_act_app_js.bak"

START_LINE = 2934  # first line of the old Analysis block
END_LINE = 3893    # last line of the old block (comments before prettifyKey)

with open(APP, encoding="utf-8", newline="") as handle:
    source = handle.read()

lines = source.split("\r\n")

assert lines[2929].strip() == "`;", lines[2929]
assert lines[2930].strip() == "}", lines[2930]
assert lines[2932].strip() == "", lines[2932]
assert lines[2933].startswith("// ====="), lines[2933]
assert lines[2934].strip() == "// ANALYSIS PAGE LOGIC", lines[2934]
assert lines[3864].strip() == "}", lines[3864]
assert lines[3865].startswith("function setupAnalysisTabs"), lines[3865]
assert lines[3888].strip() == "}", lines[3888]
assert lines[3890].startswith("// Call setupAnalysisTabs"), lines[3890]
assert lines[3891].startswith("// This will be called from initializeApp"), lines[3891]
assert lines[3892] == "", repr(lines[3892])
assert lines[3893] == "", repr(lines[3893])
assert lines[3894].startswith("function prettifyKey"), lines[3894]

with open(BLOCK, encoding="utf-8", newline="") as handle:
    block = handle.read()

block_lines = block.replace("\r\n", "\n").split("\n")

while block_lines and block_lines[-1].strip() == "":
    block_lines.pop()

shutil.copyfile(APP, BACKUP)

new_lines = lines[:START_LINE - 1] + block_lines + lines[END_LINE:]
output = "\r\n".join(new_lines)

if not output.endswith("\r\n"):
    output += "\r\n"

with open(APP, "w", encoding="utf-8", newline="") as handle:
    handle.write(output)

print("Spliced OK")
print("old line count:", len(lines))
print("block line count:", len(block_lines))
print("new line count:", len(new_lines))