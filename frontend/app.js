// ============================================================
// AQUA AI FRONTEND
// Sensor Dashboard + AI Camera Analysis
// ============================================================


// ============================================================
// BACKEND URL
// ============================================================

const API_URL = "https://aqua-ai-wz4s.onrender.com";


// ============================================================
// LOAD LATEST SENSOR DATA
// ============================================================

async function loadData() {

    try {

        console.log("Fetching Aqua AI data...");

        const response = await fetch(
            `${API_URL}/readings/`
        );

        if (!response.ok) {

            throw new Error(
                `Backend returned HTTP ${response.status}`
            );

        }

        const readings = await response.json();

        console.log("Backend data:", readings);


        if (
            !Array.isArray(readings) ||
            readings.length === 0
        ) {

            throw new Error(
                "No readings found"
            );

        }


        // Backend sends newest first

        const latest = readings[0];

        console.log(
            "LATEST READING:",
            latest
        );


        // ====================================================
        // SENSOR VALUES
        // ====================================================

        setValue(
            "temperature",
            Number(latest.temperature).toFixed(1)
        );


        setValue(
            "ph",
            Number(latest.ph).toFixed(2)
        );


        setValue(
            "turbidity",
            Number(latest.turbidity).toFixed(1)
        );


        setValue(
            "tds",
            Number(latest.tds).toFixed(0)
        );


        // ====================================================
        // DEVICE INFORMATION
        // ====================================================

        setValue(
            "deviceId",
            latest.device_id
        );


        setValue(
            "readingId",
            latest.id
        );


        setValue(
            "recordedAt",
            formatDate(
                latest.recorded_at
            )
        );


        setValue(
            "updatedAt",
            new Date().toLocaleTimeString()
        );


        // ====================================================
        // CONNECTION STATUS
        // ====================================================

        const connection =
            document.getElementById(
                "connectionStatus"
            );


        if (connection) {

            connection.textContent =
                "● LIVE";

            connection.className =
                "status online";

        }


        // ====================================================
        // QUALITY STATUS
        // ====================================================

        updateQuality(
            Number(latest.temperature),
            Number(latest.ph),
            Number(latest.turbidity),
            Number(latest.tds)
        );


        console.log(
            "Aqua AI dashboard updated successfully."
        );

    }

    catch (error) {

        console.error(
            "Aqua AI error:",
            error
        );


        // ====================================================
        // OFFLINE
        // ====================================================

        const connection =
            document.getElementById(
                "connectionStatus"
            );


        if (connection) {

            connection.textContent =
                "● OFFLINE";

            connection.className =
                "status offline";

        }


        setValue(
            "qualityStatus",
            "NO DATA"
        );


        setValue(
            "qualityMessage",
            "Unable to connect to Aqua AI backend."
        );

    }

}



// ============================================================
// SAFE HTML UPDATE
// ============================================================

function setValue(
    id,
    value
) {

    const element =
        document.getElementById(id);


    if (element) {

        element.textContent =
            value;

    }

}



// ============================================================
// FORMAT DATE
// ============================================================

function formatDate(
    dateString
) {

    if (!dateString) {

        return "--";

    }


    const date =
        new Date(dateString);


    if (
        isNaN(
            date.getTime()
        )
    ) {

        return dateString;

    }


    return date.toLocaleString();

}



// ============================================================
// WATER QUALITY CHECK
// ============================================================

function updateQuality(
    temperature,
    ph,
    turbidity,
    tds
) {

    let status =
        "NORMAL";


    let message =
        "Current readings are within the configured test range.";


    // Demonstration thresholds only.
    // These are NOT official drinking-water standards.

    if (
        ph < 6.5 ||
        ph > 8.5 ||
        turbidity > 5 ||
        tds > 500
    ) {

        status =
            "WARNING";


        message =
            "One or more parameters are outside the configured test range.";

    }


    const badge =
        document.getElementById(
            "qualityStatus"
        );


    const messageElement =
        document.getElementById(
            "qualityMessage"
        );


    if (badge) {

        badge.textContent =
            status;


        if (
            status === "NORMAL"
        ) {

            badge.style.background =
                "#d9f7df";

            badge.style.color =
                "#14752a";

        }

        else {

            badge.style.background =
                "#fff1c7";

            badge.style.color =
                "#8a6200";

        }

    }


    if (messageElement) {

        messageElement.textContent =
            message;

    }

}



// ============================================================
// ============================================================
// CAMERA AI
// ============================================================
// ============================================================


// ============================================================
// CAMERA ELEMENTS
// ============================================================

const waterImage =
    document.getElementById(
        "waterImage"
    );


const analyzeButton =
    document.getElementById(
        "analyzeButton"
    );


const imagePreview =
    document.getElementById(
        "imagePreview"
    );


const imagePreviewContainer =
    document.getElementById(
        "imagePreviewContainer"
    );


const aiLoading =
    document.getElementById(
        "aiLoading"
    );


const aiError =
    document.getElementById(
        "aiError"
    );


const aiResults =
    document.getElementById(
        "aiResults"
    );



// ============================================================
// IMAGE SELECTED
// ============================================================

