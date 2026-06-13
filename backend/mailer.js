// 메일 전송 설정과 발송 헬퍼를 한곳에서 관리합니다.
const nodemailer = require('nodemailer');

// Gmail SMTP로 인증번호와 알림 메일을 보냅니다.
// Gmail 주소와 앱 비밀번호는 코드에 직접 쓰지 않고 환경 변수 파일에서 읽습니다.
// 저장소 공개 시 비밀번호가 노출되지 않도록 환경변수만 사용합니다.

// transporter를 매번 새로 만들지 않기 위해 변수에 저장해둡니다.
let transporter = null;

// 실제 메일 발송 객체를 만드는 함수.
function getTransporter() {
    const user = process.env.MAIL_USER;
    const pass = process.env.MAIL_APP_PASSWORD;

    if (!user || !pass) {
        throw new Error('MAIL_USER 또는 MAIL_APP_PASSWORD가 .env에 설정되지 않았습니다.');
    }

    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 465,
            secure: true,
            auth: { user, pass }
        });
    }

    return transporter;
}

// 외부에서 사용하는 메일 발송 함수.
async function sendEmail(to, subject, text) {
    try {
        const mailer = getTransporter();
        const fromName = process.env.MAIL_FROM_NAME || '정보처리기사 스터디';
        const fromEmail = process.env.MAIL_USER;

        const info = await mailer.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to,
            subject,
            text
        });

        console.log('메일 전송 성공:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('메일 전송 실패:', error.message);
        return { success: false, error };
    }
}

module.exports = { sendEmail };
