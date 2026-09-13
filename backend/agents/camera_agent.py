from typing import Any


class CameraAgent:
    """
    Converts camera-AI analysis into clear user-facing responses.
    """

    def __init__(self):
        self.agent_name = "Camera Analysis Agent"

    # =========================================================
    # NORMALIZATION
    # =========================================================

    def _get_value(
        self,
        analysis: dict[str, Any],
        *keys: str,
        default: Any = None,
    ) -> Any:
        """
        Read the first available value from multiple possible keys.
        """

        for key in keys:
            if key in analysis:
                return analysis[key]

        return default

    def normalize_analysis(
        self,
        analysis: dict[str, Any] | None,
    ) -> dict[str, Any]:
        """
        Normalize camera-AI output so older and newer field names
        can both be handled.
        """

        if not isinstance(analysis, dict):
            return {
                "overall_observation": "No valid camera analysis was received.",
                "water_color": "Unknown",
                "foam_detected": False,
                "algae_detected": False,
                "particles_detected": False,
                "possible_microplastics": False,
                "oil_layer_detected": False,
                "risk_level": "Unknown",
                "confidence": None,
                "recommendation": "Capture another clear image for analysis.",
                "limitations": [],
            }

        return {
            "overall_observation": self._get_value(
                analysis,
                "overall_observation",
                "observation",
                "summary",
                default="No overall observation was provided.",
            ),
            "water_color": self._get_value(
                analysis,
                "water_color",
                "color",
                default="Unknown",
            ),
            "foam_detected": bool(
                self._get_value(
                    analysis,
                    "foam_detected",
                    "foam",
                    default=False,
                )
            ),
            "algae_detected": bool(
                self._get_value(
                    analysis,
                    "algae_detected",
                    "algae",
                    default=False,
                )
            ),
            "particles_detected": bool(
                self._get_value(
                    analysis,
                    "particles_detected",
                    "floating_particles",
                    "particles",
                    default=False,
                )
            ),
            "possible_microplastics": bool(
                self._get_value(
                    analysis,
                    "possible_microplastics",
                    "microplastics",
                    default=False,
                )
            ),
            "oil_layer_detected": bool(
                self._get_value(
                    analysis,
                    "oil_layer_detected",
                    "oil_layer",
                    "oil",
                    default=False,
                )
            ),
            "risk_level": self._get_value(
                analysis,
                "risk_level",
                "risk",
                default="Unknown",
            ),
            "confidence": self._get_value(
                analysis,
                "confidence",
                default=None,
            ),
            "recommendation": self._get_value(
                analysis,
                "recommendation",
                "recommendations",
                default="No recommendation was provided.",
            ),
            "limitations": self._get_value(
                analysis,
                "limitations",
                "limitations_and_warnings",
                default=[],
            ),
        }

    # =========================================================
    # ANALYSIS RESPONSE
    # =========================================================

    def answer(
        self,
        analysis: dict[str, Any] | None,
    ) -> dict[str, Any]:
        """
        Generate a structured response from camera-AI output.
        """

        result = self.normalize_analysis(analysis)

        findings: list[str] = []
        warnings: list[str] = []
        recommendations: list[str] = []

        if result["foam_detected"]:
            findings.append("Foam or froth was detected in the image.")
            warnings.append(
                "Visible foam may be associated with organic matter, "
                "detergents, agitation, or other contamination sources."
            )

        if result["algae_detected"]:
            findings.append("Possible algae-like growth was detected.")
            warnings.append(
                "The visible green or algae-like material should be "
                "investigated further."
            )

        if result["particles_detected"]:
            findings.append("Suspended or floating particles were detected.")
            warnings.append(
                "Visible particles may indicate suspended solids or debris."
            )

        if result["possible_microplastics"]:
            findings.append(
                "The image contains particles that may resemble microplastics."
            )
            warnings.append(
                "Microplastics cannot be confirmed reliably from an ordinary "
                "camera image alone."
            )

        if result["oil_layer_detected"]:
            findings.append("A possible oil-like layer was detected.")
            warnings.append(
                "An oil-like appearance should be checked using additional "
                "sampling or suitable laboratory testing."
            )

        if not findings:
            findings.append(
                "No obvious foam, algae-like material, oil-like layer, "
                "or major visible particles were detected."
            )

        risk_level = str(
            result["risk_level"] or "Unknown"
        ).strip().capitalize()

        if risk_level == "High":
            recommendations.append(
                "Avoid relying on this visual result to determine whether "
                "the water is safe to drink or use."
            )
            recommendations.append(
                "Collect a sample and perform suitable water-quality tests."
            )

        elif risk_level == "Medium":
            recommendations.append(
                "Inspect the water source and perform additional sensor "
                "or laboratory checks."
            )

        elif risk_level == "Low":
            recommendations.append(
                "Continue monitoring the water using sensor readings "
                "and periodic visual checks."
            )

        if isinstance(result["recommendation"], list):
            recommendations.extend(
                str(item)
                for item in result["recommendation"]
                if item
            )
        elif result["recommendation"]:
            recommendations.append(
                str(result["recommendation"])
            )

        limitations = result["limitations"]

        if isinstance(limitations, str):
            limitations = [limitations]

        if not isinstance(limitations, list):
            limitations = [str(limitations)]

        return {
            "agent": self.agent_name,
            "summary": result["overall_observation"],
            "water_color": result["water_color"],
            "risk_level": risk_level,
            "confidence": result["confidence"],
            "findings": findings,
            "warnings": warnings,
            "recommendations": recommendations,
            "limitations": limitations,
            "visual_indicators": {
                "foam_detected": result["foam_detected"],
                "algae_detected": result["algae_detected"],
                "particles_detected": result["particles_detected"],
                "possible_microplastics": (
                    result["possible_microplastics"]
                ),
                "oil_layer_detected": result["oil_layer_detected"],
            },
        }

    # =========================================================
    # QUESTION ANSWER
    # =========================================================

    def answer_question(
        self,
        question: str,
        analysis: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Answer a question about a camera analysis without requiring
        another AI provider.
        """

        normalized = self.normalize_analysis(analysis)
        question_text = question.strip().lower()

        if not question_text:
            return {
                "answer": "Please enter a question about the image analysis."
            }

        if "color" in question_text:
            answer = (
                f"The detected water color is "
                f"{normalized['water_color']}."
            )

        elif "foam" in question_text:
            answer = (
                "Foam was detected."
                if normalized["foam_detected"]
                else "Foam was not detected in the image."
            )

        elif "algae" in question_text:
            answer = (
                "Possible algae-like material was detected."
                if normalized["algae_detected"]
                else "Algae-like material was not detected."
            )

        elif "particle" in question_text:
            answer = (
                "Visible particles were detected."
                if normalized["particles_detected"]
                else "Visible particles were not detected."
            )

        elif "microplastic" in question_text:
            answer = (
                "Some particles may resemble microplastics, but an ordinary "
                "image cannot confirm microplastics."
                if normalized["possible_microplastics"]
                else "The image did not show particles specifically flagged "
                "as possible microplastics."
            )

        elif "oil" in question_text:
            answer = (
                "A possible oil-like layer was detected."
                if normalized["oil_layer_detected"]
                else "An oil-like layer was not detected."
            )

        elif "risk" in question_text or "danger" in question_text:
            answer = (
                f"The estimated visual risk level is "
                f"{normalized['risk_level']}."
            )

        elif (
            "safe" in question_text
            or "drink" in question_text
            or "potable" in question_text
        ):
            answer = (
                "A camera image cannot establish whether water is safe to "
                "drink. Use sensor measurements and appropriate laboratory "
                "testing."
            )

        elif (
            "recommend" in question_text
            or "what should" in question_text
            or "next" in question_text
        ):
            answer = (
                normalized["recommendation"]
                if normalized["recommendation"]
                else (
                    "Perform additional sensor measurements and inspect "
                    "the water source."
                )
            )

        else:
            answer = normalized["overall_observation"]

        return {
            "question": question,
            "answer": answer,
            "risk_level": normalized["risk_level"],
            "confidence": normalized["confidence"],
        }