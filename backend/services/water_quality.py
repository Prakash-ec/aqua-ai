from typing import Any


# =========================================================
# PARAMETER CLASSIFICATION
# =========================================================

def classify_parameter(
    value: float | None,
    good_min: float,
    good_max: float,
    warning_min: float,
    warning_max: float,
    unit: str,
) -> dict[str, Any]:
    """
    Classify one water-quality parameter.

    Good:
        Value is inside the preferred range.

    Warning:
        Value is outside the preferred range but inside
        the warning range.

    Critical:
        Value is outside the warning range.

    Missing:
        Sensor value is not available.
    """

    if value is None:
        return {
            "status": "Unavailable",
            "message": "Sensor value is not available.",
            "value": None,
            "unit": unit,
            "good_range": {
                "min": good_min,
                "max": good_max,
            },
            "warning_range": {
                "min": warning_min,
                "max": warning_max,
            },
        }

    if good_min <= value <= good_max:
        return {
            "status": "Good",
            "message": "Value is within the preferred range.",
            "value": value,
            "unit": unit,
            "good_range": {
                "min": good_min,
                "max": good_max,
            },
            "warning_range": {
                "min": warning_min,
                "max": warning_max,
            },
        }

    if warning_min <= value <= warning_max:
        return {
            "status": "Warning",
            "message": "Value is outside the preferred range.",
            "value": value,
            "unit": unit,
            "good_range": {
                "min": good_min,
                "max": good_max,
            },
            "warning_range": {
                "min": warning_min,
                "max": warning_max,
            },
        }

    return {
        "status": "Critical",
        "message": "Value is outside the acceptable monitoring range.",
        "value": value,
        "unit": unit,
        "good_range": {
            "min": good_min,
            "max": good_max,
        },
        "warning_range": {
            "min": warning_min,
            "max": warning_max,
        },
    }


# =========================================================
# WATER QUALITY CALCULATION
# =========================================================

def calculate_water_quality(
    temperature: float | None,
    ph: float | None,
    turbidity: float | None,
    tds: float | None,
) -> dict[str, Any]:
    """
    Calculate an application-specific water-quality indicator.

    This score is intended for monitoring and visualization.
    It is not a certified drinking-water safety assessment.
    """

    parameter_results = {
        "temperature": classify_parameter(
            value=temperature,
            good_min=20,
            good_max=30,
            warning_min=10,
            warning_max=35,
            unit="°C",
        ),

        "ph": classify_parameter(
            value=ph,
            good_min=6.5,
            good_max=8.5,
            warning_min=6.0,
            warning_max=9.0,
            unit="pH",
        ),

        "turbidity": classify_parameter(
            value=turbidity,
            good_min=0,
            good_max=5,
            warning_min=0,
            warning_max=10,
            unit="NTU",
        ),

        "tds": classify_parameter(
            value=tds,
            good_min=0,
            good_max=300,
            warning_min=0,
            warning_max=600,
            unit="mg/L",
        ),
    }

    # Equal weights for the four monitored parameters.
    parameter_weights = {
        "temperature": 25,
        "ph": 25,
        "turbidity": 25,
        "tds": 25,
    }

    available_parameters = 0
    total_score = 0.0
    warnings: list[str] = []
    recommendations: list[str] = []

    for parameter, result in parameter_results.items():
        status = result["status"]
        weight = parameter_weights[parameter]

        if status == "Unavailable":
            recommendations.append(
                f"{parameter.capitalize()} sensor data is unavailable. "
                "Check the sensor connection."
            )
            continue

        available_parameters += 1

        if status == "Good":
            parameter_score = weight

        elif status == "Warning":
            parameter_score = weight * 0.5
            warnings.append(
                f"{parameter.capitalize()}: {result['message']}"
            )

        else:
            parameter_score = 0
            warnings.append(
                f"{parameter.capitalize()}: {result['message']}"
            )

        total_score += parameter_score

        if status == "Warning":
            recommendations.append(
                f"Monitor the {parameter} value closely."
            )

        elif status == "Critical":
            recommendations.append(
                f"Investigate the {parameter} value immediately."
            )

    # If no sensor value is available, do not report a misleading score.
    if available_parameters == 0:
        quality_score = None
        overall_status = "Unavailable"
        quality_color = "gray"

    else:
        # Normalize the score based on available parameters.
        available_weight = sum(
            parameter_weights[parameter]
            for parameter, result in parameter_results.items()
            if result["status"] != "Unavailable"
        )

        quality_score = round(
            (total_score / available_weight) * 100
        )

        quality_score = max(
            0,
            min(100, quality_score)
        )

        if quality_score >= 80:
            overall_status = "Good"
            quality_color = "green"

        elif quality_score >= 60:
            overall_status = "Moderate"
            quality_color = "orange"

        elif quality_score >= 40:
            overall_status = "Poor"
            quality_color = "red"

        else:
            overall_status = "Critical"
            quality_color = "dark-red"

    return {
        "quality_score": quality_score,
        "quality_status": overall_status,
        "quality_color": quality_color,
        "parameters": parameter_results,
        "warnings": warnings,
        "recommendations": recommendations,
        "available_parameters": available_parameters,
        "total_parameters": len(parameter_results),
    }