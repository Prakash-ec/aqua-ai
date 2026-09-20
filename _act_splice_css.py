"""
Replace the old Analysis CSS block (frontend/style.css lines 5344..EOF,
including the stray double-quote that invalidated every rule after it)
with the redesigned Analysis stylesheet in _act_analysis_css.css.
CRLF line endings are preserved.
"""
import shutil

CSS = "frontend/style.css"
BLOCK = "_act_analysis_css.css"
BACKUP = "_act_style_css.bak"
START_LINE = 5344  # first line of the "ANALYSIS PAGE - NEW STYLES" banner

with open(CSS, encoding="utf-8-sig", newline="") as handle:
    source = handle.read()

lines = source.split("\r\n")

assert lines[5342].strip() == "", repr(lines[5342])
assert lines[5343].startswith("/* ===="), lines[5343]
assert "ANALYSIS PAGE" in lines[5344], lines[5344]
assert lines[5345].strip().startswith("===="), lines[5345]
assert len(lines) == 5881, len(lines)

with open(BLOCK, encoding="utf-8", newline="") as handle:
    block = handle.read()

block_lines = block.replace("\r\n", "\n").split("\n")
while block_lines and block_lines[-1].strip() == "":
    block_lines.pop()

shutil.copyfile(CSS, BACKUP)

new_lines = lines[:START_LINE - 1] + block_lines
output = "\r\n".join(new_lines)

if not output.endswith("\r\n"):
    output += "\r\n"

with open(CSS, "w", encoding="utf-8", newline="") as handle:
    handle.write(output)

print("CSS spliced OK")
print("old line count:", len(lines))
print("block line count:", len(block_lines))
print("new line count:", len(new_lines))