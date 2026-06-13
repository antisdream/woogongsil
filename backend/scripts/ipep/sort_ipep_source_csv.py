# 실기 원본 CSV를 안정적인 가져오기 순서로 정렬합니다.
from pathlib import Path

import pandas as pd


SOURCE_DIR = Path(__file__).resolve().parents[2] / "data" / "ipep" / "source"
DESIRED_COLUMNS = [
    "과목",
    "문제번호",
    "문제지문",
    "문제보기(설명)",
    "문제정답",
    "문제해설",
    "이미지경로",
]


def main():
    for csv_file in sorted(SOURCE_DIR.glob("*.csv")):
        try:
            df = pd.read_csv(csv_file, encoding="utf-8-sig")
            df = df.map(lambda value: value.strip() if isinstance(value, str) else value)

            ordered_columns = [column for column in DESIRED_COLUMNS if column in df.columns]
            output_path = csv_file.with_name(f"sorted_{csv_file.name}")
            df[ordered_columns].to_csv(output_path, index=False, encoding="utf-8-sig")
            print(f"sorted: {output_path}")
        except Exception as exc:
            print(f"failed: {csv_file} ({exc})")


if __name__ == "__main__":
    main()
