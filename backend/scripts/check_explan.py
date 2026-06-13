# 가져오기 전에 해설 CSV 구조를 점검합니다.
import pandas as pd
import re
import os
from pathlib import Path


DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "written-explanations"
DATA_DIR.mkdir(parents=True, exist_ok=True)
os.chdir(DATA_DIR)


def data_file(filename):
    return DATA_DIR / filename

# 1. CSV 파일 불러오기
# skipinitialspace=True
# CSV에서 쉼표 뒤 공백으로 인해 따옴표가 잘못 해석되는 문제를 방지합니다.
# 예: , "내용, 쉼표 포함" 형태도 정상적으로 읽을 수 있도록 처리합니다.

exam_df = pd.read_csv(
    data_file("exam_bank_final.csv"),
    encoding="utf-8-sig",
    skipinitialspace=True
)

explan_df = pd.read_csv(
    data_file("explan.csv"),
    encoding="utf-8-sig",
    skipinitialspace=True
)

review_df = pd.read_csv(
    data_file("explan_review_with_question.csv"),
    encoding="utf-8-sig",
    skipinitialspace=True
)


# 2. 컬럼명 공백 정리
# 컬럼명 앞뒤 공백은 비교 오류를 유발할 수 있으므로 제거합니다.

exam_df.columns = exam_df.columns.str.strip()
explan_df.columns = explan_df.columns.str.strip()
review_df.columns = review_df.columns.str.strip()


# 3. 기본 행 개수 확인
print("원본 문제 수:", len(exam_df))
print("explan.csv 행 수:", len(explan_df))
print("review.csv 행 수:", len(review_df))


# 4. 비교 기준 컬럼 설정
# year + session + info_id 조합으로 문제를 구분합니다.
# 예: 2025년 1회차 1번 문제

key_cols = ["year", "session", "info_id"]


# 5. 정답 컬럼 숫자 변환
# 정답 값은 문자열과 숫자를 모두 비교할 수 있도록 숫자로 통일합니다.

exam_df["answer"] = pd.to_numeric(exam_df["answer"], errors="coerce")
explan_df["answer"] = pd.to_numeric(explan_df["answer"], errors="coerce")
review_df["answer"] = pd.to_numeric(review_df["answer"], errors="coerce")


# 6. 중복 문제 확인
# 같은 연도, 회차, 문제번호 조합이 중복되면 DB 적재 시 문제가 발생할 수 있습니다.

exam_dup = exam_df[exam_df.duplicated(key_cols, keep=False)]
explan_dup = explan_df[explan_df.duplicated(key_cols, keep=False)]

print("\n원본 중복 개수:", len(exam_dup))
print("해설 파일 중복 개수:", len(explan_dup))


# 7. 원본 문제와 해설 파일 병합
# 원본 문제와 해설 파일을 year/session/info_id 기준으로 합친다.
# suffixes는 원본 정답과 해설 파일 정답을 구분하기 위해 붙인다.

merged = exam_df.merge(
    explan_df,
    on=key_cols,
    how="left",
    suffixes=("_origin", "_explan")
)

print("\n병합 후 행 수:", len(merged))


# 8. 해설 누락 확인
# explanation이 비어 있거나 NaN이면 누락으로 판단합니다.

missing_explanation = merged[
    merged["explanation"].isna() |
    (merged["explanation"].astype(str).str.strip() == "")
]

print("해설 누락 개수:", len(missing_explanation))


# 9. 정답 불일치 확인
# 원본 CSV의 정답과 해설 CSV의 정답이 다르면 위험한 오류다.

answer_mismatch = merged[
    merged["answer_origin"] != merged["answer_explan"]
]

print("정답 불일치 개수:", len(answer_mismatch))


# 10. 해설 길이 이상값 확인
# 너무 짧으면 부실한 해설일 수 있고,
# 해설이 지나치게 길면 화면 표시나 DB 저장 시 불편할 수 있습니다.

merged["explanation_len"] = merged["explanation"].astype(str).str.len()

too_short = merged[merged["explanation_len"] < 15]
too_long = merged[merged["explanation_len"] > 180]

print("너무 짧은 해설 개수:", len(too_short))
print("너무 긴 해설 개수:", len(too_long))


# 11. 해설 안의 정답 번호 의심 탐지
# 예를 들어 실제 정답은 3번인데,
# 해설에 "정답은 2번"이라고 적혀 있으면 의심 목록에 넣는다.

suspect_rows = []

for _, row in merged.iterrows():
    explanation = str(row["explanation"])

    if pd.isna(row["answer_origin"]):
        continue

    real_answer = str(int(row["answer_origin"]))

    # "정답은 1번", "답은 2번", "3번이 정답" 같은 표현을 찾는다.
    found_numbers = re.findall(
        r"(?:정답은|답은)\s*([1-4])번|([1-4])번(?:이|가)?\s*정답",
        explanation
    )

    numbers = []

    for a, b in found_numbers:
        if a:
            numbers.append(a)
        if b:
            numbers.append(b)

    for num in numbers:
        if num != real_answer:
            suspect_rows.append(row)
            break

suspect_df = pd.DataFrame(suspect_rows)

print("해설 내 정답번호 의심 개수:", len(suspect_df))


# 12. 검수 결과 파일 저장
# 문제가 있는 항목은 별도 CSV로 저장해 엑셀에서 확인할 수 있도록 합니다.

missing_explanation.to_csv(
    "검수_해설누락.csv",
    index=False,
    encoding="utf-8-sig"
)

answer_mismatch.to_csv(
    "검수_정답불일치.csv",
    index=False,
    encoding="utf-8-sig"
)

too_short.to_csv(
    "검수_해설너무짧음.csv",
    index=False,
    encoding="utf-8-sig"
)

too_long.to_csv(
    "검수_해설너무김.csv",
    index=False,
    encoding="utf-8-sig"
)

suspect_df.to_csv(
    "검수_해설정답번호의심.csv",
    index=False,
    encoding="utf-8-sig"
)


# 13. GPT 검수용 랜덤 샘플 생성
# 1500문제를 전부 한 번에 검수하기 어려우므로,
# 랜덤 50문제를 추출해 의미 검수용 샘플로 활용할 수 있도록 합니다.

sample_df = review_df.sample(n=50, random_state=42)

sample_df.to_csv(
    "GPT검수용_랜덤50문제.csv",
    index=False,
    encoding="utf-8-sig"
)

print("\n검수 파일 생성 완료")
