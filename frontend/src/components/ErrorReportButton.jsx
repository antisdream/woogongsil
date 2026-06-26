// Shared UI component used across frontend pages.
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

/**
 * 관리자 오류신고 수신 이메일
 * 실제 메일 발송 계정은 백엔드 .env의 MAIL_USER / MAIL_APP_PASSWORD를 사용합니다.
 */
const ADMIN_EMAIL = import.meta.env.VITE_ERROR_REPORT_TO || "운영자 메일은 서버 환경변수로 관리됩니다.";

/**
 * 프론트 개발 서버와 백엔드 서버가 포트가 다를 수 있어서 API 주소를 안전하게 결정합니다.
 *
 * 1) 배포/백엔드에서 프론트를 같이 띄우는 경우:
 *  fetch("/api/error-report") 로 정상 작동
 *
 * 2) Vite 개발 서버(보통 5173)에서 프론트를 따로 띄우는 경우:
 *  http://localhost:5000/api/error-report 로 직접 요청
 *
 * 3) VITE_API_BASE_URL이 있으면 자동 감지한 API 주소보다 우선 사용합니다.
 */
const getApiBaseUrl = () => {
  const envBaseUrl = import.meta.env?.VITE_API_BASE_URL;

  if (envBaseUrl) {
    return envBaseUrl.replace(/\/$/, "");
  }

  const currentPort = window.location.port;

  // Vite 개발 서버에서 실행 중이면 백엔드 5000번 포트로 직접 보냅니다.
  if (currentPort === "5173" || currentPort === "5174") {
    return "http://localhost:5000";
  }

  // 백엔드 서버가 프론트 dist를 같이 제공하는 경우는 상대경로 사용합니다
  return "";
};

/**
 * 로그인할 때 저장된 이메일 키가 프로젝트마다 다를 수 있어서
 * 여러 후보를 순서대로 확인합니다.
 */
const getStoredReporterEmail = () => {
  return (
    localStorage.getItem("userEmail") ||
    localStorage.getItem("email") ||
    localStorage.getItem("loginEmail") ||
    sessionStorage.getItem("userEmail") ||
    sessionStorage.getItem("email") ||
    ""
  );
};

/**
 * 로그인 ID도 저장 위치가 다를 수 있어서 여러 후보를 확인합니다.
 */
const getStoredUserId = () => {
  return (
    localStorage.getItem("userId") ||
    localStorage.getItem("loginId") ||
    localStorage.getItem("id") ||
    sessionStorage.getItem("userId") ||
    sessionStorage.getItem("loginId") ||
    sessionStorage.getItem("id") ||
    ""
  );
};

/**
 * 문제 정보를 사람이 읽기 쉬운 문자열로 변환합니다.
 * 백엔드 메일 본문에서 문제 위치를 명확하게 보여주기 위함입니다.
 */
const buildQuestionInfoText = (questionInfo = {}) => {
  // 기존 페이지(year/round/number)와 멀티플레이 메타데이터(examYear/examSession/subjectName)를 모두 지원합니다.
  const yearValue = questionInfo.examYear || questionInfo.year || questionInfo.source_year;
  const sessionValue = questionInfo.examSession || questionInfo.round || questionInfo.session || questionInfo.source_session;
  const numberValue = questionInfo.questionNo || questionInfo.question_no || questionInfo.number;
  const subjectNo = questionInfo.subjectNo || questionInfo.subject_no;
  const subjectName = questionInfo.subjectName || questionInfo.subject_name || questionInfo.subject;
  const sourceLabel = questionInfo.reportSourceLabel || questionInfo.sourceLabel || questionInfo.examTitle || questionInfo.typeLabel || questionInfo.category;

  if (!yearValue && !sessionValue && sourceLabel) {
    const number = numberValue ? ` / 문항: ${numberValue}` : "";
    const subject = subjectName ? ` / 과목: ${subjectNo ? `${subjectNo}과목 ` : ""}${subjectName}` : (subjectNo ? ` / 과목: ${subjectNo}과목` : "");
    return `${sourceLabel}${number}${subject}`;
  }

  const year = yearValue ? `${yearValue}년` : "연도미상";
  const round = sessionValue ? `${sessionValue}회차` : "회차미상";
  const number = numberValue ? `${numberValue}번` : "문항번호미상";
  const subject = subjectName ? ` / 과목: ${subjectNo ? `${subjectNo}과목 ` : ""}${subjectName}` : (subjectNo ? ` / 과목: ${subjectNo}과목` : "");
  const category = sourceLabel ? ` / 출처: ${sourceLabel}` : "";

  return `${year} ${round} ${number}${subject}${category}`;
};

