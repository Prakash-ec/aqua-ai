import { JSDOM } from "jsdom";
import fs from "fs";

// Read the app.js file
const appJs = fs.readFileSync("D:/aqua-ai/frontend/app.js", "utf8");
const indexHtml = fs.readFileSync("D:/aqua-ai/frontend/index.html", "utf8");

// Create a JSDOM environment
const dom = new JSDOM(indexHtml, {
    url: "http://127.0.0.1:5500/#analysis",
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
});

// Get the window object
const window = dom.window;
global.window = window;
global.document = window.document;
// Don't override navigator and fetch - JSDOM provides them

// Execute the app.js code
try {
    const script = window.document.createElement("script");
    script.textContent = appJs;
    window.document.head.appendChild(script);
    
    // Wait for DOMContentLoaded and initialization
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log("=== TEST RESULTS ===");
    console.log("latestReading:", window.latestReading);
    console.log("isAuthenticated:", window.isAuthenticated);
    console.log("currentUser:", window.currentUser);
} catch (error) {
    console.error("Error:", error);
}