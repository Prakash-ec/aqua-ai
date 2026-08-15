// ==========================================
// AQUA AI FRONTEND
// ==========================================


// ==========================================
// BACKEND
// ==========================================

const API_URL =
    "https://aqua-ai-wz4s.onrender.com";


// ==========================================
// DOM HELPERS
// ==========================================

function setValue(id, value) {

    const element =
        document.getElementById(id);

    if (element) {

        element.textContent =
            value ?? "--";

    }

}


function show(id) {

    const element =
        document.getElementById(id);

    if (element) {

        element.classList.remove("hidden");

    }

}


function hide(id) {

    const element =
        document.getElementById(id);

    if (element) {

        element.classList.add("hidden");

    }

}


// ==========================================
// DATE FORMAT
// ==========================================

function formatDate(dateString) {

    if (!dateString) {

        return "--";

    }

    const date =
        new Date(dateString);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return dateString;

    }

    return date.toLocaleString();

}


// ==========================================
// LOAD SENSOR DATA
// ==========================================

async function loadData() {

    console.log(
        "Fetching Aqua AI data..."
    );


    try {

        const response =
            await fetch(
                `${API_URL}/readings/`
            );


        if (!response.ok) {

            throw new Error(
                `Backend HTTP ${response.status}`
            );

        }


        const readings =
            await response.json();


        console.log(
            "Backend readings:",
            readings
        );


        if (
            !Array.isArray(readings) ||
            readings.length === 0
        ) {

            throw new Error(
                "No sensor readings found"
            );

        }


        const latest =
            readings[0];


        // SENSOR VALUES

        setValue(
            "temperature",
            Number(
                latest.temperature
            ).toFixed(1)
        );


        setValue(
            "ph",
            Number(
                latest.ph
            ).toFixed(2)
        );


        setValue(
            "turbidity",
            Number(
                latest.turbidity
            ).toFixed(1)
        );


        setValue(
            "tds",
            Number(
                latest.tds
            ).toFixed(0)
        );


        // DEVICE

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


        // ONLINE

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


        // QUALITY

        updateQuality(
            Number(latest.temperature),
            Number(latest.ph),
            Number(latest.turbidity),
            Number(latest.tds)
        );


    }
    catch (error) {

        console.error(
            "Aqua AI sensor error:",
            error
        );


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


// ==========================================
// WATER QUALITY
// ==========================================

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


    /*
       These are demonstration thresholds.
       They are NOT laboratory certification limits.
    */


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


        if (status === "NORMAL") {

            badge.style.background =
                "#dcfce7";

            badge.style.color =
                "#15803d";

        }
        else {

            badge.style.background =
                "#fff7ed";

            badge.style.color =
                "#c2410c";

        }

    }


    if (messageElement) {

        messageElement.textContent =
            message;

    }

}


// ==========================================
// IMAGE ELEMENTS
// ==========================================

const imageInput =
    document.getElementById(
        "imageInput"
    );


const cameraInput =
    document.getElementById(
        "cameraInput"
    );


const imagePreview =
    document.getElementById(
        "imagePreview"
    );


let selectedFile =
    null;


// ==========================================
// HANDLE IMAGE
// ==========================================

function handleImage(file) {

    if (!file) {

        return;

    }


    console.log(
        "Selected image:",
        file.name
    );


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


    selectedFile =
        file;


    const imageURL =
        URL.createObjectURL(
            file
        );


    imagePreview.src =
        imageURL;


    show(
        "previewContainer"
    );


    hide(
        "aiResult"
    );


    hide(
        "aiError"
    );

}


// ==========================================
// FILE INPUT
// ==========================================

if (imageInput) {

    imageInput.addEventListener(
        "change",
        function () {

            handleImage(
                this.files[0]
            );

        }
    );

}


// ==========================================
// CAMERA INPUT
// ==========================================

if (cameraInput) {

    cameraInput.addEventListener(
        "change",
        function () {

            handleImage(
                this.files[0]
            );

        }
    );

}


// ==========================================
// ANALYZE BUTTON
// ==========================================

const analyzeButton =
    document.getElementById(
        "analyzeButton"
    );


if (analyzeButton) {

    analyzeButton.addEventListener(
        "click",
        analyzeWaterImage
    );

}


// ==========================================
// AI CAMERA ANALYSIS
// ==========================================

