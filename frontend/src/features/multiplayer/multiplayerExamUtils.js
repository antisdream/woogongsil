// 멀티플레이 시험 기능 모듈입니다: multiplayerExamUtils
export const API_BASE = import.meta.env?.VITE_API_BASE_URL || '';

export function formatRemainTime(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;
    return `${h}시간 ${String(m).padStart(2, '0')}분 ${String(s).padStart(2, '0')}초`;
}

export function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

export function getMultiplayerScratchStorageKey(room, question, index) {
    const safeRoomId = room?.roomId || room?.id || room?.roomCode || room?.room_code || 'lobby';
    const safeQuestionId = question?.question_id || question?.id || index;
    return `multi_${safeRoomId}_${safeQuestionId}`;
}

// 멀티플레이 필기 CBT 제한시간: 150분(2시간 30분)
// - 기존 필기 기출문제 시험 시간과 동일하게 유지합니다.
// - 이 상수가 없으면 화면 첫 렌더링 단계에서 ReferenceError가 발생하여 /multiplayer 화면이 빈 화면으로 멈춥니다.
export const EXAM_DURATION_SECONDS = 150 * 60;
const AGREEMENTS = [
    // 실제 정보처리기사 필기 CBT에 가까운 안내 문구로 정리했습니다.
    { title: '[1] 시험 구성 확인', desc: '정보처리기사 필기시험처럼 5과목이 출제되며, 과목별 20문제씩 총 100문제를 풉니다.' },
    { title: '[2] 제한 시간 확인', desc: '시험 시간은 2시간 30분입니다. 제출 전까지 OMR 답안지를 기준으로 선택한 답안을 다시 확인해야 합니다.' },
    { title: '[3] 채점 기준 확인', desc: '과목별 40점 이상, 전체 평균 60점 이상이면 합격입니다. 한 과목이라도 40점 미만이면 과락으로 불합격 처리됩니다.' },
    { title: '[4] 멀티플레이 응시 안내', desc: '같은 방 참여자는 동일한 랜덤 CBT 문제를 풀며, 제출 후 결과표와 오답 정리에서 정답과 해설을 확인할 수 있습니다.' }
];

// 방 만들기에서 필기/실기 문제 출처를 분리합니다.
export const EXAM_TYPE_OPTIONS = [
    { value: 'written', label: '필기 기출문제' },
    { value: 'ipep', label: '실기 기출문제' }
];

const IPEP_AGREEMENTS = [
    { title: '[1] 시험 구성 확인', desc: '정보처리기사 실기 기출문제 20문제가 랜덤으로 출제됩니다.' },
    { title: '[2] 제한 시간 확인', desc: '시험 시간은 2시간 30분입니다. 제출 전까지 입력한 주관식 답안을 다시 확인해야 합니다.' },
    { title: '[3] 채점 기준 확인', desc: '주관식 답안을 직접 입력하며, 60점 이상이면 합격 기준을 만족합니다.' },
    { title: '[4] 멀티플레이 응시 안내', desc: '같은 방 참여자는 동일한 실기 랜덤 문제를 풀며, 제출 후 결과표와 오답 정리에서 정답과 해설을 확인할 수 있습니다.' }
];

export function getAgreementLabelsByExamType(examType) {
    return examType === 'ipep'? IPEP_AGREEMENTS : AGREEMENTS;
}

export function isPracticalQuestion(question) {
    return question?.questionSource === 'ipep' || question?.questionKind === 'ipep' || question?.examType === 'ipep' || question?.exam_type === 'ipep';
}

// 화면 렌더링과 API 요청에서 함께 쓰기 전에 시험 유형을 정규화합니다.
export function normalizeUiExamType(value) {
    return value === 'ipep'? 'ipep' : 'written';
}