if (waterImage) {

    waterImage.addEventListener(
        "change",
        function () {

            const file =
                waterImage.files[0];


            if (!file) {

                return;

            }


            console.log(
                "Selected image:",
                file.name
            );


            // ----------------------------------------------
            // Check file type
            // ----------------------------------------------

            if (
                !file.type.startsWith(
                    "image/"
                )
            ) {

                showAIError(
                    "Please select a valid image file."
                );

                return;

            }


            // ----------------------------------------------
            // Check file size
            // ----------------------------------------------

            const maxSize =
                10 * 1024 * 1024;


            if (
                file.size > maxSize
            ) {

                showAIError(
                    "Image is too large. Please choose an image below 10 MB."
                );

                return;

            }


            // ----------------------------------------------
            // Preview image
            // ----------------------------------------------

            const reader =
                new FileReader();


            reader.onload =
                function (event) {

                    if (imagePreview) {

                        imagePreview.src =
                            event.target.result;

                    }


                    if (
                        imagePreviewContainer
                    ) {

                        imagePreviewContainer.style.display =
                            "block";

                    }

                };


            reader.readAsDataURL(
                file
            );


            // ----------------------------------------------
            // Enable analyze button
            // ----------------------------------------------

            if (analyzeButton) {

                analyzeButton.disabled =
                    false;

                analyzeButton.textContent =
                    "🤖 Analyze with AI";

            }


            // ----------------------------------------------
            // Clear previous results
            // ----------------------------------------------

            hideAIError();


            if (aiResults) {

                aiResults.style.display =
                    "none";

            }

        }
    );

}



// ============================================================
// ANALYZE BUTTON
// ============================================================

if (analyzeButton) {

    analyzeButton.addEventListener(
        "click",
        analyzeWaterImage
    );

}



// ============================================================
// ANALYZE WATER IMAGE
// ============================================================

async function analyzeWaterImage() {

    const file =
        waterImage &&
        waterImage.files[0];


    if (!file) {

        showAIError(
            "Please choose a water image first."
        );

        return;

    }


    console.log(
        "Starting AI image analysis..."
    );


    // ========================================================
    // UI: LOADING
    // ========================================================

    if (analyzeButton) {

        analyzeButton.disabled =
            true;

        analyzeButton.textContent =
            "🤖 Analyzing...";

    }


    hideAIError();


    if (aiResults) {

        aiResults.style.display =
            "none";

    }


    if (aiLoading) {

        aiLoading.style.display =
            "block";

    }



    try {

        // ====================================================
        // CREATE FORM DATA
        // ====================================================

        const formData =
            new FormData();


        formData.append(
            "file",
            file
        );


        console.log(
            "Sending image to:",
            `${API_URL}/camera/analyze`
        );


        // ====================================================
        // SEND IMAGE TO BACKEND
        // ====================================================

        const response =
            await fetch(
                `${API_URL}/camera/analyze`,
                {
                    method: "POST",
                    body: formData
                }
            );


        console.log(
            "AI HTTP status:",
            response.status
        );


        // ====================================================
        // READ RESPONSE
        // ====================================================

        const data =
            await response.json();


        console.log(
            "AI response:",
            data
        );


        // ====================================================
        // HANDLE HTTP ERROR
        // ====================================================

        if (!response.ok) {

            throw new Error(
                data.detail ||
                `AI server returned HTTP ${response.status}`
            );

        }


        // ====================================================
        // CHECK SUCCESS
        // ====================================================

        if (
            data.success === false
        ) {

            throw new Error(
                data.analysis ||
                "AI analysis failed."
            );

        }


        // ====================================================
        // DISPLAY RESULT
        // ====================================================

        displayAIResult(
            data
        );

    }

    catch (error) {

        console.error(
            "AI analysis error:",
            error
        );


        showAIError(
            error.message ||
            "Unable to analyze image."
        );

    }

    finally {

        // ====================================================
        // STOP LOADING
        // ====================================================

        if (aiLoading) {

            aiLoading.style.display =
                "none";

        }


        if (analyzeButton) {

            analyzeButton.disabled =
                false;

            analyzeButton.textContent =
                "🤖 Analyze with AI";

        }

    }

}



// ============================================================
// DISPLAY AI RESULT
// ============================================================