/**
 * 관리자에게 전달할 실제 오류신고 제목을 생성합니다.
 * 제목은 자동 생성값으로 잠그기 때문에 관리자 메일의 문제 식별 정보가 훼손되지 않습니다.
 */
const buildDefaultTitle = ({ examType, mode, questionInfo }) => {
  return `[오류신고] ${examType} ${mode} - ${buildQuestionInfoText(questionInfo)}`;
};

/**
 * 사용자 모달에는 기출연도/회차/문제번호/과목 정보를 노출하지 않습니다.
 * 실제 문제 식별 정보는 제출 payload의 subject/questionInfo/rawQuestionInfo로 관리자에게만 전달합니다.
 */
const buildUserVisibleTitle = ({ examType, mode }) => {
  return `[오류신고] ${examType} ${mode}`;
};

export default function ErrorReportButton({
  examType = "시험",
  mode = "문제",
  questionInfo = {},
  buttonText = "오류신고",
}) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);

  /**
   * 현재 문제 기준으로 관리자 전달용 제목을 자동 생성합니다.
   * 문제를 넘길 때마다 제목도 바뀌도록 useMemo 사용합니다
   */
  const defaultTitle = useMemo(
    () => buildDefaultTitle({ examType, mode, questionInfo }),
    [examType, mode, questionInfo]
  );

  // 화면 표시용 제목은 문제 식별 메타데이터를 빼고 별도로 관리합니다.
  const userVisibleTitle = useMemo(
    () => buildUserVisibleTitle({ examType, mode }),
    [examType, mode]
  );

  const [title, setTitle] = useState(defaultTitle);

  // /문제를 넘길 때마다 관리자 전달용 제목은 최신 식별값으로 다시 고정합니다.
  useEffect(() => {
    setTitle(defaultTitle);
  }, [defaultTitle]);

  const reporterEmail = getStoredReporterEmail();
  const userId = getStoredUserId();

  const userName =
    localStorage.getItem("userName") ||
    sessionStorage.getItem("userName") ||
    userId ||
    "로그인 사용자";

  const questionInfoText = buildQuestionInfoText(questionInfo);

  const handleOpen = () => {
    /**
     * 문제 오류신고는 누가 신고했는지 확인이 필요하므로 로그인 상태에서만 허용합니다.
     * 기존 기능은 변경하지 않고 신고 버튼 클릭 시점에만 로그인 여부를 검사합니다.
     */
    if (!userId) {
      toast.warn("로그인이 필요한 기능입니다, 회원가입 또는 로그인을 먼저 해주세요.");
      return;
    }

    setTitle(buildDefaultTitle({ examType, mode, questionInfo }));
    setContent("");
    setOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!content.trim()) {
      toast.warn("오류 내용을 입력해주세요.");
      return;
    }

    setLoading(true);

    try {
      const apiBaseUrl = getApiBaseUrl();

      /**
       * 중요:
       * 백엔드 errorReportRoutes.js가 curl 테스트에서 받던 필드명은
       * senderEmail, loginId, subject, message, page, questionInfo 입니다.
       *
       * 그래서 아래 payload는 백엔드가 바로 읽을 수 있는 이름으로 맞췄습니다.
       * 동시에 기존에 혹시 다른 코드가 reporterEmail/title/content를 쓰고 있을 가능성도 있어서
       * 호환용 필드도 함께 보냅니다.
       */
      const payload = {
        // 백엔드 실제 사용용 필드
        senderEmail: reporterEmail || "이메일 확인 필요",
        loginId: userId,
        subject: title,
        message: content.trim(),
        page: `${examType} ${mode}`,
        questionInfo: questionInfoText,

        // 참고 정보
        receiverEmail: ADMIN_EMAIL,
        userName,
        pageUrl: window.location.href,

        // 기존 프론트 호환용 필드
        reporterEmail: reporterEmail || "이메일 확인 필요",
        userId,
        title,
        content: content.trim(),
        examType,
        mode,
        rawQuestionInfo: questionInfo,
      };

      const res = await fetch(`${apiBaseUrl}/api/error-report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      /**
       * 백엔드는 curl 테스트에서 { ok: true, message: ... } 형태로 응답했습니다.
       * 예전 코드처럼 success만 보면 정상 응답도 실패로 오판할 수 있어서
       * ok와 success를 둘 다 허용합니다.
       */
      const isSuccess = res.ok && (data.ok === true || data.success === true || data.messageId);

      if (!isSuccess) {
        throw new Error(data.message || "오류신고 전송 실패");
      }

      setOpen(false);
      toast.success("관리자에게 오류신고 제출이 완료되었습니다.");
    } catch (err) {
      console.error("[오류신고 프론트 전송 실패]", err);
      toast.error("오류신고 제출에 실패했습니다. 다시 시도해주시기 바랍니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button" className="wgs-error-report-btn" onClick={handleOpen}
        style={{
          marginLeft: "auto",
          padding: "6px 10px",
          borderRadius: "8px",
          border: "1px solid #ff4d4f",
          background: "#ff3b3b",
          color: "white",
          fontWeight: 800,
          fontSize: "0.82rem",
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(255, 59, 59, 0.25)",
          whiteSpace: "nowrap",
        }}
      >
         {buttonText}
      </button>

      {open && (
        <div
          role="dialog" aria-modal="true" style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.62)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "18px",
          }}
          onClick={() => !loading && setOpen(false)}
        >
          <form
            onSubmit={handleSubmit}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(560px, 100%)",
              background: "#20283a",
              color: "white",
              border: "1px solid #00c896",
              borderRadius: "14px",
              padding: "20px",
              boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                marginBottom: "14px",
              }}
            >
              <h2 style={{ margin: 0, color: "#ffd43b", fontSize: "1.35rem" }}>
                 문제 오류신고
              </h2>

              <button
                type="button" onClick={() => !loading && setOpen(false)}
                style={{
                  marginLeft: "auto",
                  background: "transparent",
                  border: 0,
                  color: "#ddd",
                  fontSize: "0.95rem",
                  fontWeight: 800,
                  padding: "4px 8px",
                  cursor: "pointer",
                }}
              >
                닫기
              </button>
            </div>

            <label style={labelStyle}>발신자</label>
            <input
              value={reporterEmail || `로그인 ID: ${userId}`}
              readOnly
              style={inputStyle}
            />

            <label style={labelStyleWithMargin}>수신자</label>
            <input value={ADMIN_EMAIL} readOnly style={inputStyle} />

            <label style={labelStyleWithMargin}>제목</label>
            {/* 제목은 수정 불가를 유지하되, 사용자에게는 문제 식별 메타데이터를 숨긴 제목만 보여줍니다. */}
            <div
              aria-readonly="true" title="제목은 자동 생성되며 수정할 수 없습니다. 문제 식별 정보는 관리자에게만 전달됩니다." style={{
                ...inputStyle,
                cursor: "default",
                opacity: 0.96,
                display: "flex",
                alignItems: "center",
                minHeight: 44,
                userSelect: "text",
              }}
            >
              {userVisibleTitle}
            </div>

            <label style={labelStyleWithMargin}>오류 내용</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value.slice(0, 800))}
              placeholder="예시: 문제 지문에서 NN이 아니라 NN이 맞지 않나요? / 2번 보기가 오타인 것 같습니다. / <보기> 이미지가 보이지 않습니다." rows={7}
              style={{
                ...inputStyle,
                resize: "vertical",
                lineHeight: 1.5,
              }}
            />

            <div
              style={{
                textAlign: "right",
                color: "#9fb3d0",
                fontSize: "0.85rem",
              }}
            >
              {content.length}/800
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
                marginTop: "14px",
              }}
            >
              <button
                type="button" onClick={() => setOpen(false)}
                disabled={loading}
                style={cancelButtonStyle}
              >
                취소
              </button>

              <button type="submit" disabled={loading} style={submitButtonStyle}>
                {loading ? "전송 중..." : "오류신고 제출"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

const labelStyle = {
  display: "block",
  marginBottom: "8px",
  fontWeight: 700,
};

const labelStyleWithMargin = {
  display: "block",
  margin: "12px 0 8px",
  fontWeight: 700,
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  background: "#0f1624",
  border: "1px solid #3b4963",
  color: "white",
  borderRadius: "8px",
  padding: "11px 12px",
  outline: "none",
};

const cancelButtonStyle = {
  padding: "10px 16px",
  borderRadius: "8px",
  border: 0,
  background: "#526071",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
};

const submitButtonStyle = {
  padding: "10px 16px",
  borderRadius: "8px",
  border: 0,
  background: "#16c784",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};
