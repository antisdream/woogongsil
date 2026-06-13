import pandas as pd
import os

# 1. 경로 설정 (환경에 맞게 수정)
xlsx_file = "exam_bank.xlsx"
image_dir = r"C:\python-src\WebDevelop_project\ExamAppProject\frontend\public\question_image"
output_csv = "exam_bank_final.csv"

# 2. 엑셀 파일 읽기
df = pd.read_excel(xlsx_file)

# 3. 이미지 파일명 확인 및 매핑 함수
def check_image(row):
    # year(4자리) + session(2자리) + info_id(2자리) 조합
    year = str(int(row['year']))
    session = str(int(row['session'])).zfill(2)
    info_id = str(int(row['info_id'])).zfill(2)
    
    img_name = f"{year}{session}{info_id}.png"
    img_path = os.path.join(image_dir, img_name)
    
    # 폴더에 해당 png 파일이 존재하면 파일명 반환, 없으면 빈 값
    if os.path.exists(img_path):
        return img_name
    return None

# 4. 새로운 컬럼 'question_img' 생성 및 적용
df['question_img'] = df.apply(check_image, axis=1)

# 5. 최종 CSV 파일로 저장 (한글 깨짐 방지를 위해 utf-8-sig 사용)
df.to_csv(output_csv, index=False, encoding='utf-8-sig')
print("전처리 완료: exam_bank_final.csv 파일이 생성되었습니다.")
