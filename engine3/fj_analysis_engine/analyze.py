import argparse
import json
from pathlib import Path

from .analysis import analyze_audio, quantize_analysis


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze audio into Forever Jukebox analysis JSON")
    parser.add_argument("audio_path")
    parser.add_argument("-o", "--output", required=True)
    parser.add_argument("--calibration", default=None)
    args = parser.parse_args()

    analysis = analyze_audio(args.audio_path, calibration_path=args.calibration)
    analysis = quantize_analysis(analysis)

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as handle:
        json.dump(analysis, handle, indent=2)


if __name__ == "__main__":
    main()
