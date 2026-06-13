// 멀티플레이 시험 기능 모듈입니다: multiplayerStyles
export const multiplayerThemeCss = `
  /* 멀티플레이 전용 테마 변수: 기존 전역 App.css 로직은 변경하지 않고 /multiplayer 내부만 보정 */
  #wgs-multiplayer-page {
    --mp-page-bg: #eef6ff;
    --mp-card-bg: #ffffff;
    --mp-card-soft-bg: #f8fbff;
    --mp-input-bg: #ffffff;
    --mp-choice-bg: #e8f1fc;
    --mp-choice-hover-bg: #dcecff;
    --mp-secondary: #475569;
    --mp-text: #0f172a;
    --mp-title-text: #07111f;
    --mp-muted-text: #475569;
    --mp-border: #d7e3f4;
    --mp-border-strong: #b8c8dd;
    --mp-board-bg: #ffffff;
    --mp-board-panel-bg: #f8fbff;
    --mp-board-line: rgba(148,163,184,0.28);
    --mp-shadow: 0 18px 35px rgba(15,23,42,0.08);
  }

  body.wgs-theme-dark #wgs-multiplayer-page {
    --mp-page-bg: #111827;
    --mp-card-bg: #2b3446;
    --mp-card-soft-bg: #1f2937;
    --mp-input-bg: #020b18;
    --mp-choice-bg: #334155;
    --mp-choice-hover-bg: #3f5168;
    --mp-secondary: #64748b;
    --mp-text: #f8fafc;
    --mp-title-text: #ffffff;
    --mp-muted-text: #cbd5e1;
    --mp-border: #475569;
    --mp-border-strong: #64748b;
    --mp-board-bg: #020817;
    --mp-board-panel-bg: #0f1b2d;
    --mp-board-line: rgba(148,163,184,0.16);
    --mp-shadow: 0 18px 38px rgba(0,0,0,0.32);
  }

  body.wgs-theme-light #wgs-multiplayer-page {
    --mp-page-bg: #eef6ff;
    --mp-card-bg: #ffffff;
    --mp-card-soft-bg: #f8fbff;
    --mp-input-bg: #ffffff;
    --mp-choice-bg: #e8f1fc;
    --mp-choice-hover-bg: #dcecff;
    --mp-secondary: #475569;
    --mp-text: #0f172a;
    --mp-title-text: #07111f;
    --mp-muted-text: #475569;
    --mp-border: #d7e3f4;
    --mp-border-strong: #b8c8dd;
    --mp-board-bg: #ffffff;
    --mp-board-panel-bg: #f8fbff;
    --mp-board-line: rgba(148,163,184,0.28);
    --mp-shadow: 0 18px 35px rgba(15,23,42,0.08);
  }

  #wgs-multiplayer-page { background: var(--mp-page-bg); color: var(--mp-text); }
  #wgs-multiplayer-page h1,
  #wgs-multiplayer-page h2,
  #wgs-multiplayer-page h3,
  #wgs-multiplayer-page h4,
  #wgs-multiplayer-page p,
  #wgs-multiplayer-page span,
  #wgs-multiplayer-page label,
  #wgs-multiplayer-page td { color: var(--mp-text); }
  #wgs-multiplayer-page small,
  #wgs-multiplayer-page .mp-muted { color: var(--mp-muted-text) !important; }
  #wgs-multiplayer-page table { width: 100%; border-collapse: collapse; color: var(--mp-text); }
  #wgs-multiplayer-page th, #wgs-multiplayer-page td { border: 1px solid var(--mp-border); padding: 10px 12px; }
  #wgs-multiplayer-page th { background: var(--mp-card-soft-bg); color: var(--mp-title-text); font-weight: 900; }
  #wgs-multiplayer-page td { background: var(--mp-card-bg); }
  #wgs-multiplayer-page input, #wgs-multiplayer-page select { background: var(--mp-input-bg); color: var(--mp-text); border-color: var(--mp-border); }
  #wgs-multiplayer-page button:disabled { opacity: 0.45; cursor: not-allowed; }
  #wgs-multiplayer-page .mp-question-image-wrap { margin: 16px 0 20px; text-align: center; }
  #wgs-multiplayer-page .mp-image-open-btn { display: block; width: 100%; border: 0; background: transparent; padding: 0; cursor: zoom-in; text-align: center; }
  #wgs-multiplayer-page img.mp-question-image, #wgs-multiplayer-page img.mp-choice-image { background: #fff; border: 2px solid var(--mp-border-strong); border-radius: 10px; padding: 8px; max-width: 100%; max-height: 360px; object-fit: contain; }
  #wgs-multiplayer-page .mp-image-open-label { display: inline-flex; align-items: center; justify-content: center; margin-top: 8px; padding: 8px 12px; border-radius: 999px; background: var(--mp-secondary); color: #fff; font-weight: 900; font-size: 13px; box-shadow: 0 8px 18px rgba(15, 23, 42, 0.16); }
  #wgs-multiplayer-page .mp-image-open-btn:hover .mp-image-open-label { filter: brightness(1.05); transform: translateY(-1px); }
  #wgs-multiplayer-page .mp-image-modal-backdrop { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(15, 23, 42, 0.72); }
  #wgs-multiplayer-page .mp-image-modal { width: min(1500px, 97vw); max-height: 92vh; overflow: hidden; border-radius: 18px; background: var(--mp-card-bg); border: 1px solid var(--mp-border); box-shadow: 0 24px 70px rgba(0, 0, 0, 0.35); padding: 18px; }
  #wgs-multiplayer-page .mp-image-modal-head { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: -18px -18px 16px; padding: 14px 18px; background: var(--mp-card-bg); border-bottom: 1px solid var(--mp-border); color: var(--mp-text); }
  #wgs-multiplayer-page .mp-image-modal-head button { border: 0; border-radius: 12px; background: var(--mp-secondary); color: #fff; padding: 10px 14px; font-weight: 900; cursor: pointer; }
  #wgs-multiplayer-page .mp-image-modal-body { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(360px, 0.85fr); gap: 18px; max-height: calc(92vh - 78px); overflow: hidden; }
  #wgs-multiplayer-page .mp-image-modal-viewer { overflow: auto; border-radius: 14px; border: 1px solid var(--mp-border); background: #fff; padding: 18px; }
  #wgs-multiplayer-page .mp-image-modal-viewer img { display: block; width: auto; max-width: 100%; height: auto; max-height: none; margin: 0 auto; object-fit: contain; border-radius: 12px; background: #fff; }
  #wgs-multiplayer-page .mp-image-modal-scratch { min-height: 0; overflow: auto; border: 1px solid var(--mp-border); border-radius: 14px; background: var(--mp-card-soft-bg); padding: 16px; }
  #wgs-multiplayer-page .mp-image-modal-scratch-title { display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; color: var(--mp-text); }
  #wgs-multiplayer-page .mp-image-modal-scratch-title span { color: var(--mp-muted-text); font-size: 13px; line-height: 1.5; }
  @media (max-width: 980px) {
    #wgs-multiplayer-page .mp-image-modal { overflow: auto; }
    #wgs-multiplayer-page .mp-image-modal-body { grid-template-columns: 1fr; max-height: none; overflow: visible; }
    #wgs-multiplayer-page .mp-image-modal-viewer { max-height: 55vh; }
  }
`;

