/*
 * Mini JS lexer that records the brace depth at the start of every line.
 * Used to find statements accidentally nested inside a stray block (which
 * makes function declarations block-scoped and therefore invisible to
 * `typeof fn === "function"` guards).
 *
 * Usage: node _act_scopescan.cjs [frontend/app.js] [fromLine] [toLine]
 */
const fs = require("fs");

const file = process.argv[2] || "frontend/app.js";
const fromLine = Number(process.argv[3] || 0);
const toLine = Number(process.argv[4] || 0);

const src = fs.readFileSync(file, "utf8");
const lines = src.split("\n");
const depthAtLineStart = new Array(lines.length + 1).fill(0);

let depth = 0;
let i = 0;
let lineNo = 1;
let lastSignificant = "";

depthAtLineStart[1] = 0;

while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === "\n") {
        lineNo += 1;
        depthAtLineStart[lineNo] = depth;
        i += 1;
        continue;
    }

    // line comment
    if (ch === "/" && next === "/") {
        while (i < src.length && src[i] !== "\n") i += 1;
        continue;
    }

    // block comment
    if (ch === "/" && next === "*") {
        i += 2;
        while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
            if (src[i] === "\n") {
                lineNo += 1;
                depthAtLineStart[lineNo] = depth;
            }
            i += 1;
        }
        i += 2;
        continue;
    }

    // quoted strings (single line; template literals handled separately)
    if (ch === '"' || ch === "'") {
        const quote = ch;
        i += 1;
        while (i < src.length && src[i] !== "\n") {
            if (src[i] === "\\") i += 1;
            if (src[i] === quote) break;
            i += 1;
        }
        i += 1;
        lastSignificant = quote;
        continue;
    }

    // template literals (multi-line, tracks ${ } nesting)
    if (ch === "`") {
        i += 1;
        let interpolation = 0;
        while (i < src.length) {
            if (src[i] === "\\") { i += 2; continue; }
            if (src[i] === "\n") {
                lineNo += 1;
                depthAtLineStart[lineNo] = depth;
                i += 1;
                continue;
            }
            if (interpolation === 0 && src[i] === "`") { i += 1; break; }
            if (src[i] === "$" && src[i + 1] === "{") { interpolation += 1; i += 2; continue; }
            if (src[i] === "}" && interpolation > 0) { interpolation -= 1; i += 1; continue; }
            i += 1;
        }
        lastSignificant = "`";
        continue;
    }

    // regex literal vs division
    if (ch === "/") {
        if (/[A-Za-z0-9_$\)\]]/.test(lastSignificant)) {
            i += 1;
            lastSignificant = "/";
            continue;
        }
        i += 1;
        while (i < src.length && src[i] !== "\n") {
            if (src[i] === "\\") { i += 2; continue; }
            if (src[i] === "/") { i += 1; break; }
            i += 1;
        }
        lastSignificant = "/";
        continue;
    }

    if (ch === "{") { depth += 1; i += 1; lastSignificant = "{"; continue; }
    if (ch === "}") { depth -= 1; i += 1; lastSignificant = "}"; continue; }

    if (!/\s/.test(ch)) lastSignificant = ch;
    i += 1;
}

console.log(`${file}: final brace depth = ${depth}`);

const out = [];
for (let ln = 1; ln <= lines.length; ln += 1) {
    const text = lines[ln - 1];
    const isTopLevelText = /^[^\s]/.test(text);
    const d = depthAtLineStart[ln];
    if (!toLine && !fromLine) {
        // Report only lines that are written as top-level code (column 0) but
        // are actually nested inside a block: these are the accidental scopes.
        if (isTopLevelText && d > 0 && /^(async\s+function|function|const|let|var|class)/.test(text)) {
            out.push(`NESTED  line ${ln} depth=${d} :: ${text.slice(0, 80)}`);
        }
        continue;
    }
    if (fromLine && ln < fromLine) continue;
    if (toLine && ln > toLine) continue;
    out.push(`line ${ln} depth=${d} :: ${text.slice(0, 90)}`);
}
console.log(out.join("\n"));