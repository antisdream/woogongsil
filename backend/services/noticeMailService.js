'use strict';

function createNoticeMailService({ pool, sendEmail } = {}) {
    if (!pool) throw new Error('createNoticeMailService requires mysql pool');
    if (typeof sendEmail !== 'function') throw new Error('createNoticeMailService requires sendEmail');

// 2-1. 공지게시판 새 글 이메일 알림 헬퍼
// - 목적: 최고관리자가 공지게시판에 새 글을 작성하면 가입 회원에게 안내 메일을 보냅니다.
// - 주의: 기존 게시글 저장 로직을 막지 않기 위해 메일 발송은 백그라운드에서 실행합니다.
// - 주의: 공지게시판 판별은 프론트가 보내는 boardType을 우선 사용하고,
//  혹시 구버전 프론트가 접속해도 동작하도록 content의 숨김 마커도 함께 확인합니다.
const BOARD_TYPE_NOTICE = 'notice';
const BOARD_MARKER_NOTICE_FOR_MAIL = '[[UGONGSIL_BOARD:NOTICE]]';
const NOTICE_MAIL_SUBJECT = '우공실 사이트 공지';

// .env의 PUBLIC_SITE_URL 값으로 배포 주소와 개발 주소를 쉽게 전환할 수 있습니다.
// 예: PUBLIC_SITE_URL=http://www.woogongsil.kro.kr/
function getPublicSiteUrl() {
    return process.env.PUBLIC_SITE_URL || 'https://www.woogongsil.co.kr/';
}

// 프론트의 boardType 또는 content 숨김 마커를 이용해 공지게시판 작성글인지 확인합니다.
function isNoticeBoardCreateRequest(boardType, content) {
    const normalizedBoardType = String(boardType || '').trim().toLowerCase();
    const contentText = String(content || '');

    if (normalizedBoardType === BOARD_TYPE_NOTICE) return true;
    return contentText.includes(BOARD_MARKER_NOTICE_FOR_MAIL);
}

// 메일 본문을 사용자 이름별로 만듭니다.
// 요청사항: 문장마다 빈 줄을 두어 줄간격 없이 붙어 보이지 않도록 구성합니다.
function buildNoticePostMailText(userName) {
    const safeName = String(userName || '').trim() || '회원';

    return [
        `안녕하세요, ${safeName}님!`,
        '',
        '정보처리기사 스터디 [ SKN_우공실]에 새로운 공지글이 작성되었습니다.',
        '',
        '확인해주시면 감사합니다!',
        '',
        `홈페이지 바로가기 : ${getPublicSiteUrl()}`
    ].join('\n');
}

// 가입 회원 중 이메일이 있는 사용자만 가져옵니다.
// - 관리자 본인에게 다시 보내지 않도록 authorId는 제외합니다.
// - 같은 이메일이 여러 계정에 중복 저장되어 있으면 1번만 발송합니다.
async function getNoticeMailRecipients(authorId) {
    const [rows] = await pool.query(
        `SELECT id, name, email
         FROM wgs_users
         WHERE email IS NOT NULL
           AND TRIM(email) <> '' AND id <>?
         ORDER BY created_at ASC, id ASC`,
        [authorId]
    );

    const uniqueRecipients = [];
    const seenEmails = new Set();

    for (const row of rows) {
        const email = String(row.email || '').trim().toLowerCase();

        // 매우 기본적인 이메일 형식만 통과시켜 SMTP 오류 가능성을 줄입니다.
        if (!email || !email.includes('@')) continue;
        if (seenEmails.has(email)) continue;

        seenEmails.add(email);
        uniqueRecipients.push({
            id: row.id,
            name: row.name || row.id || '회원',
            email
        });
    }

    return uniqueRecipients;
}

// 실제 공지 메일을 순차 발송합니다.
// - Gmail SMTP는 짧은 시간에 너무 많은 메일을 보내면 제한될 수 있어 0.2초 간격을 둡니다.
// - 일부 사용자에게 실패해도 나머지 사용자 발송은 계속 진행합니다.
async function sendNoticePostEmailsInBackground({ authorId, postId, title }) {
    const recipients = await getNoticeMailRecipients(authorId);

    if (recipients.length === 0) {
        console.log(`[공지메일] 수신 대상 없음: postId=${postId}, title=${title}`);
        return;
    }

    let successCount = 0;
    let failCount = 0;

    console.log(`[공지메일] 발송 시작: postId=${postId}, 대상=${recipients.length}명`);

    for (const recipient of recipients) {
        const result = await sendEmail(
            recipient.email,
            NOTICE_MAIL_SUBJECT,
            buildNoticePostMailText(recipient.name)
        );

        if (result.success) successCount += 1;
        else failCount += 1;

        // SMTP 발송 제한을 피하기 위한 짧은 대기입니다.
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`[공지메일] 발송 완료: postId=${postId}, 성공=${successCount}명, 실패=${failCount}명`);
}


    return {
        isNoticeBoardCreateRequest,
        sendNoticePostEmailsInBackground
    };
}

module.exports = {
    createNoticeMailService
};