// 시험 라벨, 설명, 로비 버튼 문구를 하나의 메타데이터 표에서 관리합니다.
export function getExamMeta(examType) {
    const normalized = normalizeUiExamType(examType);
    const isIpep = normalized === 'ipep';
    return {
        examType: normalized,
        label: isIpep ? '실기' : '필기',
        shortLabel: isIpep ? '실기' : '필기',
        resultTitle: isIpep ? '실기 멀티플레이 전체 채점표' : '필기 멀티플레이 전체 채점표',
        title: isIpep ? '실기 기출문제 랜덤 CBT 멀티플레이' : '필기 기출문제 랜덤 CBT 멀티플레이',
        desc: isIpep
            ? '방장이 인증 비밀번호와 최대 정원을 설정하면, 서버가 실기 기출문제를 랜덤으로 생성합니다.'
            : '방장이 인증 비밀번호와 최대 정원을 설정하면, 서버가 과목별 20문제씩 총 100문제를 랜덤으로 생성합니다.',
        lobbyText: '로비'
    };
}

export async function apiJson(path, options = {}) {
    // 멀티플레이 API 공통 호출 함수: 기존 로그인 세션 검증 방식(id/sessionToken)을 모든 요청에 붙인다.
    const userId = sessionStorage.getItem('userId') || '';
    const sessionToken = sessionStorage.getItem('sessionToken') || '';
    const method = (options.method || 'GET').toUpperCase();
    let finalPath = path;
    let finalBody = options.body;

    if (method === 'GET') {
        const joiner = finalPath.includes('?') ? '&' : '?';
        finalPath = `${finalPath}${joiner}id=${encodeURIComponent(userId)}&sessionToken=${encodeURIComponent(sessionToken)}`;
    } else {
        let bodyObj = {};
        try { bodyObj = finalBody ? JSON.parse(finalBody) : {}; } catch { bodyObj = {}; }
        finalBody = JSON.stringify({ ...bodyObj, id: userId, sessionToken });
    }

    const res = await fetch(`${API_BASE}${finalPath}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options,
        body: finalBody
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.msg || '요청 처리 중 오류가 발생했습니다.');
    return data;
}

// 기출/문제은행과 동일하게 public/question_image 폴더의 문제 이미지를 찾아서 보여주기 위한 공통 함수입니다.
export function getQuestionImageSrc(question) {
    // 필기 <보기> 이미지 경로 보정
    // ------------------------------------------------------------
    // 실제 시험, 오답 다시풀기, HTML-PDF 새 창이 모두 같은 규칙으로 이미지를 찾도록 합니다.
    // 현재 필기 DB는 question_img를 사용하지만, 백엔드에서 내려주는 choice_img_path
    // 계열 별칭도 함께 지원해 데이터 형태가 달라도 화면 표시 기준을 유지합니다.
    const imageName = question?.choiceImgPath
        || question?.choice_img_path
        || question?.questionImgPath
        || question?.imagePath
        || question?.image
        || question?.question_img
        || question?.question_image
        || question?.questionImg
        || question?.choice_img_file;
    if (!imageName) return '';
    const value = String(imageName).trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value) || value.startsWith('/')) return value;
    return `/question_image/${value}`;
}

function getPrintableQuestionImageSrc(question) {
    // 새 about:blank 창에 쓰는 HTML/PDF용 페이지에서는 절대 경로가 더 안전하다.
    const src = getQuestionImageSrc(question);
    if (!src) return '';
    if (/^https?:\/\//i.test(src)) return src;
    const origin = typeof window !== 'undefined'? window.location.origin : '';
    return `${origin}${src.startsWith('/') ? src : `/${src}`}`;
}

// 멀티플레이 시험 본문은 백엔드에서 option_1~option_4로 내려오고,
// 오답풀이/HTML 정리 쪽은 options 배열로 내려오는 경우가 있어서 두 형태를 모두 지원합니다.
function getOptionText(question, index) {
    if (!question) return '';
    const n = Number(index);
    const direct = question[`option_${n}`] ?? question[`opt${n}`] ?? question[`choice${n}`];
    if (direct !== undefined && direct !== null && String(direct).trim() !== '') return String(direct);
    if (Array.isArray(question.options)) return String(question.options[n - 1] || '');
    return '';
}

// 정답 표시, HTML 정리, 실제 시험 화면에서 같은 규칙으로 보기를 출력하기 위한 공통 함수입니다.
export function getOptionList(question) {
    return [1, 2, 3, 4].map((n) => getOptionText(question, n));
}

export function getQuestionExplanationText(question) {
    // 실기 채점 정책(FLEX_TERM, SELF_CHECK 등)은 해설이 아니므로 화면에는 실제 해설만 표시합니다.
    const text = question?.explanation_text ?? question?.explanationText ?? question?.explanation ?? question?.explain ?? question?.commentary ?? '';
    return String(text || '').trim();
}

export function getQuestionExplanationImageSrc(question) {
    const imageName = question?.explanation_img_path || question?.explanationImgPath || question?.explanation_image || question?.explanationImage || '';
    const value = String(imageName || '').trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value) || value.startsWith('/')) return value;
    return `/question_image/${value}`;
}

function getPrintableExplanationImageSrc(question) {
    const src = getQuestionExplanationImageSrc(question);
    if (!src) return '';
    if (/^https?:\/\//i.test(src)) return src;
    const origin = typeof window !== 'undefined'? window.location.origin : '';
    return `${origin}${src.startsWith('/') ? src : `/${src}`}`;
}

export function buildWrongHtml({ roomRecord, escapeHtml }) {
    // 방 전체 오답 정리용 새 창 HTML을 생성합니다. 사이드바는 화면 확인용이고 PDF 인쇄 때는 숨긴다.
    // 최종결과표/PDF 출력은 오답만(wrongItems)이 아니라 방 전체 채점표(rows)를 우선 사용합니다.
    // rows가 없는 과거 기록만 wrongItems로 대체 처리합니다.
    const allPrintableItems = Array.isArray(roomRecord.rows) && roomRecord.rows.length
        ? roomRecord.rows
        : (Array.isArray(roomRecord.wrongItems) ? roomRecord.wrongItems : []);

    // 기존 함수 내부 변수명을 크게 바꾸면 영향 범위가 커지므로,
    // 아래 렌더링에서는 wrongItems 이름을 유지하되 실제 값은 전체 출력 대상입니다.
    const wrongItems = allPrintableItems;

    const recordExamType = normalizeUiExamType(roomRecord.examType || roomRecord.exam_type || roomRecord.examTypeLabel);
    const recordExamMeta = getExamMeta(recordExamType);
    const isIpepRecord = recordExamType === 'ipep';
    const participantNames = (roomRecord.participants || []).map((p) => p.name);
    const sidebarRows = allPrintableItems.map((row) => {
        const correctNames = Array.isArray(row.correctNames) ? row.correctNames : [];
        const wrongNames = Array.isArray(row.wrongNames) ? row.wrongNames : [];
        const rowNo = row.no ?? row.cbtNo ?? row.cbt_no ?? row.questionNo ?? row.question_id ?? '';
        const cells = participantNames.map((name) => correctNames.includes(name) ? 'O' : 'X').join('</td><td>');
        return `<tr><td>${rowNo}번</td><td>${cells}</td><td>${wrongNames.length}</td></tr>`;
    }).join('');

    // 해설 이미지가 존재하면 텍스트가 비어 있어도 '등록된 해설이 없습니다.' 문구를 표시하지 않습니다.
    const renderExplanationHtml = (text, imageHtml) => {
        if (text) return `${escapeHtml(text)}${imageHtml}`;
        if (imageHtml) return imageHtml;
        return '등록된 해설이 없습니다.';
    };

    const wrongCards = wrongItems.map((q, idx) => {
        // PDF/HTML 오답 정리에서 실제 정답 보기에 다시 체크 표시가 보이도록 복구했습니다.
        const correctLabelText = String(q.correctLabel ?? q.correct_label ?? q.correctAnswer ?? q.correct_answer ?? q.answer ?? '');
        const correctNo = Number(String(correctLabelText).match(/\d+/)?.[0] || 0);
        const sourceLabelText = q.sourceLabel ?? q.source_label ?? q.source ?? '';
        const cbtNoText = q.no ?? q.cbtNo ?? q.cbt_no ?? q.questionNo ?? q.question_id ?? (idx + 1);
        const actualNoText = q.actualNo ?? q.actual_no ?? q.realNo ?? q.real_no ?? '-';
        const questionText = q.questionText ?? q.question_text ?? q.question ?? q.title ?? '';
        const explanationText = getQuestionExplanationText(q);
        const correctNames = Array.isArray(q.correctNames) ? q.correctNames : [];
        const wrongNames = Array.isArray(q.wrongNames) ? q.wrongNames : [];
        const questionImageSrc = getPrintableQuestionImageSrc(q);
        const questionImageHtml = questionImageSrc
            ? `<div class="html-question-image-wrap"><img class="html-question-image mp-result-img" src="${escapeHtml(questionImageSrc)}" alt="문제 보기 이미지" onerror=" this.parentElement.style.display='none'" /></div>`
            : '';
        const explanationImageSrc = getPrintableExplanationImageSrc(q);
        const explanationImageHtml = explanationImageSrc
            ? `<div class="html-question-image-wrap"><img class="html-question-image mp-result-img" src="${escapeHtml(explanationImageSrc)}" alt="해설 이미지" onerror=" this.parentElement.style.display='none'" /></div>`
            : '';
        const optionValues = isIpepRecord ? [] : (Array.isArray(q.options) && q.options.length ? q.options : getOptionList(q))
            .filter((opt) => String(opt ?? '').trim() !== '');
        const optionHtml = optionValues.map((opt, optIdx) => {
            const no = optIdx + 1;
            const isCorrect = no === correctNo;
            return `<li class="${isCorrect ? 'correct-option' : ''}"><span class="option-mark">${isCorrect ? 'O' : ''}</span><span>${no}. ${escapeHtml(opt)}</span></li>`;
        }).join('');
        return `
        <section class="wrong-card">
            <h2>${idx + 1}. ${escapeHtml(sourceLabelText)}</h2>
            <table class="info-table">
                <tr><th>CBT 번호</th><td>${escapeHtml(cbtNoText)}</td><th>실제 번호</th><td>${escapeHtml(actualNoText)}</td></tr>
                <tr><th>정답</th><td>${escapeHtml(correctLabelText)}</td><th>정답자</th><td>${escapeHtml(correctNames.join(', ') || '-')}</td></tr>
                <tr><th>오답자</th><td colspan="3">${escapeHtml(wrongNames.join(', ') || '-')}</td></tr>
            </table>
            <p class="question"><strong>Q.</strong> ${escapeHtml(questionText)}</p>
            ${questionImageHtml}
            ${optionHtml ? `<ol class="wrong-options">${optionHtml}</ol>` : ''}
            <div class="explanation"><strong>해설</strong><br/>${renderExplanationHtml(explanationText, explanationImageHtml)}</div>
        </section>
    `;
    }).join('');

    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"/><title>${escapeHtml(recordExamMeta.resultTitle)}</title>
<style>
* {box-sizing:border-box}body{margin:0;background:#f3f7fb;color:#0f172a;font-family:Arial,'Noto Sans KR',sans-serif}.print-btn{position:fixed;top:14px;left:14px;z-index:30;border:0;background:#2563eb;color:white;border-radius:8px;padding:10px 14px;font-weight:800;cursor:pointer}.side-toggle{position:fixed;top:24px;right:34px;z-index:35;border:0;background:#111827;color:white;border-radius:14px;padding:14px 20px;font-weight:900;cursor:pointer;box-shadow:0 12px 28px rgba(15,23,42,.22)}.layout{display:grid;grid-template-columns:minmax(0,1fr) 430px;gap:24px;max-width:1680px;margin:90px auto 30px;padding:0 34px;transition:all .25s ease}.main{min-width:0}.side{background:#111827;color:#f8fafc;border-radius:16px;padding:14px;max-height:calc(100vh - 120px);overflow:auto;position:sticky;top:90px;transition:transform .25s ease,opacity .25s ease}.side table{width:max-content;min-width:100%;border-collapse:collapse}.side th,.side td{border:1px solid #374151;padding:8px 10px;text-align:center;white-space:nowrap}.side th{background:#1f2937}.wrong-card{background:white;border:1px solid #d8e2f1;border-radius:14px;padding:18px;margin-bottom:18px;break-inside:avoid}.wrong-card h2{font-size:18px;color:#2563eb}.info-table{width:100%;border-collapse:collapse;margin:10px 0}.info-table th,.info-table td{border:1px solid #d8e2f1;padding:9px;text-align:left}.info-table th{background:#eef3f9;width:18%}.question{font-size:16px;font-weight:700}.html-question-image-wrap{text-align:center;margin:14px 0 18px}.html-question-image{max-width:100%;max-height:420px;object-fit:contain;background:white;border:1px solid #e2e8f0;border-radius:12px;padding:8px}.mp-result-img{cursor:zoom-in;transition:box-shadow .15s ease,transform .15s ease}.mp-result-img:hover{box-shadow:0 8px 24px rgba(15,23,42,.25)}.mp-result-modal{display:none;position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.82);align-items:center;justify-content:center;padding:24px}.mp-result-modal.is-open{display:flex}.mp-result-modal__box{position:relative;max-width:min(94vw,1280px);max-height:92vh;background:#fff;border-radius:14px;padding:18px;box-shadow:0 24px 80px rgba(0,0,0,.35)}.mp-result-modal__box img{display:block;max-width:100%;max-height:82vh;object-fit:contain}.mp-result-modal__close{position:absolute;right:14px;top:10px;border:0;background:#111827;color:#fff;border-radius:999px;min-width:48px;height:32px;padding:0 10px;font-size:14px;font-weight:900;cursor:pointer}.explanation{background:#f8fafc;border-radius:10px;padding:14px;line-height:1.8}.wrong-options{list-style:none;padding-left:0}.wrong-options li{display:flex;align-items:center;gap:10px;border-radius:10px;padding:8px 10px;margin:6px 0}.wrong-options .option-mark{width:24px;text-align:center;font-weight:900}.wrong-options li.correct-option{background:#d1fae5;color:#047857;font-weight:900;border:1px solid #86efac}body.side-closed .layout{grid-template-columns:minmax(0,1fr);max-width:1480px}body.side-closed .side{position:fixed;right:0;transform:translateX(115%);opacity:0;pointer-events:none}@media(max-width:1000px){.layout{grid-template-columns:1fr}.side{position:static}.side-toggle{display:none}}@media print{body{background:white}.print-btn,.side,.side-toggle{display:none}.layout{display:block;margin:0;padding:0}.wrong-card{page-break-inside:avoid;border-color:#cbd5e1}}
</style></head><body><button class="print-btn" onclick="window.print()">PDF로 저장/인쇄</button><button class="side-toggle" onclick="document.body.classList.toggle('side-closed'); this.textContent = document.body.classList.contains('side-closed') ? '현황 열기' : '현황 닫기';">현황 닫기</button><div class="layout"><main class="main"><h1>${escapeHtml(recordExamMeta.resultTitle)}</h1><p>방 번호 #${escapeHtml(roomRecord.roomCode)} · 전체 채점 문제 ${wrongItems.length}문제</p>${wrongCards}</main><aside class="side"><details open><summary style="font-size:22px;font-weight:900;margin-bottom:12px;cursor:pointer">문제별 정답/오답 현황</summary><table><thead><tr><th>문제번호</th><th>${participantNames.map(escapeHtml).join('</th><th>')}</th><th>틀린수</th></tr></thead><tbody>${sidebarRows}</tbody></table></details></aside></div><div id="mpResultModal" class="mp-result-modal" aria-hidden="true"><div class="mp-result-modal__box"><button type="button" class="mp-result-modal__close" aria-label="닫기">닫기</button><img id="mpResultModalImg" src="" alt="확대 이미지" /></div></div><script>(function(){var modal=document.getElementById('mpResultModal');var img=document.getElementById('mpResultModalImg');var btn=modal?modal.querySelector('.mp-result-modal__close'):null;function close(){if(!modal||!img)return;modal.classList.remove('is-open');modal.setAttribute('aria-hidden','true');img.src='';}document.addEventListener('click',function(e){var t=e.target;if(t&&t.classList&&t.classList.contains('mp-result-img')){if(!modal||!img)return;img.src=t.getAttribute('src');modal.classList.add('is-open');modal.setAttribute('aria-hidden','false');}if(t===modal){close();}});if(btn){btn.addEventListener('click',close);}document.addEventListener('keydown',function(e){if(e.key==='Escape')close();});})();</script></body></html>`;
}
