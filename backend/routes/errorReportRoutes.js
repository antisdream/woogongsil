// errorReportRoutes.js
// 문제 오류신고 메일 전송 전용 라우터
// 기존 회원, 문제, 게시판 로직과 분리해서 오류신고 기능만 담당합니다.

const express = require("express");
const nodemailer = require("nodemailer");

const router = express.Router();

/**
 * 문자열 앞뒤 공백 제거용 함수
 * .env 값에 실수로 공백이 들어가도 메일 인증 오류를 줄이기 위한 처리입니다.
 */
function clean(value) {
  return String(value || "").trim();
}

/**
 * 이메일처럼 보이는 값인지 간단히 확인
 * replyTo에 잘못된 값이 들어가면 Gmail 전송이 실패할 수 있으므로 방어 처리합니다
 */
function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

/**
 * 오류신고 실제 처리 함수
 * "/" 와 "/send" 두 주소를 모두 지원해서
 * 프론트엔드 요청 경로가 달라도 오류 제보 기능이 같은 방식으로 처리되도록 합니다.
 */
async function sendErrorReport(req, res) {
  console.log("\n[오류신고 POST 실제 수신]");
  console.log("[요청 body]", req.body);

  try {
    const mailUser = clean(process.env.MAIL_USER);
    const mailPassword = clean(process.env.MAIL_APP_PASSWORD);
    const mailFromName = clean(process.env.MAIL_FROM_NAME) || "우공실 오류신고";
    const reportTo = clean(process.env.ERROR_REPORT_TO) || mailUser;

    console.log("[메일 환경변수 실제 확인]", {
      hasMailUser: Boolean(mailUser),
      hasMailPassword: Boolean(mailPassword),
      reportTo,
    });

    // 환경변수가 비어 있으면 Gmail에 요청하기 전에 바로 원인 반환합니다
    if (!mailUser || !mailPassword || !reportTo) {
      return res.status(500).json({
        ok: false,
        message: "메일 환경변수가 비어 있습니다.",
        detail:
          "backend/.env의 MAIL_USER, MAIL_APP_PASSWORD, ERROR_REPORT_TO 값을 확인해 주세요.",
      });
    }

    const body = req.body || {};

    // 프론트 파일마다 필드명이 달라도 받을 수 있도록 여러 이름을 허용합니다
    const sender =
      clean(body.senderEmail) ||
      clean(body.sender) ||
      clean(body.from) ||
      clean(body.userEmail) ||
      "이메일 미확인 사용자";

    const loginId =
      clean(body.loginId) ||
      clean(body.userId) ||
      clean(body.username) ||
      clean(body.memberId) ||
      "로그인 ID 미확인";

    const subject =
      clean(body.subject) ||
      clean(body.title) ||
      "[오류신고] 우공실 문제 오류 신고";

    const message =
      clean(body.message) ||
      clean(body.content) ||
      clean(body.errorContent) ||
      clean(body.reportContent) ||
      clean(body.description);

    const page =
      clean(body.page) ||
      clean(body.examType) ||
      clean(body.source) ||
      "페이지 정보 없음";

    const questionInfo =
      clean(body.questionInfo) ||
      clean(body.problemInfo) ||
      clean(body.meta) ||
      "";

    // 오류 내용이 없으면 메일을 보내지 않고 사용자에게 안내
    if (!message) {
      return res.status(400).json({
        ok: false,
        message: "오류 내용이 비어 있습니다.",
      });
    }

    /**
     * Gmail SMTP 전송 설정
     * service: "gmail" 방식이 가장 단순하고 안정적입니다.
     */
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: mailUser,
        pass: mailPassword,
      },
    });

    /**
     * Gmail 로그인 가능 여부를 먼저 검사
     * 여기서 실패하면 앱 비밀번호 문제일 가능성이 높다.
     */
    await transporter.verify();
    console.log("[Gmail SMTP 인증 성공]");

    const textBody = `
[우공실 문제 오류신고]

발신자: ${sender}
로그인 ID: ${loginId}
수신자: ${reportTo}

페이지/구분: ${page}
문제 정보: ${questionInfo || "없음"}

제목:
${subject}

오류 내용:
${message}

전송 시각:
${new Date().toLocaleString("ko-KR")}
`;

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2> 우공실 문제 오류신고</h2>

        <p><b>발신자:</b> ${sender}</p>
        <p><b>로그인 ID:</b> ${loginId}</p>
        <p><b>수신자:</b> ${reportTo}</p>

        <hr />

        <p><b>페이지/구분:</b> ${page}</p>
        <p><b>문제 정보:</b> ${questionInfo || "없음"}</p>

        <h3>제목</h3>
        <p>${subject}</p>

        <h3>오류 내용</h3>
        <pre style="white-space: pre-wrap; background:#f5f5f5; padding:12px; border-radius:8px;">${message}</pre>

        <p><b>전송 시각:</b> ${new Date().toLocaleString("ko-KR")}</p>
      </div>
    `;

    const mailOptions = {
      from: `"${mailFromName}" <${mailUser}>`,
      to: reportTo,
      subject,
      text: textBody,
      html: htmlBody,
    };

    // 발신자가 실제 이메일이면 답장 주소로 넣는다.
    // 이메일 형식이 아니면 Gmail 전송 실패 방지를 위해 replyTo를 생략합니다.
    if (isValidEmail(sender)) {
      mailOptions.replyTo = sender;
    }

    const info = await transporter.sendMail(mailOptions);

    console.log("[오류신고 메일 전송 성공]", {
      messageId: info.messageId,
      accepted: info.accepted,
      response: info.response,
    });

    return res.json({
      ok: true,
      message: "관리자에게 오류신고 제출이 완료되었습니다.",
      messageId: info.messageId,
    });
  } catch (error) {
    console.error("[오류신고 메일 전송 실패]");
    console.error("name:", error.name);
    console.error("code:", error.code);
    console.error("command:", error.command);
    console.error("response:", error.response);
    console.error("message:", error.message);

    return res.status(500).json({
      ok: false,
      message: "오류신고 제출에 실패했습니다. 서버 메일 설정을 확인해 주세요.",
      detail: error.message,
      code: error.code || null,
      command: error.command || null,
      response: error.response || null,
    });
  }
}

// 프론트에서 /api/error-report 로 보내는 경우
router.post("/", sendErrorReport);

// 혹시 프론트에서 /api/error-report/send 로 보내는 경우도 같이 허용합니다
router.post("/send", sendErrorReport);

module.exports = router;