export const pageStyle = { minHeight: '100vh', background: 'var(--mp-page-bg)', padding: '36px 48px', color: 'var(--mp-text)' };
export const headerStyle = { display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'flex-start', marginBottom: 28 };
export const titleStyle = { fontSize: 48, margin: '0 0 10px', fontWeight: 1000, color: 'var(--mp-title-text)' };
export const descStyle = { color: 'var(--mp-muted-text)', lineHeight: 1.8, fontSize: 16 };
export const homeTabBarStyle = { display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 22 };
export const homeTabStyle = { border: '1px solid var(--mp-border)', background: 'var(--mp-card-bg)', color: 'var(--mp-muted-text)', borderRadius: 16, padding: '14px 18px', fontSize: 17, fontWeight: 900, cursor: 'pointer' };
export const activeHomeTabStyle = { ...homeTabStyle, background: 'var(--mp-card-bg)', borderColor: '#8b5cf6', color: '#8b5cf6', boxShadow: '0 8px 22px rgba(139,92,246,0.14)' };
export const homeGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24, marginBottom: 24 };
export const examGridStyle = { display: 'grid', gridTemplateColumns: 'minmax(0, 1.45fr) minmax(380px, 0.85fr)', gap: 24, alignItems: 'stretch' };
export const cardStyle = { background: 'var(--mp-card-bg)', border: '1px solid var(--mp-border)', borderRadius: 20, padding: 28, boxShadow: 'var(--mp-shadow)', marginBottom: 22, color: 'var(--mp-text)' };
export const sectionTitleStyle = { color: '#8b5cf6', marginTop: 0, fontSize: 28 };
export const inputStyle = { width: '100%', border: '1px solid var(--mp-border)', borderRadius: 12, padding: '14px 16px', fontSize: 16, marginBottom: 12, background: 'var(--mp-input-bg)', color: 'var(--mp-text)' };
export const primaryBtn = { border: 0, background: '#10b981', color: '#fff', borderRadius: 14, padding: '14px 18px', fontSize: 17, fontWeight: 900, cursor: 'pointer' };
export const secondaryBtn = { border: 0, background: '#475569', color: '#fff', borderRadius: 14, padding: '14px 18px', fontSize: 17, fontWeight: 900, cursor: 'pointer' };
// 실기 멀티플레이 화면/에러 복구 화면에서 참조하는 스타일 별칭입니다.
// 이전 패치에서 JSX는 fieldStyle/buttonStyle/headerRowStyle/smallBtnStyle을 사용했지만
// 실제 선언이 없어 실기 시험 시작 순간 브라우저 런타임에서 ReferenceError가 발생했습니다.
export const fieldStyle = inputStyle;
export const buttonStyle = primaryBtn;
export const smallBtnStyle = secondaryBtn;
export const dangerBtn = { border: 0, background: '#ef4444', color: '#fff', borderRadius: 12, padding: '10px 14px', fontWeight: 900, cursor: 'pointer' };
export const disabledBtnStyle = { opacity: 0.48, cursor: 'not-allowed', filter: 'grayscale(0.2)' };
export const timerStyle = { color: '#10b981', fontSize: 22, fontWeight: 1000 };
export const buttonRowStyle = { display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: 18 };
export const betweenStyle = { display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', flexWrap: 'wrap' };
export const headerRowStyle = betweenStyle;
export const memberGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 };
export const memberCardStyle = { border: '1px solid var(--mp-border)', borderRadius: 14, padding: 16, background: 'var(--mp-card-soft-bg)', color: 'var(--mp-text)', transition: 'background .15s ease, border-color .15s ease' };
// 참여자 준비 상태를 방장과 다른 사용자도 한눈에 볼 수 있도록 색을 나눴습니다.
export const waitingMemberCardStyle = { background: 'rgba(100, 116, 139, 0.22)', borderColor: 'rgba(148, 163, 184, 0.45)' };
export const readyMemberCardStyle = { background: 'rgba(16, 185, 129, 0.18)', borderColor: 'rgba(16, 185, 129, 0.65)' };
export const agreeGridStyle = { display: 'grid', gap: 14 };
export const agreeButtonStyle = { width: '100%', display: 'grid', gridTemplateColumns: '64px minmax(180px, 240px) 1fr', gap: 16, alignItems: 'center', textAlign: 'left', border: '1px solid var(--mp-border)', borderRadius: 16, padding: '18px 20px', background: 'var(--mp-card-bg)', color: 'var(--mp-text)', fontSize: 16, cursor: 'pointer', lineHeight: 1.75, transition: '0.15s ease' };
// 체크된 안내문은 다크모드에서도 글자가 묻히지 않도록 글자색을 고정합니다.
export const agreeButtonCheckedStyle = { background: '#dcfce7', borderColor: '#86efac', color: '#064e3b', boxShadow: '0 10px 24px rgba(16,185,129,0.12)' };
export const agreeCheckBoxStyle = { width: 38, height: 38, borderRadius: 8, border: '2px solid #94a3b8', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 1000, color: '#fff', background: 'var(--mp-card-bg)' };
export const agreeCheckBoxCheckedStyle = { borderColor: '#10b981', background: '#10b981' };
export const optionBtnStyle = { display: 'block', width: '100%', textAlign: 'left', border: '1px solid var(--mp-border)', background: 'var(--mp-choice-bg)', color: 'var(--mp-text)', borderRadius: 14, padding: '16px 18px', margin: '12px 0', fontSize: 18, fontWeight: 900, cursor: 'pointer' };
// 좌측 문제 카드 높이를 우측 연습장과 맞춰 화면 균형을 유지합니다.
export const questionPanelStyle = { minHeight: 760, display: 'flex', flexDirection: 'column' };
export const scratchPanelStyle = { position: 'sticky', top: 24, minHeight: 760, display: 'flex', flexDirection: 'column' };
export const examQuestionTitleStyle = { fontSize: 24, lineHeight: 1.55, margin: '24px 0 24px' };
export const examOptionWrapStyle = { marginBottom: 26 };
export const textAnswerStyle = { ...inputStyle, minHeight: 110, resize: 'vertical', lineHeight: 1.7, fontFamily: 'inherit' };
export const examOptionBtnStyle = { ...optionBtnStyle, padding: '20px 22px', margin: '14px 0', fontSize: 20, borderRadius: 16 };
export const selectedOptionStyle = { background: '#2563eb', color: '#fff', borderColor: '#2563eb' };
export const correctOptionStyle = { background: '#10b981', color: '#fff', borderColor: '#10b981' };
export const omrPanelStyle = { gridColumn: '1 / -1', marginTop: 0 };
// OMR은 20칸 x 5줄 고정 그리드로 정리해 기본 화면에서 좌우/상하 스크롤이 생기지 않게 했습니다.
export const omrScrollStyle = { overflow: 'hidden', padding: '4px', marginBottom: 18, border: '1px solid var(--mp-border)', borderRadius: 14, background: 'var(--mp-card-soft-bg)' };
export const omrGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(20, minmax(0, 1fr))', gridAutoRows: '44px', gap: 8, width: '100%' };
export const omrBtnStyle = { border: 0, background: '#1f2937', color: '#fff', borderRadius: 10, padding: 8, minWidth: 0, fontSize: 13, fontWeight: 1000, cursor: 'pointer' };
export const omrAnsweredStyle = { background: '#059669' };
export const omrCurrentStyle = { outline: '3px solid #fbbf24' };
export const recordFormStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, alignItems: 'center' };
export const tableWrapStyle = { overflowX: 'auto', marginTop: 20, border: '1px solid var(--mp-border)', borderRadius: 12 };
export const tableStyle = { width: '100%', minWidth: 900, borderCollapse: 'collapse' };
export const badgeStyle = { display: 'inline-flex', borderRadius: 999, padding: '10px 18px', color: '#fff', fontWeight: 900 };
export const wrongPracticeBoxStyle = { border: '1px solid var(--mp-border)', borderRadius: 18, padding: 22, marginTop: 20, background: 'var(--mp-card-bg)', color: 'var(--mp-text)' };
export const questionBoxStyle = { border: '1px solid var(--mp-border)', borderRadius: 14, padding: 18, margin: '16px 0', background: 'var(--mp-card-soft-bg)', color: 'var(--mp-text)', fontWeight: 900, lineHeight: 1.7 };
export const explainBoxStyle = { marginTop: 14, padding: 16, background: 'var(--mp-card-soft-bg)', color: 'var(--mp-text)', borderRadius: 12, lineHeight: 1.8 };
export const subjectGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, margin: '24px 0' };
export const subjectCardStyle = { border: '1px solid var(--mp-border)', borderRadius: 14, padding: 16, textAlign: 'center', background: 'var(--mp-card-bg)', color: 'var(--mp-text)' };
export const passResultStyle = { textAlign: 'center', color: '#10b981', fontSize: 34 };
export const failResultStyle = { textAlign: 'center', color: '#ef4444', fontSize: 34 };
export const resultRoomInfoStyle = { margin: '0 auto 22px', maxWidth: 680, display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap', background: 'var(--mp-card-soft-bg)', border: '1px solid var(--mp-border)', borderRadius: 14, padding: '14px 16px' };
export const noticeStyle = { borderRadius: 14, padding: '14px 18px', marginBottom: 18, fontWeight: 900 };
export const successNoticeStyle = { background: '#dcfce7', color: '#166534' };
export const errorNoticeStyle = { background: '#fee2e2', color: '#991b1b' };
export const modalOverlayStyle = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 };
export const modalBoxStyle = { width: 'min(480px, 100%)', background: 'var(--mp-card-bg)', color: 'var(--mp-text)', borderRadius: 18, padding: 24, boxShadow: '0 25px 50px rgba(15,23,42,0.24)' };
export const modalBackdropStyle = modalOverlayStyle;
export const modalCardStyle = { width: 'min(1280px, 96vw)', maxHeight: '92vh', overflow: 'auto', background: 'var(--mp-card-bg)', color: 'var(--mp-text)', borderRadius: 20, padding: 24, boxShadow: '0 25px 50px rgba(15,23,42,0.28)' };


// 실기 시험 시작 시 프론트 렌더링 오류가 생기면 전체 화면이 백지화되지 않도록
// 멀티플레이 페이지 전용 에러 경계(Error Boundary)를 추가했습니다.