function displayAIResult(
    data
) {

    console.log(
        "Displaying AI result:",
        data
    );


    // ========================================================
    // GET ANALYSIS
    // ========================================================

    let analysis =
        data.analysis;


    // --------------------------------------------------------
    // Some backends return analysis as a JSON string.
    // Convert it into an object when necessary.
    // --------------------------------------------------------

    if (
        typeof analysis === "string"
    ) {

        try {

            analysis =
                JSON.parse(
                    analysis
                );

        }

        catch (error) {

            console.log(
                "Analysis is plain text."
            );

        }

    }


    // ========================================================
    // IF ANALYSIS IS STILL TEXT
    // ========================================================

    if (
        typeof analysis === "string"
    ) {

        displayTextAnalysis(
            analysis
        );

        return;

    }


    // ========================================================
    // NORMAL JSON ANALYSIS
    // ========================================================

    if (
        !analysis ||
        typeof analysis !== "object"
    ) {

        throw new Error(
            "AI returned an invalid analysis format."
        );

    }


    // ========================================================
    // WATER IMAGE
    // ========================================================

    setValue(
        "aiWater",
        formatAIValue(
            analysis.is_water_image
        )
    );


    // ========================================================
    // POLLUTION CONCERN
    // ========================================================

    setValue(
        "aiConcern",
        formatAIValue(
            analysis.pollution_concern
        )
    );


    // ========================================================
    // CONFIDENCE
    // ========================================================

    let confidence =
        analysis.confidence;


    if (
        confidence !== undefined &&
        confidence !== null
    ) {

        if (
            typeof confidence === "number"
        ) {

            confidence =
                `${confidence}%`;

        }

    }

    else {

        confidence =
            "Not provided";

    }


    setValue(
        "aiConfidence",
        confidence
    );


    // ========================================================
    // OIL
    // ========================================================

    setValue(
        "aiOil",
        formatAIValue(
            analysis.oil_sheen
        )
    );


    // ========================================================
    // ALGAE
    // ========================================================

    setValue(
        "aiAlgae",
        formatAIValue(
            analysis.algae
        )
    );


    // ========================================================
    // FOAM
    // ========================================================

    setValue(
        "aiFoam",
        formatAIValue(
            analysis.foam
        )
    );


    // ========================================================
    // FLOATING PARTICLES
    // ========================================================

    setValue(
        "aiParticles",
        formatAIValue(
            analysis.floating_particles
        )
    );


    // ========================================================
    // WATER APPEARANCE
    // ========================================================

    setValue(
        "aiAppearance",
        formatAIValue(
            analysis.water_appearance
        )
    );


    // ========================================================
    // OVERALL OBSERVATION
    // ========================================================

    setValue(
        "aiObservation",
        formatAIValue(
            analysis.overall_observation
        )
    );


    // ========================================================
    // RECOMMENDATION
    // ========================================================

    setValue(
        "aiRecommendation",
        formatAIValue(
            analysis.recommendation
        )
    );


    // ========================================================
    // LIMITATIONS
    // ========================================================

    setValue(
        "aiLimitations",
        formatAIValue(
            analysis.limitations
        )
    );


    // ========================================================
    // SHOW RESULTS
    // ========================================================

    if (aiResults) {

        aiResults.style.display =
            "block";

    }


    // ========================================================
    // SCROLL TO RESULT
    // ========================================================

    if (aiResults) {

        setTimeout(
            function () {

                aiResults.scrollIntoView(
                    {
                        behavior: "smooth",
                        block: "start"
                    }
                );

            },
            100
        );

    }

}



// ============================================================
// FORMAT AI VALUE
// ============================================================

function formatAIValue(
    value
) {

    if (
        value === undefined ||
        value === null
    ) {

        return "Not provided";

    }


    if (
        typeof value === "boolean"
    ) {

        return value
            ? "Yes"
            : "No";

    }


    if (
        typeof value === "object"
    ) {

        try {

            return JSON.stringify(
                value
            );

        }

        catch (error) {

            return "Unable to display";

        }

    }


    const text =
        String(value).trim();


    if (!text) {

        return "Not provided";

    }


    return text;

}



// ============================================================
// DISPLAY TEXT ANALYSIS
// ============================================================

function displayTextAnalysis(
    text
) {

    const cleanText =
        String(text).trim();


    setValue(
        "aiWater",
        "Analyzed"
    );


    setValue(
        "aiConcern",
        "See analysis"
    );


    setValue(
        "aiConfidence",
        "Not provided"
    );


    setValue(
        "aiOil",
        "See analysis"
    );


    setValue(
        "aiAlgae",
        "See analysis"
    );


    setValue(
        "aiFoam",
        "See analysis"
    );


    setValue(
        "aiParticles",
        "See analysis"
    );


    setValue(
        "aiAppearance",
        cleanText
    );


    setValue(
        "aiObservation",
        cleanText
    );


    setValue(
        "aiRecommendation",
        "Review the AI analysis and perform laboratory testing for confirmation."
    );


    setValue(
        "aiLimitations",
        "Visual AI screening cannot chemically confirm pollution."
    );


    if (aiResults) {

        aiResults.style.display =
            "block";

    }

}



// ============================================================
// SHOW AI ERROR
// ============================================================

function showAIError(
    message
) {

    console.error(
        "AI ERROR:",
        message
    );


    if (!aiError) {

        return;

    }


    aiError.textContent =
        `❌ ${message}`;


    aiError.style.display =
        "block";

}



// ============================================================
// HIDE AI ERROR
// ============================================================

function hideAIError() {

    if (aiError) {

        aiError.textContent =
            "";

        aiError.style.display =
            "none";

    }

}



// ============================================================
// INITIAL SENSOR LOAD
// ============================================================

loadData();



// ============================================================
// LIVE SENSOR UPDATE
// ============================================================

// Fetch latest ESP32 reading every 5 seconds

setInterval(
    loadData,
    5000
);