async function analyzeWaterImage() {

    if (!selectedFile) {

        showAIError(
            "Please select a water image first."
        );

        return;

    }


    console.log(
        "Sending image to:",
        `${API_URL}/camera/analyze`
    );


    hide(
        "aiError"
    );


    hide(
        "aiResult"
    );


    show(
        "aiLoading"
    );


    analyzeButton.disabled =
        true;


    try {

        const formData =
            new FormData();


        /*
         IMPORTANT:

         This name MUST match your FastAPI
         parameter:

         image: UploadFile = File(...)
        */

        formData.append(
            "image",
            selectedFile
        );


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


        const text =
            await response.text();


        console.log(
            "AI raw response:",
            text
        );


        let data;


        try {

            data =
                JSON.parse(text);

        }
        catch {

            throw new Error(
                "Backend returned invalid JSON."
            );

        }


        if (!response.ok) {

            throw new Error(
                data.detail ||
                `AI request failed (${response.status})`
            );

        }


        console.log(
            "AI response:",
            data
        );


        /*
         Your backend may return:

         {
             success: true,
             model: "...",
             analysis: {
                 ...
             }
         }

         Therefore extract analysis.
        */

        const analysis =
            data.analysis ||
            data;


        displayAIResult(
            analysis,
            data.model
        );


    }
    catch (error) {

        console.error(
            "AI analysis error:",
            error
        );


        showAIError(
            error.message ||
            "AI analysis failed."
        );

    }
    finally {

        hide(
            "aiLoading"
        );


        analyzeButton.disabled =
            false;

    }

}


// ==========================================
// DISPLAY AI RESULT
// ==========================================

function displayAIResult(
    analysis,
    model
) {

    console.log(
        "Displaying AI analysis:",
        analysis
    );


    // OBSERVATION

    setValue(
        "overallObservation",
        analysis.overall_observation ||
        "No observation returned."
    );


    // OIL

    setValue(
        "oilSheen",
        analysis.oil_sheen ||
        "Uncertain"
    );


    // ALGAE

    setValue(
        "algae",
        analysis.algae ||
        "Uncertain"
    );


    // FOAM

    setValue(
        "foam",
        analysis.foam ||
        "Uncertain"
    );


    // PARTICLES

    setValue(
        "floatingParticles",
        analysis.floating_particles ||
        "Uncertain"
    );


    // WATER APPEARANCE

    setValue(
        "waterAppearance",
        analysis.water_appearance ||
        "Uncertain"
    );


    // POLLUTION

    setValue(
        "pollutionConcern",
        analysis.pollution_concern ||
        "Uncertain"
    );


    // RECOMMENDATION

    setValue(
        "recommendation",
        analysis.recommendation ||
        "Further investigation is recommended."
    );


    // LIMITATIONS

    setValue(
        "limitations",
        analysis.limitations ||
        "Visual screening cannot chemically confirm pollution."
    );


    // CONFIDENCE

    let confidence =
        analysis.confidence;


    if (
        typeof confidence === "number"
    ) {

        confidence =
            Math.round(
                confidence
            );

        setValue(
            "confidenceBadge",
            `${confidence}%`
        );

    }
    else {

        setValue(
            "confidenceBadge",
            "--"
        );

    }


    // SHOW RESULT

    show(
        "aiResult"
    );


    // SCROLL TO RESULT

    document
        .getElementById(
            "aiResult"
        )
        ?.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });


    console.log(
        "AI model:",
        model || "Backend selected model"
    );

}


// ==========================================
// AI ERROR
// ==========================================

function showAIError(
    message
) {

    const error =
        document.getElementById(
            "aiError"
        );


    if (!error) {

        return;

    }


    error.textContent =
        "❌ " + message;


    show(
        "aiError"
    );


    hide(
        "aiLoading"
    );

}


// ==========================================
// NEW ANALYSIS
// ==========================================

const newAnalysisButton =
    document.getElementById(
        "newAnalysisButton"
    );


if (newAnalysisButton) {

    newAnalysisButton.addEventListener(
        "click",
        function () {

            selectedFile =
                null;


            if (imageInput) {

                imageInput.value =
                    "";

            }


            if (cameraInput) {

                cameraInput.value =
                    "";

            }


            if (imagePreview) {

                imagePreview.src =
                    "";

            }


            hide(
                "previewContainer"
            );


            hide(
                "aiResult"
            );


            hide(
                "aiError"
            );


            window.scrollTo({
                top: document
                    .querySelector(
                        ".ai-section"
                    )
                    .offsetTop,
                behavior: "smooth"
            });

        }
    );

}


// ==========================================
// INITIAL LOAD
// ==========================================

loadData();


// ==========================================
// AUTO REFRESH
// ==========================================

setInterval(
    loadData,
    5000
);